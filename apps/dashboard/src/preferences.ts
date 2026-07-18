import { useCallback, useEffect, useState } from 'react';
import { isReasoningLevel, type ReasoningLevel } from './reasoning';

export type ControlKey =
  'approve' | 'reject' | 'interrupt' | 'continue' | 'send' | 'voice' | 'reasoning';

export interface Preferences {
  mountedMode: boolean;
  slots: Array<string | null>;
  reasoningByAgent: Record<string, ReasoningLevel>;
  hiddenControls: Record<ControlKey, boolean>;
}

const DEFAULT_CONTROLS: Record<ControlKey, boolean> = {
  approve: false,
  reject: false,
  interrupt: false,
  continue: false,
  send: false,
  voice: false,
  reasoning: false,
};

const DEFAULTS: Preferences = {
  mountedMode: true,
  slots: [],
  reasoningByAgent: {},
  hiddenControls: DEFAULT_CONTROLS,
};

const STORAGE_KEY = 'agentdeck.preferences.v3';
const PREVIOUS_STORAGE_KEY = 'agentdeck.preferences.v2';
const LEGACY_STORAGE_KEY = 'agentdeck.preferences.v1';

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ??
        window.localStorage.getItem(PREVIOUS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_STORAGE_KEY) ??
        '{}',
    ) as Partial<Preferences> & { order?: unknown };
    const reasoningByAgent = Object.fromEntries(
      Object.entries(parsed.reasoningByAgent ?? {}).filter(
        (entry): entry is [string, ReasoningLevel] => isReasoningLevel(entry[1]),
      ),
    );
    const legacyOrder = Array.isArray(parsed.order)
      ? parsed.order.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      mountedMode: parsed.mountedMode ?? DEFAULTS.mountedMode,
      hiddenControls: DEFAULT_CONTROLS,
      slots: Array.isArray(parsed.slots)
        ? parsed.slots
            .slice(0, 6)
            .map((item) => (typeof item === 'string' && item.length > 0 ? item : null))
        : legacyOrder.slice(0, 6),
      reasoningByAgent,
    };
  } catch {
    return DEFAULTS;
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    delete document.documentElement.dataset.theme;
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--icon-scale');
  }, [preferences]);

  const patch = useCallback((update: Partial<Preferences>) => {
    setPreferences((current) => ({ ...current, ...update }));
  }, []);

  return { preferences, patch };
}

export type PreferencesController = ReturnType<typeof usePreferences>;
