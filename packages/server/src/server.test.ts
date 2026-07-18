import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { encodeMessage, parseServerMessage, type ServerMessage } from '@agentdeck/protocol';
import { MockAdapter } from './mock-adapter';
import { createAgentDeckServer, type RunningAgentDeckServer } from './server';

describe('AgentDeck server', () => {
  let running: RunningAgentDeckServer | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    if (running) await running.stop();
  });

  it('authenticates the socket and carries commands through the provider boundary', async () => {
    const provider = new MockAdapter({ autoSimulate: false });
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      dashboardPath: 'missing-dashboard-for-server-test',
      provider,
    });

    const health = await fetch(`http://127.0.0.1:${running.port}/health`).then((response) =>
      response.json(),
    );
    expect(health).toMatchObject({ ok: true, service: 'agentdeck', serverId: running.serverId });

    const messages: ServerMessage[] = [];
    socket = new WebSocket(`ws://127.0.0.1:${running.port}/ws?token=${running.token}`);
    socket.on('message', (data) => messages.push(parseServerMessage(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });

    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === 'snapshot')).toBe(true),
    );
    const workingAgent = (await provider.listAgents()).find((agent) => agent.status === 'working');
    expect(workingAgent).toBeDefined();
    if (!workingAgent) return;

    socket.send(
      encodeMessage({ type: 'interrupt', requestId: 'interrupt-1', agentId: workingAgent.id }),
    );

    await vi.waitFor(() =>
      expect(
        messages.some(
          (message) =>
            message.type === 'command_result' && message.requestId === 'interrupt-1' && message.ok,
        ),
      ).toBe(true),
    );
    expect((await provider.getAgent(workingAgent.id))?.status).toBe('interrupted');
  });

  it('rejects a socket without the rotating pairing token', async () => {
    running = await createAgentDeckServer({ host: '127.0.0.1', port: 0 });
    const unauthorized = new WebSocket(`ws://127.0.0.1:${running.port}/ws?token=wrong`);

    const statusCode = await new Promise<number | undefined>((resolve, reject) => {
      unauthorized.once('unexpected-response', (_request, response) =>
        resolve(response.statusCode),
      );
      unauthorized.once('open', () => reject(new Error('Unauthorized socket was accepted')));
      unauthorized.once('error', () => undefined);
    });

    expect(statusCode).toBe(401);
  });
});
