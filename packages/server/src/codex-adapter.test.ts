import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from './codex-adapter';
import type {
  CodexRpcId,
  CodexRpcTransport,
  CodexServerNotification,
  CodexServerRequest,
} from './codex-app-server-client';

const thread = {
  id: 'thread-real-1',
  preview: 'Implement the provider',
  name: 'Wire real Codex tasks',
  cwd: '/workspace/agentdeck',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_200,
  status: { type: 'notLoaded' },
  turns: [
    {
      id: 'turn-complete',
      status: 'completed',
      startedAt: 1_700_000_100,
      completedAt: 1_700_000_200,
      items: [
        {
          id: 'message-1',
          type: 'agentMessage',
          text: 'The provider boundary is ready.',
        },
      ],
    },
  ],
};

class FakeCodexTransport implements CodexRpcTransport {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: CodexRpcId; result?: unknown; error?: string }> = [];
  readonly #notifications = new Set<(message: CodexServerNotification) => void>();
  readonly #requests = new Set<(message: CodexServerRequest) => void>();

  async request<Result>(method: string, params?: unknown): Promise<Result> {
    this.calls.push({ method, params });
    if (method === 'thread/list') return { data: [{ ...thread, turns: [] }] } as Result;
    if (method === 'thread/read' || method === 'thread/resume') return { thread } as Result;
    if (method === 'turn/start') {
      return {
        turn: {
          id: 'turn-live',
          status: 'inProgress',
          startedAt: 1_700_000_300,
          completedAt: null,
          items: [],
        },
      } as Result;
    }
    return {} as Result;
  }

  notify(): void {}

  respond(id: CodexRpcId, result: unknown): void {
    this.responses.push({ id, result });
  }

  respondError(id: CodexRpcId, _code: number, message: string): void {
    this.responses.push({ id, error: message });
  }

  onNotification(listener: (message: CodexServerNotification) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onRequest(listener: (message: CodexServerRequest) => void): () => void {
    this.#requests.add(listener);
    return () => this.#requests.delete(listener);
  }

  emitRequest(message: CodexServerRequest): void {
    this.#requests.forEach((listener) => listener(message));
  }

  async dispose(): Promise<void> {
    this.#notifications.clear();
    this.#requests.clear();
  }
}

describe('CodexAdapter', () => {
  let adapter: CodexAdapter | undefined;

  afterEach(async () => {
    await adapter?.dispose();
  });

  it('imports persisted Codex threads and forwards reasoning effort on the next turn', async () => {
    const transport = new FakeCodexTransport();
    adapter = await CodexAdapter.connect({ transport, pollIntervalMs: 0 });

    expect(await adapter.listAgents()).toMatchObject([
      {
        id: 'thread-real-1',
        name: 'Wire real Codex tasks',
        projectName: 'agentdeck',
        status: 'completed',
        latestMessage: 'The provider boundary is ready.',
      },
    ]);

    await adapter.sendMessage('thread-real-1', 'Continue the implementation.', {
      reasoningEffort: 'ultra',
    });

    expect(transport.calls.map((call) => call.method)).toContain('thread/resume');
    expect(transport.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      threadId: 'thread-real-1',
      effort: 'ultra',
    });
  });

  it('surfaces and resolves Codex approval requests by their JSON-RPC id', async () => {
    const transport = new FakeCodexTransport();
    adapter = await CodexAdapter.connect({ transport, pollIntervalMs: 0 });

    transport.emitRequest({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-real-1',
        turnId: 'turn-live',
        itemId: 'command-1',
        startedAtMs: 1_700_000_300_000,
        command: 'npm test',
        reason: 'Run the verification suite',
      },
    });

    expect(await adapter.getAgent('thread-real-1')).toMatchObject({
      status: 'awaiting_approval',
      pendingApproval: { title: 'npm test', description: 'Run the verification suite' },
    });

    await adapter.approve('thread-real-1');
    expect(transport.responses).toContainEqual({ id: 42, result: { decision: 'accept' } });
    expect((await adapter.getAgent('thread-real-1'))?.pendingApproval).toBeNull();
  });
});
