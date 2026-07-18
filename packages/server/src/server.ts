import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AddressInfo } from 'node:net';
import express from 'express';
import QRCode from 'qrcode';
import { WebSocket, WebSocketServer } from 'ws';
import {
  encodeMessage,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '@agentdeck/protocol';
import type { AgentProvider } from './provider';
import { MockAdapter } from './mock-adapter';

interface LiveSocket extends WebSocket {
  isAlive: boolean;
}

export interface AgentDeckServerOptions {
  host?: string;
  port?: number;
  dashboardPath?: string;
  pairingCode?: string;
  provider?: AgentProvider;
}

export interface RunningAgentDeckServer {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly serverId: string;
  readonly localAddress: string;
  getDashboardUrl(dashboardOrigin?: string): string;
  getQrDataUrl(dashboardOrigin?: string): Promise<string>;
  stop(): Promise<void>;
}

const DEFAULT_PORT = 4317;
const LEGACY_SYNTHETIC_VOICE_MESSAGE = 'Voice direction (simulated by the local mock provider).';
const MAX_PUBLIC_ERROR_LENGTH = 180;

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Command failed');
}

function publicCommandError(error: unknown): string {
  const raw = rawErrorMessage(error).replace(/\s+/g, ' ').trim();
  const detail = raw.replace(/^Codex request failed(?: \(-?\d+\))?:\s*/i, '').trim();

  if (/active turn|turn.+in progress|already.+working/i.test(detail)) {
    return 'That task is already working. Wait for it to finish or tap Interrupt.';
  }
  if (/reasoning|effort/i.test(detail) && /invalid|unsupported|does not support/i.test(detail)) {
    return 'That Codex model does not support the selected reasoning level.';
  }
  if (/thread|task/i.test(detail) && /not found|does not exist|missing/i.test(detail)) {
    return 'That task is no longer available. Map another task to this key.';
  }
  if (detail.length <= MAX_PUBLIC_ERROR_LENGTH) return detail || 'The command failed.';
  return `${detail.slice(0, MAX_PUBLIC_ERROR_LENGTH - 1).trimEnd()}…`;
}

function getLanAddress(): string {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? []).map((address) => ({ ...address, interfaceName: name })),
    )
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .sort((a, b) => {
      const aWifi = /wi-?fi|wireless|wlan/i.test(a.interfaceName) ? 0 : 1;
      const bWifi = /wi-?fi|wireless|wlan/i.test(b.interfaceName) ? 0 : 1;
      return aWifi - bWifi;
    });
  return candidates[0]?.address ?? '127.0.0.1';
}

