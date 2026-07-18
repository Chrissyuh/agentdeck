import type { Agent, ClientMessage, CreateAgentRequest } from '@agentdeck/protocol';
import { encodeMessage, parseServerMessage } from '@agentdeck/protocol';
import { makeRequestId } from '@agentdeck/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'unpaired';

export interface AgentDeckSnapshot {
  agents: Agent[];
  revision: number;
  serverId: string | null;
  status: ConnectionStatus;
  latencyMs: number | null;
  lastError: string | null;
}

export interface PairingConfig {
  serverOrigin: string;
  token: string;
}

type Listener = () => void;

const EMPTY_SNAPSHOT: AgentDeckSnapshot = {
  agents: [],
  revision: 0,
  serverId: null,
  status: 'unpaired',
  latencyMs: null,
  lastError: null,
};

export function readPairingConfig(): PairingConfig | null {
  if (typeof window === 'undefined') return null;
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const pair = fragment.get('pair');
  const server = fragment.get('server');
  if (pair && server) {
    const config = { serverOrigin: server.replace(/\/$/, ''), token: pair };
    window.localStorage.setItem('agentdeck.pairing', JSON.stringify(config));
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return config;
  }
  try {
    const stored = JSON.parse(
      window.localStorage.getItem('agentdeck.pairing') ?? 'null',
    ) as unknown;
    if (
      stored &&
      typeof stored === 'object' &&
      'serverOrigin' in stored &&
      'token' in stored &&
      typeof stored.serverOrigin === 'string' &&
      typeof stored.token === 'string'
    ) {
      return { serverOrigin: stored.serverOrigin, token: stored.token };
    }
  } catch {
    window.localStorage.removeItem('agentdeck.pairing');
  }
  return null;
}

export class AgentDeckConnection {
  #snapshot: AgentDeckSnapshot;
  readonly #listeners = new Set<Listener>();
  readonly #pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  #socket: WebSocket | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #reconnectAttempt = 0;
  #stopped = false;
  #config: PairingConfig | null;

  constructor(config: PairingConfig | null = readPairingConfig()) {
    this.#config = config;
    this.#snapshot = config ? { ...EMPTY_SNAPSHOT, status: 'connecting' } : EMPTY_SNAPSHOT;
  }

  getSnapshot = (): AgentDeckSnapshot => this.#snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#socket?.close(1000, 'Dashboard closed');
    this.#socket = null;
    this.#pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Connection closed'));
    });
    this.#pending.clear();
  }

  pair(config: PairingConfig): void {
    this.stop();
    this.#config = config;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('agentdeck.pairing', JSON.stringify(config));
    }
    this.#snapshot = { ...EMPTY_SNAPSHOT, status: 'connecting' };
    this.#emit();
    this.start();
  }

  approve(agentId: string): Promise<void> {
    return this.#command({ type: 'approve', requestId: makeRequestId(), agentId });
  }

  reject(agentId: string): Promise<void> {
    return this.#command({ type: 'reject', requestId: makeRequestId(), agentId });
  }

  interrupt(agentId: string): Promise<void> {
    return this.#command({ type: 'interrupt', requestId: makeRequestId(), agentId });
  }

  sendMessage(agentId: string, message: string): Promise<void> {
    return this.#command({ type: 'send_message', requestId: makeRequestId(), agentId, message });
  }

  createAgent(agent: CreateAgentRequest): Promise<void> {
    return this.#command({ type: 'create_agent', requestId: makeRequestId(), agent });
  }

  #connect(): void {
    if (this.#stopped || !this.#config) {
      if (!this.#config) this.#setSnapshot({ status: 'unpaired' });
      return;
    }

    const wsOrigin = this.#config.serverOrigin.replace(/^http/, 'ws');
    const url = `${wsOrigin}/ws?token=${encodeURIComponent(this.#config.token)}`;
    this.#setSnapshot({ status: this.#reconnectAttempt > 0 ? 'reconnecting' : 'connecting' });
    const socket = new WebSocket(url);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#reconnectAttempt = 0;
      this.#setSnapshot({ status: 'connected', lastError: null });
      this.#heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(encodeMessage({ type: 'heartbeat', sentAt: Date.now() }));
        }
      }, 8_000);
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = parseServerMessage(String(event.data));
        if (message.type === 'snapshot') {
          this.#snapshot = {
            ...this.#snapshot,
            agents: message.agents,
            revision: message.revision,
            serverId: message.serverId,
            status: 'connected',
          };
          this.#emit();
        } else if (
          message.type === 'agent_updated' &&
          message.revision >= this.#snapshot.revision
        ) {
          const agents = [...this.#snapshot.agents];
          const index = agents.findIndex((agent) => agent.id === message.agent.id);
          if (index >= 0) agents[index] = message.agent;
          else agents.push(message.agent);
          this.#snapshot = { ...this.#snapshot, agents, revision: message.revision };
          this.#emit();
        } else if (
          message.type === 'agent_removed' &&
          message.revision >= this.#snapshot.revision
        ) {
          this.#snapshot = {
            ...this.#snapshot,
            agents: this.#snapshot.agents.filter((agent) => agent.id !== message.agentId),
            revision: message.revision,
          };
          this.#emit();
        } else if (message.type === 'command_result') {
          const pending = this.#pending.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.#pending.delete(message.requestId);
            if (message.ok) pending.resolve();
            else pending.reject(new Error(message.error ?? 'Command failed'));
          }
        } else if (message.type === 'heartbeat') {
          this.#setSnapshot({
            latencyMs: message.echo
              ? Math.max(0, Date.now() - message.echo)
              : this.#snapshot.latencyMs,
          });
        }
      } catch {
        this.#setSnapshot({ lastError: 'The host sent an unreadable update.' });
      }
    });

    const reconnect = (): void => {
      if (this.#socket !== socket) return;
      if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
      this.#socket = null;
      if (this.#stopped) return;
      this.#reconnectAttempt += 1;
      this.#setSnapshot({
        status: navigator.onLine ? 'reconnecting' : 'offline',
        latencyMs: null,
      });
      const delay = Math.min(12_000, 700 * 2 ** Math.min(this.#reconnectAttempt, 5));
      this.#reconnectTimer = setTimeout(() => this.#connect(), delay + Math.random() * 350);
    };
    socket.addEventListener('close', reconnect, { once: true });
    socket.addEventListener('error', () => {
      this.#setSnapshot({ lastError: 'The desktop host is unreachable.' });
    });
  }

  #command(message: Exclude<ClientMessage, { type: 'heartbeat' }>): Promise<void> {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('AgentDeck is offline'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(message.requestId);
        reject(new Error('The host did not acknowledge the command'));
      }, 10_000);
      this.#pending.set(message.requestId, { resolve, reject, timer });
      this.#socket?.send(encodeMessage(message));
    });
  }

  #setSnapshot(update: Partial<AgentDeckSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...update };
    this.#emit();
  }

  #emit(): void {
    this.#listeners.forEach((listener) => listener());
  }
}
