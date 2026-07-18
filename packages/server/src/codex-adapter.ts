import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Agent,
  AgentEvent,
  AgentMessageOptions,
  AgentStatus,
  CreateAgentRequest,
  PendingApproval,
} from '@agentdeck/protocol';
import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexRpcId,
  type CodexRpcTransport,
  type CodexServerNotification,
  type CodexServerRequest,
} from './codex-app-server-client';
import type { AgentProvider, AgentProviderListener } from './provider';

type NativeThreadStatus =
  { type: 'notLoaded' | 'idle' | 'systemError' } | { type: 'active'; activeFlags?: string[] };

type NativeTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

interface NativeThreadItem {
  id?: string;
  type: string;
  text?: string;
  content?: unknown[];
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  server?: string;
  tool?: string;
  query?: string;
  changes?: unknown[];
  prompt?: string | null;
}

interface NativeTurn {
  id: string;
  items: NativeThreadItem[];
  status: NativeTurnStatus;
  error?: { message?: string } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

interface NativeThread {
  id: string;
  preview: string;
  name?: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: NativeThreadStatus;
  turns: NativeTurn[];
}

interface ThreadListResponse {
  data: NativeThread[];
  nextCursor?: string | null;
}

interface ThreadResponse {
  thread: NativeThread;
}

interface TurnResponse {
  turn: NativeTurn;
}

type ApprovalMethod =
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval'
  | 'execCommandApproval'
  | 'applyPatchApproval';

interface PendingCodexApproval {
  requestId: CodexRpcId;
  method: ApprovalMethod;
  threadId: string;
  turnId: string | undefined;
  params: Record<string, unknown>;
  display: PendingApproval;
}

export interface CodexAdapterOptions extends CodexAppServerClientOptions {
  pollIntervalMs?: number;
  threadLimit?: number;
  transport?: CodexRpcTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isoFromSeconds(seconds: number | null | undefined, fallback = Date.now()): string {
  return new Date(
    seconds === null || seconds === undefined ? fallback : seconds * 1_000,
  ).toISOString();
}

function compactText(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function displayTitle(thread: NativeThread): string {
  return compactText(thread.name?.trim() || thread.preview || 'Untitled Codex task', 64);
}

function projectName(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, '');
  return path.basename(normalized) || normalized || 'Codex';
}

function latestTurn(thread: NativeThread): NativeTurn | undefined {
  return thread.turns.at(-1);
}

function latestItem(turn: NativeTurn | undefined): NativeThreadItem | undefined {
  return turn?.items.at(-1);
}

function userInputText(content: unknown[] | undefined): string | undefined {
  if (!content) return undefined;
  const text = content
    .map((item) => (isRecord(item) && item.type === 'text' ? stringValue(item.text) : undefined))
    .filter((item): item is string => Boolean(item))
    .join('\n');
  return text || undefined;
}

function itemDescription(item: NativeThreadItem | undefined): string | undefined {
  if (!item) return undefined;
  switch (item.type) {
    case 'reasoning':
      return compactText(item.summary?.at(-1) ?? 'Reasoning through the task');
    case 'plan':
      return compactText(item.text ?? 'Updating the plan');
    case 'commandExecution':
      return compactText(item.command ?? 'Running a command');
    case 'fileChange':
      return 'Applying file changes';
    case 'mcpToolCall':
      return compactText([item.server, item.tool].filter(Boolean).join(' · ') || 'Calling a tool');
    case 'dynamicToolCall':
      return compactText(item.tool ?? 'Calling a tool');
    case 'collabAgentToolCall':
      return compactText(item.prompt ?? 'Coordinating another agent');
    case 'webSearch':
      return compactText(item.query ? `Searching for ${item.query}` : 'Searching the web');
    case 'agentMessage':
      return 'Preparing a response';
    default:
      return undefined;
  }
}

function latestAgentMessage(thread: NativeThread): string | null {
  for (const turn of [...thread.turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type === 'agentMessage' && item.text?.trim()) return compactText(item.text, 240);
    }
  }
  return thread.preview ? compactText(thread.preview, 240) : null;
}

function statusFor(thread: NativeThread, pending: boolean): AgentStatus {
  if (pending) return 'awaiting_approval';
  if (thread.status.type === 'systemError') return 'error';
  const turn = latestTurn(thread);
  if (thread.status.type === 'active' || turn?.status === 'inProgress') {
    const item = latestItem(turn);
    return item?.type === 'reasoning' || !item ? 'thinking' : 'working';
  }
  switch (turn?.status) {
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

function eventForItem(
  item: NativeThreadItem,
  turn: NativeTurn,
  index: number,
): AgentEvent | undefined {
  const timestamp = isoFromSeconds(turn.completedAt ?? turn.startedAt);
  const id = `codex:${turn.id}:${item.id ?? index}:${item.type}`;
  switch (item.type) {
    case 'userMessage': {
      const text = userInputText(item.content);
      return {
        id,
        timestamp,
        kind: 'message',
        title: 'Direction sent',
        ...(text ? { detail: compactText(text) } : {}),
      };
    }
    case 'agentMessage':
      return {
        id,
        timestamp,
        kind: 'message',
        title: 'Codex replied',
        ...(item.text ? { detail: compactText(item.text) } : {}),
      };
    case 'commandExecution':
      return {
        id,
        timestamp,
        kind: item.status === 'failed' ? 'error' : 'action',
        title: item.status === 'inProgress' ? 'Command running' : 'Command finished',
        ...(item.command ? { detail: compactText(item.command) } : {}),
      };
    case 'fileChange':
      return { id, timestamp, kind: 'action', title: 'File changes prepared' };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return {
        id,
        timestamp,
        kind: 'action',
        title: 'Tool called',
        ...(itemDescription(item) ? { detail: itemDescription(item) } : {}),
      };
    case 'webSearch':
      return {
        id,
        timestamp,
        kind: 'action',
        title: 'Web search',
        ...(itemDescription(item) ? { detail: itemDescription(item) } : {}),
      };
    default:
      return undefined;
  }
}

function nativeEvents(
  thread: NativeThread,
  pending: PendingCodexApproval | undefined,
): AgentEvent[] {
  const events = thread.turns.flatMap((turn) =>
    turn.items.flatMap((item, index) => {
      const event = eventForItem(item, turn, index);
      return event ? [event] : [];
    }),
  );
  if (pending) {
    events.push({
      id: `codex:approval:${String(pending.requestId)}`,
      timestamp: pending.display.requestedAt,
      kind: 'approval',
      title: 'Approval needed',
      detail: pending.display.title,
    });
  }
  return events.slice(-40);
}

function approvalThreadId(params: Record<string, unknown>): string | undefined {
  return stringValue(params.threadId) ?? stringValue(params.conversationId);
}

function approvalDisplay(
  request: CodexServerRequest,
  params: Record<string, unknown>,
): PendingApproval {
  const startedAt = numberValue(params.startedAtMs);
  const reason = stringValue(params.reason);
  const command = stringValue(params.command);
  const legacyCommand = Array.isArray(params.command)
    ? params.command.filter((part): part is string => typeof part === 'string').join(' ')
    : undefined;
  const requestedAt = new Date(startedAt ?? Date.now()).toISOString();

  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'execCommandApproval'
  ) {
    const detail = command ?? legacyCommand;
    const network = isRecord(params.networkApprovalContext);
    return {
      id: String(request.id),
      title: compactText(detail || 'Run a command', 72),
      description:
        reason ??
        (network ? 'Allow the requested network command.' : 'Allow Codex to run this command.'),
      requestedAt,
      risk: network ? 'high' : 'medium',
    };
  }
  if (
    request.method === 'item/fileChange/requestApproval' ||
    request.method === 'applyPatchApproval'
  ) {
    return {
      id: String(request.id),
      title: 'Apply file changes',
      description: reason ?? 'Allow Codex to modify files in this workspace.',
      requestedAt,
      risk: params.grantRoot ? 'high' : 'medium',
    };
  }
  return {
    id: String(request.id),
    title: 'Grant additional permissions',
    description: reason ?? 'Allow the requested filesystem or network permissions for this turn.',
    requestedAt,
    risk: 'high',
  };
}

function sameAgent(left: Agent | undefined, right: Agent): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

/** Normalizes real Codex app-server threads into AgentDeck's provider-neutral state. */
export class CodexAdapter implements AgentProvider {
  readonly name = 'Codex';
  readonly #transport: CodexRpcTransport;
  readonly #threadLimit: number;
  readonly #listeners = new Set<AgentProviderListener>();
  readonly #threads = new Map<string, NativeThread>();
  readonly #agents = new Map<string, Agent>();
  readonly #activeTurns = new Map<string, string>();
  readonly #loadedThreads = new Set<string>();
  readonly #approvals = new Map<string, PendingCodexApproval>();
  readonly #liveOperations = new Map<string, string>();
  readonly #transportUnsubscribers: Array<() => void> = [];
  #pollTimer: NodeJS.Timeout | undefined;
  #refreshing: Promise<void> | undefined;
  #disposed = false;

  private constructor(transport: CodexRpcTransport, options: CodexAdapterOptions) {
    this.#transport = transport;
    this.#threadLimit = options.threadLimit ?? 40;
    this.#transportUnsubscribers.push(
      transport.onNotification((message) => this.#handleNotification(message)),
      transport.onRequest((message) => this.#handleServerRequest(message)),
    );

    const pollInterval = options.pollIntervalMs ?? 4_000;
    if (pollInterval > 0) {
      this.#pollTimer = setInterval(() => {
        void this.#refresh().catch(() => undefined);
      }, pollInterval);
      this.#pollTimer.unref?.();
    }
  }

  static async connect(options: CodexAdapterOptions = {}): Promise<CodexAdapter> {
    const transport = options.transport ?? (await CodexAppServerClient.connect(options));
    const adapter = new CodexAdapter(transport, options);
    try {
      await adapter.#refresh(true);
      return adapter;
    } catch (error) {
      await adapter.dispose();
      throw error;
    }
  }

  async listAgents(): Promise<Agent[]> {
    await this.#refresh();
    return [...this.#agents.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((agent) => structuredClone(agent));
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    const agent = this.#agents.get(id);
    return agent ? structuredClone(agent) : undefined;
  }

  subscribe(listener: AgentProviderListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async approve(id: string): Promise<void> {
    await this.#resolveApproval(id, true);
  }

  async reject(id: string): Promise<void> {
    await this.#resolveApproval(id, false);
  }

  async interrupt(id: string): Promise<void> {
    await this.#ensureLoaded(id);
    const turnId = this.#activeTurns.get(id) ?? latestTurn(this.#requireThread(id))?.id;
    if (!turnId || latestTurn(this.#requireThread(id))?.status !== 'inProgress') {
      throw new Error('This Codex task has no active turn to interrupt');
    }
    await this.#transport.request('turn/interrupt', { threadId: id, turnId });
  }

  async sendMessage(id: string, message: string, options: AgentMessageOptions = {}): Promise<void> {
    await this.#ensureLoaded(id);
    const input = [{ type: 'text', text: message, text_elements: [] }];
    const activeTurnId = this.#activeTurns.get(id);
    if (activeTurnId) {
      await this.#transport.request('turn/steer', {
        threadId: id,
        expectedTurnId: activeTurnId,
        input,
      });
      return;
    }

    const response = await this.#transport.request<TurnResponse>('turn/start', {
      threadId: id,
      input,
      ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
    });
    this.#upsertTurn(id, response.turn);
  }

