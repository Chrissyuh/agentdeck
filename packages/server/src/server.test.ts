import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { encodeMessage, parseServerMessage, type ServerMessage } from '@agentdeck/protocol';
import { MockAdapter } from './mock-adapter';
import { createAgentDeckServer, type RunningAgentDeckServer } from './server';

describe('AgentDeck server', () => {
  let running: RunningAgentDeckServer | undefined;
  let socket: WebSocket | undefined;
  let dashboardDirectory: string | undefined;

  afterEach(async () => {
    socket?.close();
    if (running) await running.stop();
    if (dashboardDirectory) await rm(dashboardDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('authenticates the socket with a four-digit code and carries commands through the provider boundary', async () => {
    const provider = new MockAdapter({ autoSimulate: false });
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      dashboardPath: 'missing-dashboard-for-server-test',
      provider,
    });
    expect(running.token).toMatch(/^\d{4}$/);

    const health = await fetch(`http://127.0.0.1:${running.port}/health`).then((response) =>
      response.json(),
    );
    expect(health).toMatchObject({
      ok: true,
      service: 'agentdeck',
      serverId: running.serverId,
      provider: 'Mock',
    });

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
    expect(messages.find((message) => message.type === 'snapshot')).toMatchObject({
      providerName: 'Mock',
    });
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

  it('rejects a socket without the current pairing code', async () => {
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

  it('accepts an explicit four-digit pairing code', async () => {
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      pairingCode: '6084',
    });

    expect(running.token).toBe('6084');
    const pairingUrl = new URL(running.getDashboardUrl());
    expect(pairingUrl.searchParams.get('v')).toBe(running.serverId.slice(0, 8));
    expect(pairingUrl.hash).toContain('pair=6084');
  });

  it('never caches the dashboard shell and explicitly allows microphone access', async () => {
    dashboardDirectory = await mkdtemp(path.join(tmpdir(), 'agentdeck-dashboard-'));
    await writeFile(
      path.join(dashboardDirectory, 'index.html'),
      '<!doctype html><title>Deck</title>',
    );
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      dashboardPath: dashboardDirectory,
    });

    const response = await fetch(`http://127.0.0.1:${running.port}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('permissions-policy')).toContain('microphone=(self)');
  });

  it('blocks the legacy mock voice placeholder from reaching a real provider', async () => {
    const provider = new MockAdapter({ autoSimulate: false });
    Object.defineProperty(provider, 'name', { value: 'Codex' });
    const sendMessage = vi.spyOn(provider, 'sendMessage');
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      dashboardPath: 'missing-dashboard-for-server-test',
      provider,
    });

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

    const agent = (await provider.listAgents())[0];
    expect(agent).toBeDefined();
    if (!agent) return;
    socket.send(
      encodeMessage({
        type: 'send_message',
        requestId: 'legacy-voice',
        agentId: agent.id,
        message: 'Voice direction (simulated by the local mock provider).',
      }),
    );

    await vi.waitFor(() =>
      expect(
        messages.find(
          (message) => message.type === 'command_result' && message.requestId === 'legacy-voice',
        ),
      ).toMatchObject({
        ok: false,
        error: 'Blocked a stale mock voice command. Reload AgentDeck before using Voice.',
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps provider failures concise on the control surface', async () => {
    const provider = new MockAdapter({ autoSimulate: false });
    vi.spyOn(provider, 'sendMessage').mockRejectedValue(
      new Error(`Codex request failed (-32602): ${'schema detail '.repeat(80)}`),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    running = await createAgentDeckServer({
      host: '127.0.0.1',
      port: 0,
      dashboardPath: 'missing-dashboard-for-server-test',
      provider,
    });

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

    const agent = (await provider.listAgents())[0];
    expect(agent).toBeDefined();
    if (!agent) return;
    socket.send(
      encodeMessage({
        type: 'send_message',
        requestId: 'oversized-error',
        agentId: agent.id,
        message: 'Continue',
      }),
    );

    await vi.waitFor(() => {
      const result = messages.find(
        (message) => message.type === 'command_result' && message.requestId === 'oversized-error',
      );
      expect(result).toMatchObject({ ok: false });
      if (result?.type === 'command_result' && !result.ok) {
        const detail = result.error ?? '';
        expect(detail.length).toBeLessThanOrEqual(180);
        expect(detail).toMatch(/…$/);
      }
    });
  });
});
