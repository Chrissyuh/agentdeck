import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, LayoutGrid, Moon, Save, Sun, Trash2, X } from 'lucide-react';
import type { Agent } from '@agentdeck/protocol';
import type { ControlKey, DeckDensity, PreferencesController } from '../preferences';
import { haptic } from '../hooks';

const ACCENTS = ['#7c8cff', '#50c8ff', '#37d39a', '#f5a94a', '#f06a7d', '#b78cff'];
const CARD_COLORS = ['#f5f5f4', '#60a5fa', '#34d399', '#f59e0b', '#f05252', '#b78cff'];
const CONTROL_LABELS: Record<ControlKey, string> = {
  approve: 'Approve',
  reject: 'Reject',
  interrupt: 'Interrupt',
  continue: 'Continue',
  send: 'Send',
  voice: 'Voice',
  reasoning: 'Reasoning',
};

const CHAT_LAYOUTS: Array<{ id: DeckDensity; label: string; detail: string }> = [
  { id: 'roomy', label: 'List', detail: '1 by 6' },
  { id: 'balanced', label: 'Grid', detail: '2 by 3' },
  { id: 'dense', label: 'Wide', detail: '3 by 2' },
];

export function CustomizeSheet({
  open,
  onClose,
  agents,
  controller,
}: {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  controller: PreferencesController;
}) {
  const { preferences, patch, toggleControl, saveProfile, loadProfile, deleteProfile } = controller;
  const [profileName, setProfileName] = useState('');

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            className="bottom-sheet settings-sheet"
            initial={{ y: '105%' }}
            animate={{ y: 0 }}
            exit={{ y: '105%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            aria-label="Customize AgentDeck"
            aria-modal="true"
            role="dialog"
          >
            <div className="sheet-header sticky-sheet-header">
              <div>
                <span className="eyebrow">Control surface</span>
                <h2>Make it yours</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close customization">
                <X />
              </button>
            </div>

            <div className="settings-columns">
              <div className="settings-group">
                <h3>Appearance</h3>
                <div className="segmented-control" aria-label="Theme">
                  <button
                    className={preferences.theme === 'dark' ? 'selected' : ''}
                    onClick={() => patch({ theme: 'dark' })}
                  >
                    <Moon /> Dark
                  </button>
                  <button
                    className={preferences.theme === 'light' ? 'selected' : ''}
                    onClick={() => patch({ theme: 'light' })}
                  >
                    <Sun /> Light
                  </button>
                </div>
                <span className="setting-label">Accent</span>
                <div className="swatches">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      className="swatch"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        patch({ accent: color });
                        haptic(7);
                      }}
                      aria-label={`Use ${color} accent`}
                    >
                      {preferences.accent === color ? <Check /> : null}
                    </button>
                  ))}
                </div>
                <label className="range-setting">
                  <span>
                    Icon size <strong>{Math.round(preferences.iconScale * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0.82"
                    max="1.25"
                    step="0.01"
                    value={preferences.iconScale}
                    onChange={(event) => patch({ iconScale: Number(event.target.value) })}
                  />
                </label>
              </div>

              <div className="settings-group">
                <h3>Chat key layout</h3>
                <div className="density-picker">
                  {CHAT_LAYOUTS.map((density) => (
                    <button
                      key={density.id}
                      className={preferences.density === density.id ? 'selected' : ''}
                      onClick={() => patch({ density: density.id })}
                    >
                      <LayoutGrid />
                      <strong>{density.label}</strong>
                      <small>{density.detail}</small>
                    </button>
                  ))}
                </div>
                <span className="setting-label">Chat key colors</span>
                <div className="agent-color-list">
                  {agents.map((agent) => (
                    <div className="agent-color-row" key={agent.id}>
                      <span>{agent.name}</span>
                      <div className="mini-swatches">
                        {CARD_COLORS.map((color) => (
                          <button
                            key={color}
                            className={
                              preferences.agentColors[agent.id] === color ? 'selected' : ''
                            }
                            style={{ backgroundColor: color }}
                            onClick={() =>
                              patch({
                                agentColors: { ...preferences.agentColors, [agent.id]: color },
                              })
                            }
                            aria-label={`Set ${agent.name} card to ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <h3>Command controls</h3>
                <p className="setting-note">Choose which controls appear on the mounted surface.</p>
                <div className="toggle-grid">
                  {(Object.keys(CONTROL_LABELS) as ControlKey[]).map((control) => (
                    <button
                      key={control}
                      className={!preferences.hiddenControls[control] ? 'selected' : ''}
                      onClick={() => toggleControl(control)}
                    >
                      <span>{CONTROL_LABELS[control]}</span>
                      <span className="switch-dot" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <h3>Saved layouts</h3>
                <div className="save-layout-row">
                  <input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Desk setup"
                    maxLength={40}
                  />
                  <button
                    className="save-layout-button"
                    onClick={() => {
                      saveProfile(profileName);
                      setProfileName('');
                      haptic([8, 20, 12]);
                    }}
                  >
                    <Save /> Save
                  </button>
                </div>
                <div className="saved-layouts">
                  {preferences.profiles.length === 0 ? (
                    <p className="empty-copy">Save this arrangement for quick recall.</p>
                  ) : (
                    preferences.profiles.map((profile) => (
                      <div key={profile.id}>
                        <button onClick={() => loadProfile(profile.id)}>
                          <strong>{profile.name}</strong>
                          <small>{new Date(profile.createdAt).toLocaleDateString()}</small>
                        </button>
                        <button
                          onClick={() => deleteProfile(profile.id)}
                          aria-label={`Delete ${profile.name}`}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
