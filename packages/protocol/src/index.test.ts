import { describe, expect, it } from 'vitest';
import { clientMessageSchema, parseServerMessage } from './index';

describe('AgentDeck protocol', () => {
  it('rejects empty control messages', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'send_message',
        requestId: 'r1',
        agentId: 'a1',
        message: '   ',
      }).success,
    ).toBe(false);
  });

  it('parses a valid heartbeat', () => {
    expect(parseServerMessage('{"type":"heartbeat","serverTime":42}')).toEqual({
      type: 'heartbeat',
      serverTime: 42,
    });
  });

  it('carries provider-native reasoning effort with a direction', () => {
    expect(
      clientMessageSchema.parse({
        type: 'send_message',
        requestId: 'r2',
        agentId: 'a1',
        message: 'Handle the difficult edge case.',
        reasoningEffort: 'ultra',
      }),
    ).toMatchObject({ reasoningEffort: 'ultra' });
  });
});