  async createAgent(request: CreateAgentRequest): Promise<Agent> {
    const requestedWorkspace = request.projectName.trim();
    const knownWorkspace = [...this.#threads.values()].find(
      (thread) =>
        thread.cwd.toLowerCase() === requestedWorkspace.toLowerCase() ||
        projectName(thread.cwd).toLowerCase() === requestedWorkspace.toLowerCase(),
    )?.cwd;
    const workspace = knownWorkspace ?? requestedWorkspace;
    const workspaceStat = await stat(workspace).catch(() => undefined);
    if (!workspaceStat?.isDirectory()) {
      throw new Error('Choose an existing Codex project name or enter its full desktop path');
    }

    const response = await this.#transport.request<ThreadResponse>('thread/start', {
      cwd: workspace,
      approvalsReviewer: 'user',
    });
    response.thread.name = request.name;
    this.#loadedThreads.add(response.thread.id);
    this.#storeThread(response.thread, true);
    await this.#transport.request('thread/name/set', {
      threadId: response.thread.id,
      name: request.name,
    });
    if (request.initialMessage?.trim()) {
      await this.sendMessage(response.thread.id, request.initialMessage);
    }
    return structuredClone(this.#requireAgent(response.thread.id));
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#transportUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.#listeners.clear();
    await this.#transport.dispose();
  }

  async #refresh(forceRead = false): Promise<void> {
    if (this.#disposed) return;
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#performRefresh(forceRead).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #performRefresh(forceRead: boolean): Promise<void> {
    const response = await this.#transport.request<ThreadListResponse>('thread/list', {
      limit: this.#threadLimit,
      sortKey: 'updated_at',
      sortDirection: 'desc',
    });
    const listedIds = new Set(response.data.map((thread) => thread.id));

    for (let index = 0; index < response.data.length; index += 6) {
      const batch = response.data.slice(index, index + 6);
      await Promise.all(
        batch.map(async (listed) => {
          const existing = this.#threads.get(listed.id);
          const statusChanged = existing?.status.type !== listed.status.type;
          const shouldRead =
            forceRead || !existing || existing.updatedAt !== listed.updatedAt || statusChanged;
          if (!shouldRead) return;
          try {
            const read = await this.#transport.request<ThreadResponse>('thread/read', {
              threadId: listed.id,
              includeTurns: true,
            });
            this.#storeThread(read.thread, true);
          } catch {
            this.#storeThread({ ...listed, turns: existing?.turns ?? [] }, true);
          }
        }),
      );
    }

    for (const id of [...this.#threads.keys()]) {
      if (listedIds.has(id)) continue;
      this.#threads.delete(id);
      this.#agents.delete(id);
      this.#listeners.forEach((listener) => listener({ type: 'agent_removed', agentId: id }));
    }
  }

  async #ensureLoaded(threadId: string): Promise<void> {
    this.#requireThread(threadId);
    if (this.#loadedThreads.has(threadId)) return;
    const response = await this.#transport.request<ThreadResponse>('thread/resume', {
      threadId,
      approvalsReviewer: 'user',
    });
    this.#loadedThreads.add(threadId);
    this.#storeThread(response.thread, true);
    const active = [...response.thread.turns]
      .reverse()
      .find((turn) => turn.status === 'inProgress');
    if (active) this.#activeTurns.set(threadId, active.id);
  }

  async #resolveApproval(threadId: string, approved: boolean): Promise<void> {
    const pending = this.#approvals.get(threadId);
    if (!pending) throw new Error('This Codex task is not waiting for approval');

    switch (pending.method) {
      case 'item/commandExecution/requestApproval':
        this.#transport.respond(pending.requestId, { decision: approved ? 'accept' : 'decline' });
        break;
      case 'item/fileChange/requestApproval':
        this.#transport.respond(pending.requestId, { decision: approved ? 'accept' : 'decline' });
        break;
      case 'item/permissions/requestApproval': {
        const requested = asRecord(pending.params.permissions);
        const permissions = approved
          ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== null))
          : {};
        this.#transport.respond(pending.requestId, { permissions, scope: 'turn' });
        break;
      }
      case 'execCommandApproval':
      case 'applyPatchApproval':
        this.#transport.respond(pending.requestId, {
          decision: approved ? 'approved' : 'denied',
        });
        break;
    }
    this.#approvals.delete(threadId);
    this.#emitThread(threadId);
  }

  #handleServerRequest(request: CodexServerRequest): void {
    const supported = new Set<ApprovalMethod>([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'execCommandApproval',
      'applyPatchApproval',
    ]);
    if (!supported.has(request.method as ApprovalMethod)) {
      this.#transport.respondError(request.id, -32601, `AgentDeck cannot handle ${request.method}`);
      return;
    }

    const params = asRecord(request.params);
    const threadId = approvalThreadId(params);
    if (!threadId) {
      this.#transport.respondError(
        request.id,
        -32602,
        'Approval request did not include a thread id',
      );
      return;
    }
    this.#approvals.set(threadId, {
      requestId: request.id,
      method: request.method as ApprovalMethod,
      threadId,
      turnId: stringValue(params.turnId),
      params,
      display: approvalDisplay(request, params),
    });
    this.#emitThread(threadId);
  }

  #handleNotification(message: CodexServerNotification): void {
    const params = asRecord(message.params);
    const threadId = stringValue(params.threadId);
    switch (message.method) {
      case 'thread/started': {
        const thread = params.thread as NativeThread | undefined;
        if (thread?.id) {
          this.#loadedThreads.add(thread.id);
          this.#storeThread(thread, true);
        }
        break;
      }
      case 'thread/status/changed':
        if (threadId && isRecord(params.status)) {
          const thread = this.#threads.get(threadId);
          if (thread)
            this.#storeThread({ ...thread, status: params.status as NativeThreadStatus }, true);
        }
        break;
      case 'thread/name/updated':
        if (threadId) {
          const thread = this.#threads.get(threadId);
          if (thread)
            this.#storeThread({ ...thread, name: stringValue(params.threadName) ?? null }, true);
        }
        break;
      case 'thread/archived':
      case 'thread/closed':
        if (threadId) this.#removeThread(threadId);
        break;
      case 'turn/started':
        if (threadId && isRecord(params.turn))
          this.#upsertTurn(threadId, params.turn as unknown as NativeTurn);
        break;
      case 'turn/completed':
        if (threadId && isRecord(params.turn)) {
          const turn = params.turn as unknown as NativeTurn;
          this.#upsertTurn(threadId, turn);
          this.#activeTurns.delete(threadId);
          this.#liveOperations.delete(threadId);
        }
        break;
      case 'item/started':
      case 'item/completed':
        if (threadId && isRecord(params.item)) {
          this.#upsertItem(
            threadId,
            stringValue(params.turnId),
            params.item as unknown as NativeThreadItem,
          );
        }
        break;
      case 'item/agentMessage/delta':
        if (threadId) {
          this.#appendAgentDelta(
            threadId,
            stringValue(params.turnId),
            stringValue(params.itemId),
            stringValue(params.delta) ?? '',
          );
        }
        break;
      case 'item/reasoning/summaryTextDelta':
        if (threadId) {
          const delta = stringValue(params.delta);
          if (delta) {
            this.#liveOperations.set(
              threadId,
              compactText(`${this.#liveOperations.get(threadId) ?? ''}${delta}`),
            );
            this.#emitThread(threadId);
          }
        }
        break;
      case 'turn/plan/updated':
        if (threadId && Array.isArray(params.plan)) {
          const active = params.plan.find(
            (step) => isRecord(step) && (step.status === 'inProgress' || step.status === 'pending'),
          );
          if (isRecord(active) && typeof active.step === 'string') {
            this.#liveOperations.set(threadId, compactText(active.step));
            this.#emitThread(threadId);
          }
        }
        break;
      case 'serverRequest/resolved':
        if (threadId) {
          const pending = this.#approvals.get(threadId);
          if (pending && pending.requestId === params.requestId) {
            this.#approvals.delete(threadId);
            this.#emitThread(threadId);
          }
        }
        break;
      case 'error':
        if (threadId && isRecord(params.error)) {
          const thread = this.#threads.get(threadId);
          if (thread && !params.willRetry) {
            const turn = latestTurn(thread);
            if (turn) {
              turn.status = 'failed';
              turn.error = { message: stringValue(params.error.message) ?? 'Codex task failed' };
              this.#storeThread({ ...thread, updatedAt: Date.now() / 1_000 }, true);
            }
          }
        }
        break;
    }
  }

  #upsertTurn(threadId: string, turn: NativeTurn): void {
    const thread = this.#threads.get(threadId);
    if (!thread) {
      void this.#refresh(true).catch(() => undefined);
      return;
    }
    const turns = [...thread.turns];
    const index = turns.findIndex((candidate) => candidate.id === turn.id);
    if (index >= 0) turns[index] = turn;
    else turns.push(turn);
    if (turn.status === 'inProgress') this.#activeTurns.set(threadId, turn.id);
    this.#storeThread({ ...thread, turns, updatedAt: Date.now() / 1_000 }, true);
  }

  #upsertItem(threadId: string, turnId: string | undefined, item: NativeThreadItem): void {
    const thread = this.#threads.get(threadId);
    if (!thread) return;
    const turn = turnId
      ? thread.turns.find((candidate) => candidate.id === turnId)
      : latestTurn(thread);
    if (!turn) return;
    const items = [...turn.items];
    const index = item.id ? items.findIndex((candidate) => candidate.id === item.id) : -1;
    if (index >= 0) items[index] = item;
    else items.push(item);
    this.#upsertTurn(threadId, { ...turn, items });
  }

  #appendAgentDelta(
    threadId: string,
    turnId: string | undefined,
    itemId: string | undefined,
    delta: string,
  ): void {
    if (!delta) return;
    const thread = this.#threads.get(threadId);
    if (!thread) return;
    const turn = turnId
      ? thread.turns.find((candidate) => candidate.id === turnId)
      : latestTurn(thread);
    if (!turn) return;
    const items = [...turn.items];
    let index = itemId ? items.findIndex((candidate) => candidate.id === itemId) : -1;
    if (index < 0) {
      items.push({ id: itemId ?? randomUUID(), type: 'agentMessage', text: '' });
      index = items.length - 1;
    }
    const item = items[index];
    if (!item) return;
    items[index] = { ...item, type: 'agentMessage', text: `${item.text ?? ''}${delta}` };
    this.#upsertTurn(threadId, { ...turn, items });
  }

  #storeThread(thread: NativeThread, emit: boolean): void {
    const normalized: NativeThread = {
      ...thread,
      preview: thread.preview ?? '',
      name: thread.name ?? null,
      cwd: thread.cwd ?? '',
      turns: Array.isArray(thread.turns) ? thread.turns : [],
    };
    this.#threads.set(normalized.id, normalized);
    const agent = this.#toAgent(normalized);
    const previous = this.#agents.get(normalized.id);
    this.#agents.set(normalized.id, agent);
    if (emit && !sameAgent(previous, agent)) {
      const snapshot = structuredClone(agent);
      this.#listeners.forEach((listener) => listener({ type: 'agent_updated', agent: snapshot }));
    }
  }

  #toAgent(thread: NativeThread): Agent {
    const pending = this.#approvals.get(thread.id);
    const turn = latestTurn(thread);
    const status = statusFor(thread, Boolean(pending));
    const active = ['thinking', 'working', 'awaiting_approval'].includes(status);
    const failure = turn?.status === 'failed' ? turn.error?.message : undefined;
    return {
      id: thread.id,
      name: displayTitle(thread),
      projectName: projectName(thread.cwd),
      status,
      startedAt: active ? isoFromSeconds(turn?.startedAt, thread.updatedAt * 1_000) : null,
      updatedAt: isoFromSeconds(thread.updatedAt),
      currentOperation: active
        ? (pending?.display.title ??
          this.#liveOperations.get(thread.id) ??
          itemDescription(latestItem(turn)) ??
          'Working on the current turn')
        : null,
      latestMessage: failure ? compactText(failure, 240) : latestAgentMessage(thread),
      pendingApproval: pending?.display ?? null,
      events: nativeEvents(thread, pending),
    };
  }

  #emitThread(threadId: string): void {
    const thread = this.#threads.get(threadId);
    if (thread) this.#storeThread(thread, true);
  }

  #removeThread(threadId: string): void {
    if (!this.#threads.delete(threadId)) return;
    this.#agents.delete(threadId);
    this.#activeTurns.delete(threadId);
    this.#loadedThreads.delete(threadId);
    this.#approvals.delete(threadId);
    this.#listeners.forEach((listener) => listener({ type: 'agent_removed', agentId: threadId }));
  }

  #requireThread(id: string): NativeThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error('Codex task not found');
    return thread;
  }

  #requireAgent(id: string): Agent {
    const agent = this.#agents.get(id);
    if (!agent) throw new Error('Codex task not found');
    return agent;
  }
}
