import type { AgentStatus } from '@agentdeck/protocol';

export const STATUS_META: Record<
  AgentStatus,
  { label: string; color: string; glow: string; active: boolean }
> = {
  idle: { label: 'Idle', color: '#f5f5f4', glow: 'rgba(245,245,244,.3)', active: false },
  thinking: { label: 'Thinking', color: '#60a5fa', glow: 'rgba(96,165,250,.42)', active: true },
  working: { label: 'Working', color: '#3b82f6', glow: 'rgba(59,130,246,.46)', active: true },
  awaiting_approval: {
    label: 'Approval needed',
    color: '#f59e0b',
    glow: 'rgba(245,158,11,.48)',
    active: true,
  },
  completed: {
    label: 'Completed',
    color: '#34d399',
    glow: 'rgba(52,211,153,.38)',
    active: false,
  },
  error: { label: 'Error', color: '#f05252', glow: 'rgba(240,82,82,.42)', active: false },
  interrupted: {
    label: 'Interrupted',
    color: '#a8a29e',
    glow: 'rgba(168,162,158,.32)',
    active: false,
  },
};

export function formatElapsed(startedAt: string | null, now = Date.now()): string {
  if (!startedAt) return '—';
  const totalSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function shortTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(timestamp),
  );
}

export function makeRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
