import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import type { CreateAgentRequest } from '@agentdeck/protocol';
import { AgentDeckConnection, type AgentDeckSnapshot, type PairingConfig } from './connection';

export interface AgentDeckActions {
  approve(agentId: string): Promise<void>;
  reject(agentId: string): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  sendMessage(agentId: string, message: string): Promise<void>;
  createAgent(agent: CreateAgentRequest): Promise<void>;
  pair(config: PairingConfig): void;
}

interface AgentDeckContextValue {
  snapshot: AgentDeckSnapshot;
  actions: AgentDeckActions;
}

const AgentDeckContext = createContext<AgentDeckContextValue | null>(null);

export function AgentDeckProvider({ children }: PropsWithChildren): React.JSX.Element {
  const connection = useMemo(() => new AgentDeckConnection(), []);
  const snapshot = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getSnapshot,
  );

  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, [connection]);

  const actions = useMemo<AgentDeckActions>(
    () => ({
      approve: (agentId) => connection.approve(agentId),
      reject: (agentId) => connection.reject(agentId),
      interrupt: (agentId) => connection.interrupt(agentId),
      sendMessage: (agentId, message) => connection.sendMessage(agentId, message),
      createAgent: (agent) => connection.createAgent(agent),
      pair: (config) => connection.pair(config),
    }),
    [connection],
  );

  return (
    <AgentDeckContext.Provider value={{ snapshot, actions }}>{children}</AgentDeckContext.Provider>
  );
}

export function useAgentDeck(): AgentDeckContextValue {
  const value = useContext(AgentDeckContext);
  if (!value) throw new Error('useAgentDeck must be used inside AgentDeckProvider');
  return value;
}
