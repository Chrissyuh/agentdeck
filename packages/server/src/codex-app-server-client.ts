import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export type CodexRpcId = string | number;

export interface CodexServerNotification {
  method: string;
  params?: unknown;
}

export interface CodexServerRequest extends CodexServerNotification {
  id: CodexRpcId;
}

export interface CodexRpcTransport {
  request<Result>(method: string, params?: unknown): Promise<Result>;
  notify(method: string, params?: unknown): void;
  respond(id: CodexRpcId, result: unknown): void;
  respondError(id: CodexRpcId, code: number, message: string): void;
  onNotification(listener: (message: CodexServerNotification) => void): () => void;
  onRequest(listener: (message: CodexServerRequest) => void): () => void;
  dispose(): Promise<void>;
}

export interface CodexAppServerClientOptions {
  command?: string;
  requestTimeoutMs?: number;
  stderr?: (line: string) => void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface RpcResponse {
  id: CodexRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRpcId(value: unknown): value is CodexRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

function nativeWindowsCodex(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const appData = process.env.APPDATA;
  if (!appData) return undefined;

  const architecture =
    process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const candidate = path.join(
    appData,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    `@openai/codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`,
    'vendor',
    architecture,
    'bin',
    'codex.exe',
  );
  return existsSync(candidate) ? candidate : undefined;
}

function spawnCodex(options: CodexAppServerClientOptions): ChildProcessWithoutNullStreams {
  const configured = options.command ?? process.env.AGENTDECK_CODEX_COMMAND;
  const command = configured ?? nativeWindowsCodex() ?? 'codex';
  const needsShell = process.platform === 'win32' && !command.toLowerCase().endsWith('.exe');
  return spawn(command, ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: needsShell,
  });
}

/**
 * Minimal JSONL client for the official local `codex app-server` protocol.
 *
 * Codex owns authentication and task persistence. AgentDeck only keeps this private stdio transport
 * and exposes its own provider-neutral LAN protocol to the dashboard.
 */
export class CodexAppServerClient implements CodexRpcTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<CodexRpcId, PendingRequest>();
  readonly #notifications = new Set<(message: CodexServerNotification) => void>();
  readonly #requests = new Set<(message: CodexServerRequest) => void>();
  readonly #requestTimeoutMs: number;
  readonly #stderrLines: string[] = [];
  #nextId = 1;
  #closed = false;

  private constructor(options: CodexAppServerClientOptions) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#child = spawnCodex(options);

    readline.createInterface({ input: this.#child.stdout }).on('line', (line) => {
      this.#handleLine(line);
    });
    readline.createInterface({ input: this.#child.stderr }).on('line', (line) => {
      this.#stderrLines.push(line);
      if (this.#stderrLines.length > 12) this.#stderrLines.shift();
      options.stderr?.(line);
    });
    this.#child.on('error', (error) => this.#close(error));
    this.#child.on('exit', (code, signal) => {
      const detail = this.#stderrLines.at(-1);
      this.#close(
        new Error(
          `Codex app-server exited${code === null ? '' : ` with code ${code}`}${
            signal ? ` (${signal})` : ''
          }${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
  }

  static async connect(options: CodexAppServerClientOptions = {}): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(options);
    try {
      await client.request('initialize', {
        clientInfo: { name: 'agentdeck', title: 'AgentDeck', version: '0.1.0' },
        capabilities: { experimentalApi: false },
      });
      client.notify('initialized', {});
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  request<Result>(method: string, params: unknown = {}): Promise<Result> {
    if (this.#closed) return Promise.reject(new Error('Codex app-server is not connected'));
    const id = this.#nextId++;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server did not answer ${method}`));
      }, this.#requestTimeoutMs);
      timer.unref?.();
      this.#pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timer,
      });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error('Could not write to Codex app-server'));
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: CodexRpcId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: CodexRpcId, code: number, message: string): void {
    this.#write({ id, error: { code, message } });
  }

  onNotification(listener: (message: CodexServerNotification) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onRequest(listener: (message: CodexServerRequest) => void): () => void {
    this.#requests.add(listener);
    return () => this.#requests.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.stdin.end();
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill();
    this.#rejectPending(new Error('Codex app-server connection closed'));
    this.#notifications.clear();
    this.#requests.clear();
  }

  #write(message: unknown): void {
    if (this.#closed || !this.#child.stdin.writable) {
      throw new Error('Codex app-server is not connected');
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;

    if (isRpcId(parsed.id) && typeof parsed.method === 'string') {
      const request: CodexServerRequest = {
        id: parsed.id,
        method: parsed.method,
        params: parsed.params,
      };
      if (this.#requests.size === 0) {
        this.respondError(request.id, -32601, `AgentDeck does not handle ${request.method}`);
        return;
      }
      this.#requests.forEach((listener) => listener(request));
      return;
    }

    if (isRpcId(parsed.id)) {
      this.#handleResponse(parsed as unknown as RpcResponse);
      return;
    }

    if (typeof parsed.method === 'string') {
      const notification: CodexServerNotification = {
        method: parsed.method,
        params: parsed.params,
      };
      this.#notifications.forEach((listener) => listener(notification));
    }
  }

  #handleResponse(response: RpcResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (response.error) {
      pending.reject(
        new Error(
          `Codex request failed${response.error.code ? ` (${response.error.code})` : ''}: ${
            response.error.message ?? 'Unknown error'
          }`,
        ),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  #close(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(error);
  }

  #rejectPending(error: Error): void {
    this.#pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.#pending.clear();
  }
}
