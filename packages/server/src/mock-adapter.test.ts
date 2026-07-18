import { describe, expect, it } from 'vitest';
import { MockAdapter } from './mock-adapter';

describe('MockAdapter', () => {
  it('emits normalized updates for remote controls', async () => {
    const provider = new MockAdapter({ autoSimulate: false });
    const agent = (await provider.listAgents()).find((candidate) => candidate.status === 'working');
    expect(agent).toBeDefined();
    if (!agent) return;

    const updates: string[] = [];
    provider.subscribe((providerEvent) => {
      if (providerEvent.type === 'agent_updated') updates.push(providerEvent.agent.status);
    });

    await provider.interrupt(agent.id);
    expect((await provider.getAgent(agent.id))?.status).toBe('interrupted');
    expect(updates).toEqual(['interrupted']);
    provider.dispose();
  });
});
