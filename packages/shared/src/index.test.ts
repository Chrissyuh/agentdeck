import { describe, expect, it } from 'vitest';
import { formatElapsed } from './index';

describe('formatElapsed', () => {
  it('formats short and long durations', () => {
    const now = Date.parse('2026-01-01T01:02:03.000Z');
    expect(formatElapsed('2026-01-01T01:01:00.000Z', now)).toBe('1:03');
    expect(formatElapsed('2026-01-01T00:00:00.000Z', now)).toBe('1:02:03');
  });
});
