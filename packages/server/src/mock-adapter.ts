import { randomUUID } from 'node:crypto';
import type { Agent, AgentEvent, AgentStatus, CreateAgentRequest } from '@agentdeck/protocol';
import type { AgentProvider, AgentProviderListener } from './provider';

const OPERATIONS = [
  'Tracing the authentication flow',
  'Running the integration suite',
  'Refactoring the provider boundary',
  'Reviewing the latest changes',
  'Indexing the workspace',
  'Preparing a production build',
  'Checking TypeScript contracts',
];

const MESSAGES = [
  'I found the state transition that was dropping reconnect events.',
  'The build is clean. I am checking the touch interaction edge cases now.',
  'There are two viable implementations; the smaller one preserves the existing API.',
  'I updated the tests around the failure path and they now pass consistently.',
  'The provider returned a permission request before it can continue.',
  'I finished the requested change and verified the complete local flow.',
  'One dependency exposes an older type signature, so I isolated it behind an adapter.',
];

function choice<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('Cannot choose from an empty collection');
  return item;
}

function event(kind: AgentEvent['kind'], title: string, detail?: string): AgentEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    kind,
    title,
    ...(detail ? { detail } : {}),
  };
}

function seedAgent(
  name: string,
  projectName: string,
  status: AgentStatus,
  ageMinutes: number,
): Agent {
  const now = Date.now();
  const active = ['thinking', 'working', 'awaiting_approval'].includes(status);
  const approval = status === 'awaiting_approval';
  return {
    id: randomUUID(),
    name,
    projectName,
    status,
    startedAt: active ? new Date(now - ageMinutes * 60_000).toISOString() : null,
    updatedAt: new Date(now - Math.min(ageMinutes, 2) * 60_000).toISOString(),
    currentOperation: active ? choice(OPERATIONS) : null,
    latestMessage:
      status === 'idle'
        ? 'Ready for a new task.'
        : status === 'completed'
          ? (MESSAGES[5] ?? null)
          : choice(MESSAGES),
    pendingApproval: approval
      ? {
          id: randomUUID(),
          title: 'Run workspace migration',
          description: 'Apply the generated schema migration to the local development database.',
          requestedAt: new Date(now - 40_000).toISOString(),
          risk: 'medium',
        }
      : null,
    events: [
      event('system', 'Agent connected', `Attached to ${projectName}`),
      event(
        'status',
        status === 'awaiting_approval' ? 'Approval requested' : `Status changed to ${status}`,
      ),
    ],
  };
}

export class MockAdapter implements AgentProvider {
  readonly #agents = new Map<string, Agent>();
  readonly #listeners = new Set<AgentProviderListener>();
  #timer: NodeJS.Timeout | undefined;

