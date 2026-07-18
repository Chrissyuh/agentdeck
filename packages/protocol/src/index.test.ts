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
});
