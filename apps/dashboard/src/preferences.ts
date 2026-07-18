import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
export type DeckDensity = 'roomy' | 'balanced' | 'dense';
export type ControlKey =
  'approve' | 'reject' | 'interrupt' | 'continue' | 'send' | 'voice' | 'reasoning';

export interface LayoutSettings {
  theme: Theme;
  density: DeckDensity;
  accent: string;
  iconScale: number;
  mountedMode: boolean;
  order: string[];
  agentColors: Record<string, string>;
  hiddenControls: Record<ControlKey, boolean>;
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: string;
  settings: LayoutSettings;
}

interface Preferences extends LayoutSettings {
  profiles: SavedLayout[];
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
  theme: 'dark',
  density: 'balanced',
  accent: '#7c8cff',
  iconScale: 1,
  mountedMode: true,
  order: [],
  agentColors: {},
  hiddenControls: DEFAULT_CONTROLS,
  profiles: [],
};

const STORAGE_KEY = 'agentdeck.preferences.v1';

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<Preferences>;
    return {
      ...DEFAULTS,
      ...parsed,
      hiddenControls: { ...DEFAULT_CONTROLS, ...parsed.hiddenControls },
      order: Array.isArray(parsed.order)
        ? parsed.order.filter((item) => typeof item === 'string')
        : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      agentColors: parsed.agentColors ?? {},
    };
  } catch {
    return DEFAULTS;
  }
}

function extractSettings(preferences: Preferences): LayoutSettings {
  const { profiles: _profiles, ...settings } = preferences;
  return structuredClone(settings);
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.setProperty('--accent', preferences.accent);
    document.documentElement.style.setProperty('--icon-scale', String(preferences.iconScale));
  }, [preferences]);

  const patch = useCallback((update: Partial<LayoutSettings>) => {
    setPreferences((current) => ({ ...current, ...update }));
  }, []);

  const toggleControl = useCallback((control: ControlKey) => {
    setPreferences((current) => ({
      ...current,
      hiddenControls: {
        ...current.hiddenControls,
        [control]: !current.hiddenControls[control],
      },
    }));
  }, []);

  const saveProfile = useCallback((name: string) => {
    setPreferences((current) => ({
      ...current,
      profiles: [
        ...current.profiles,
        {
          id: crypto.randomUUID(),
          name: name.trim() || `Layout ${current.profiles.length + 1}`,
          createdAt: new Date().toISOString(),
          settings: extractSettings(current),
        },
      ],
    }));
  }, []);

  const loadProfile = useCallback((id: string) => {
    setPreferences((current) => {
      const profile = current.profiles.find((candidate) => candidate.id === id);
      return profile ? { ...current, ...structuredClone(profile.settings) } : current;
    });
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setPreferences((current) => ({
      ...current,
      profiles: current.profiles.filter((profile) => profile.id !== id),
    }));
  }, []);

  return { preferences, patch, toggleControl, saveProfile, loadProfile, deleteProfile };
}

export type PreferencesController = ReturnType<typeof usePreferences>;
