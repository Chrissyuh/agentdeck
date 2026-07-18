import { CodexAdapter } from './codex-adapter';
import { MockAdapter } from './mock-adapter';
import type { AgentProvider } from './provider';

export interface ProviderEnvironment {
  AGENTDECK_PROVIDER?: string;
  AGENTDECK_CODEX_COMMAND?: string;
}

/** Creates the runtime selected for the host. Real Codex is the default; mock is explicit. */
export async function createAgentProvider(
  environment: ProviderEnvironment = process.env,
): Promise<AgentProvider> {
  const selected = (environment.AGENTDECK_PROVIDER ?? 'codex').trim().toLowerCase();
  if (selected === 'mock') return new MockAdapter();
  if (selected !== 'codex') {
    throw new Error(`Unknown AgentDeck provider "${selected}". Use "codex" or "mock".`);
  }
  return CodexAdapter.connect({
    ...(environment.AGENTDECK_CODEX_COMMAND
      ? { command: environment.AGENTDECK_CODEX_COMMAND }
      : {}),
  });
}
