export const REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const REASONING_META: Record<
  ReasoningLevel,
  { label: string; shortLabel: string; detail: string }
> = {
  none: {
    label: 'None',
    shortLabel: 'NONE',
    detail: 'Direct execution with no extra deliberation.',
  },
  minimal: { label: 'Minimal', shortLabel: 'MIN', detail: 'The lightest pass for obvious work.' },
  low: { label: 'Low', shortLabel: 'LOW', detail: 'Fast reasoning for straightforward changes.' },
  medium: {
    label: 'Medium',
    shortLabel: 'MED',
    detail: 'Balanced depth for everyday engineering.',
  },
  high: { label: 'High', shortLabel: 'HIGH', detail: 'More deliberate analysis and verification.' },
  xhigh: {
    label: 'Extra high',
    shortLabel: 'XHIGH',
    detail: 'Heavy reasoning for difficult systems work.',
  },
  max: { label: 'Max', shortLabel: 'MAX', detail: 'Maximum supported depth for demanding tasks.' },
  ultra: {
    label: 'Ultra',
    shortLabel: 'ULTRA',
    detail: 'Deepest available reasoning and delegation.',
  },
};

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === 'string' && REASONING_LEVELS.includes(value as ReasoningLevel);
}
