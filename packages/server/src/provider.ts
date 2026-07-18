import type { Agent, AgentMessageOptions, CreateAgentRequest } from '@agentdeck/protocol';

export type AgentProviderEvent =
  { type: 'agent_updated'; agent: Agent } | { type: 'agent_removed'; agentId: string };

export type AgentProviderListener = (event: AgentProviderEvent) => void;

/**
 * The only boundary between AgentDeck and an agent runtime.
 *
 * Provider implementations normalize their native state into protocol `Agent` objects. The server
 * remains authoritative and the dashboard stays completely provider-agnostic.
 */
export interface AgentProvider {
  readonly name: string;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  subscribe(listener: AgentProviderListener): () => void;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  interrupt(id: string): Promise<void>;
  sendMessage(id: string, message: string, options?: AgentMessageOptions): Promise<void>;
  createAgent(request: CreateAgentRequest): Promise<Agent>;
  dispose?(): Promise<void> | void;
}