  constructor(options: { autoSimulate?: boolean } = {}) {
    [
      seedAgent('Mira', 'AgentDeck', 'working', 12),
      seedAgent('Kepler', 'Northstar API', 'awaiting_approval', 4),
      seedAgent('Ada', 'Portfolio', 'completed', 27),
      seedAgent('Linus', 'Scratchpad', 'idle', 0),
    ].forEach((agent) => this.#agents.set(agent.id, agent));

    if (options.autoSimulate !== false) this.#scheduleNextTick();
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.#agents.values()].map((agent) => structuredClone(agent));
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
    const agent = this.#requireAgent(id);
    this.#update(agent, {
      status: 'working',
      pendingApproval: null,
      currentOperation: 'Applying the approved operation',
      latestMessage: 'Approved. I am continuing with the operation now.',
      nextEvent: event('action', 'Approval granted', 'Operation resumed'),
    });
  }

  async reject(id: string): Promise<void> {
    const agent = this.#requireAgent(id);
    this.#update(agent, {
      status: 'idle',
      pendingApproval: null,
      currentOperation: null,
      latestMessage: 'The requested operation was rejected. I am waiting for direction.',
      nextEvent: event('action', 'Approval rejected', 'Agent returned to idle'),
    });
  }

  async interrupt(id: string): Promise<void> {
    const agent = this.#requireAgent(id);
    this.#update(agent, {
      status: 'interrupted',
      pendingApproval: null,
      currentOperation: null,
      latestMessage: 'Interrupted safely. No further actions are running.',
      nextEvent: event('action', 'Agent interrupted', 'Stopped by remote control'),
    });
  }

  async sendMessage(id: string, message: string): Promise<void> {
    const agent = this.#requireAgent(id);
    this.#update(agent, {
      status: 'thinking',
      pendingApproval: null,
      startedAt: agent.startedAt ?? new Date().toISOString(),
      currentOperation: 'Interpreting your direction',
      latestMessage: `Received: ${message}`,
      nextEvent: event('message', 'Direction received', message),
    });
  }

  async createAgent(request: CreateAgentRequest): Promise<Agent> {
    const agent: Agent = {
      id: randomUUID(),
      name: request.name,
      projectName: request.projectName,
      status: request.initialMessage ? 'thinking' : 'idle',
      startedAt: request.initialMessage ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      currentOperation: request.initialMessage ? 'Reading the new assignment' : null,
      latestMessage: request.initialMessage ?? 'Ready for a new task.',
      pendingApproval: null,
      events: [event('system', 'Agent created', `Attached to ${request.projectName}`)],
    };
    this.#agents.set(agent.id, agent);
    this.#emit(agent);
    return structuredClone(agent);
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#listeners.clear();
  }

  #requireAgent(id: string): Agent {
    const agent = this.#agents.get(id);
    if (!agent) throw new Error('Agent not found');
    return agent;
  }

  #update(
    agent: Agent,
    update: Partial<Omit<Agent, 'id' | 'events' | 'updatedAt'>> & {
      nextEvent: AgentEvent;
    },
  ): void {
    const { nextEvent, ...fields } = update;
    const updated: Agent = {
      ...agent,
      ...fields,
      updatedAt: new Date().toISOString(),
      events: [...agent.events, nextEvent].slice(-40),
    };
    this.#agents.set(agent.id, updated);
    this.#emit(updated);
  }

  #emit(agent: Agent): void {
    const snapshot = structuredClone(agent);
    this.#listeners.forEach((listener) => listener({ type: 'agent_updated', agent: snapshot }));
  }

  #scheduleNextTick(): void {
    const delay = 4_500 + Math.floor(Math.random() * 4_000);
    this.#timer = setTimeout(() => {
      this.#simulateTick();
      this.#scheduleNextTick();
    }, delay);
    this.#timer.unref?.();
  }

  #simulateTick(): void {
    const agents = [...this.#agents.values()];
    const agent = agents[Math.floor(Math.random() * agents.length)];
    if (!agent) return;

    const roll = Math.random();
    if (agent.status === 'awaiting_approval' && roll < 0.72) return;

    if (roll < 0.12) {
      this.#update(agent, {
        status: 'error',
        currentOperation: null,
        pendingApproval: null,
        latestMessage: 'A simulated command exited with code 1. The workspace was not changed.',
        nextEvent: event('error', 'Command failed', 'Exited with code 1'),
      });
      return;
    }

    if (roll < 0.3 && ['thinking', 'working'].includes(agent.status)) {
      this.#update(agent, {
        status: 'awaiting_approval',
        currentOperation: 'Waiting for permission',
        latestMessage: 'I need approval before I can modify the protected configuration.',
        pendingApproval: {
          id: randomUUID(),
          title: choice(['Install a package', 'Write protected settings', 'Run a migration']),
          description: choice([
            'Add a development dependency to the current workspace.',
            'Update the local tool configuration used by this project.',
            'Apply the generated changes to the local development database.',
          ]),
          requestedAt: new Date().toISOString(),
          risk: choice(['low', 'medium', 'high'] as const),
        },
        nextEvent: event('approval', 'Approval needed', 'Remote decision requested'),
      });
      return;
    }

    if (roll < 0.5 && ['thinking', 'working'].includes(agent.status)) {
      this.#update(agent, {
        status: 'completed',
        currentOperation: null,
        pendingApproval: null,
        latestMessage: choice(MESSAGES),
        nextEvent: event('status', 'Task completed', 'Verification passed'),
      });
      return;
    }

    const nextStatus: AgentStatus = agent.status === 'thinking' ? 'working' : 'thinking';
    this.#update(agent, {
      status: nextStatus,
      startedAt: agent.startedAt ?? new Date().toISOString(),
      currentOperation: choice(OPERATIONS),
      pendingApproval: null,
      latestMessage: choice(MESSAGES),
      nextEvent: event(
        'status',
        nextStatus === 'thinking' ? 'Thinking through the task' : 'Work in progress',
      ),
    });
  }
}