function tokenMatches(expected: string, candidate: string | null): boolean {
  if (!candidate) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createAgentDeckServer(
  options: AgentDeckServerOptions = {},
): Promise<RunningAgentDeckServer> {
  const host = options.host ?? '0.0.0.0';
  const desiredPort = options.port ?? DEFAULT_PORT;
  const token = options.pairingCode ?? randomInt(0, 10_000).toString().padStart(4, '0');
  if (!/^\d{4}$/.test(token)) throw new Error('AgentDeck pairing codes must contain four digits');
  const serverId = randomUUID();
  const provider = options.provider ?? new MockAdapter();
  let revision = 1;

  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'microphone=(self), on-device-speech-recognition=(self)',
    );
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'",
    );
    next();
  });

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'agentdeck', serverId, provider: provider.name });
  });

  const dashboardPath = options.dashboardPath
    ? path.resolve(options.dashboardPath)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/dashboard/dist');

  if (existsSync(path.join(dashboardPath, 'index.html'))) {
    app.use(
      express.static(dashboardPath, {
        index: false,
        setHeaders(response, filePath) {
          const normalizedPath = filePath.replace(/\\/g, '/');
          if (normalizedPath.endsWith('/index.html')) {
            response.setHeader('Cache-Control', 'no-store, max-age=0');
          } else if (normalizedPath.includes('/assets/')) {
            response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            response.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (_request, response) => {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.sendFile(path.join(dashboardPath, 'index.html'));
    });
  } else {
    app.get('/', (_request, response) => {
      response.status(503).type('text/plain').send('AgentDeck dashboard has not been built yet.');
    });
  }

  const httpServer: HttpServer = createHttpServer(app);
  const webSocketServer = new WebSocketServer({ noServer: true });
  const sockets = new Set<LiveSocket>();

  const broadcast = (message: ServerMessage): void => {
    const encoded = encodeMessage(message);
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
    });
  };

  const unsubscribe = provider.subscribe((providerEvent) => {
    revision += 1;
    if (providerEvent.type === 'agent_updated') {
      broadcast({ type: 'agent_updated', revision, agent: providerEvent.agent });
    } else {
      broadcast({ type: 'agent_removed', revision, agentId: providerEvent.agentId });
    }
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (
      requestUrl.pathname !== '/ws' ||
      !tokenMatches(token, requestUrl.searchParams.get('token'))
    ) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      webSocketServer.emit('connection', ws, request);
    });
  });

  webSocketServer.on('connection', async (rawSocket) => {
    const socket = rawSocket as LiveSocket;
    socket.isAlive = true;
    sockets.add(socket);
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.on('message', (data) => {
      void handleClientMessage(socket, data.toString());
    });

    const agents = await provider.listAgents();
    socket.send(
      encodeMessage({ type: 'snapshot', revision, serverId, providerName: provider.name, agents }),
    );
  });

  async function handleClientMessage(socket: LiveSocket, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = parseClientMessage(raw);
    } catch {
      socket.close(1003, 'Invalid message');
      return;
    }

    if (message.type === 'heartbeat') {
      socket.send(
        encodeMessage({ type: 'heartbeat', serverTime: Date.now(), echo: message.sentAt }),
      );
      return;
    }

    try {
      switch (message.type) {
        case 'approve':
          await provider.approve(message.agentId);
          break;
        case 'reject':
          await provider.reject(message.agentId);
          break;
        case 'interrupt':
          await provider.interrupt(message.agentId);
          break;
        case 'send_message':
          if (
            provider.name !== 'Mock' &&
            message.message.trim() === LEGACY_SYNTHETIC_VOICE_MESSAGE
          ) {
            throw new Error(
              'Blocked a stale mock voice command. Reload AgentDeck before using Voice.',
            );
          }
          await provider.sendMessage(message.agentId, message.message, {
            ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}),
          });
          break;
        case 'create_agent':
          await provider.createAgent(message.agent);
          break;
      }
      socket.send(
        encodeMessage({ type: 'command_result', requestId: message.requestId, ok: true }),
      );
    } catch (error) {
      const rawError = rawErrorMessage(error);
      console.error('[AgentDeck] Provider command failed', {
        provider: provider.name,
        command: message.type,
        requestId: message.requestId,
        error: rawError.slice(0, 2_000),
      });
      socket.send(
        encodeMessage({
          type: 'command_result',
          requestId: message.requestId,
          ok: false,
          error: publicCommandError(error),
        }),
      );
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(desiredPort, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const port = address.port;
  const localAddress = getLanAddress();
  const heartbeatTimer = setInterval(() => {
    sockets.forEach((socket) => {
      if (!socket.isAlive) {
        socket.terminate();
        sockets.delete(socket);
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 10_000);
  heartbeatTimer.unref?.();

  const getDashboardUrl = (dashboardOrigin?: string): string => {
    const serverOrigin = `http://${localAddress}:${port}`;
    const origin = dashboardOrigin ?? serverOrigin;
    const normalizedOrigin = origin
      .replace('localhost', localAddress)
      .replace('127.0.0.1', localAddress);
    const fragment = new URLSearchParams({ pair: token, server: serverOrigin });
    const dashboardUrl = new URL(normalizedOrigin);
    dashboardUrl.pathname = `${dashboardUrl.pathname.replace(/\/$/, '')}/`;
    dashboardUrl.searchParams.set('v', serverId.slice(0, 8));
    dashboardUrl.hash = fragment.toString();
    return dashboardUrl.toString();
  };

  return {
    host,
    port,
    token,
    serverId,
    localAddress,
    getDashboardUrl,
    getQrDataUrl: (dashboardOrigin?: string) =>
      QRCode.toDataURL(getDashboardUrl(dashboardOrigin), {
        width: 520,
        margin: 1,
        color: { dark: '#111216', light: '#f5f4ef' },
        errorCorrectionLevel: 'M',
      }),
    stop: async () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
      await provider.dispose?.();
      sockets.forEach((socket) => socket.close(1001, 'Host shutting down'));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      webSocketServer.close();
    },
  };
}
