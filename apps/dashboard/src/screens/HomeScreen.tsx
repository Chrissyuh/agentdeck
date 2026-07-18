import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bolt,
  Check,
  Link2,
  Mic,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Send,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { AgentDeckActions, AgentDeckSnapshot } from '@agentdeck/client';
import { formatElapsed, STATUS_META } from '@agentdeck/shared';
import type { PreferencesController } from '../preferences';
import { REASONING_LEVELS, REASONING_META, type ReasoningLevel } from '../reasoning';
import { haptic, useClock, useVoiceInput } from '../hooks';
import { ChatBindingSheet } from '../components/ChatBindingSheet';
import { ConsoleButton } from '../components/ConsoleButton';
import { MicroAgentKey } from '../components/MicroAgentKey';
import { ReasoningPanel } from '../components/ReasoningPanel';
import { CustomizeSheet } from '../components/CustomizeSheet';
import { CreateAgentSheet } from '../components/CreateAgentSheet';

interface HomeScreenProps {
  snapshot: AgentDeckSnapshot;
  actions: AgentDeckActions;
  preferences: PreferencesController;
  mountedDisplay: { enabled: boolean; toggle(): Promise<void> };
  onOpenAgent(agentId: string, compose?: boolean): void;
}

interface ReasoningGesture {
  pointerId: number;
  previewIndex: number;
}

interface CreateTarget {
  slot: number;
  knownAgentIds: string[];
}

const SKILLS = [
  { name: 'Review a PR', detail: 'Inspect the current change and report actionable findings.' },
  {
    name: 'Debug an error',
    detail: 'Reproduce the latest failure, identify its cause, and fix it.',
  },
  { name: 'Refactor code', detail: 'Improve the structure without changing behavior.' },
  { name: 'Run verification', detail: 'Run the relevant checks and report every failure.' },
] as const;

export function HomeScreen({
  snapshot,
  actions,
  preferences,
  mountedDisplay,
  onOpenAgent,
}: HomeScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingSlot, setBindingSlot] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reasoningGesture, setReasoningGesture] = useState<ReasoningGesture | null>(null);
  const reasoningPreview = useRef(0);
  const now = useClock();
  const { preferences: settings, patch } = preferences;

  const agentById = useMemo(
    () => new Map(snapshot.agents.map((agent) => [agent.id, agent])),
    [snapshot.agents],
  );
  const slots = useMemo(
    () => Array.from({ length: 6 }, (_, index) => settings.slots[index] ?? null),
    [settings.slots],
  );

  useEffect(() => {
    if (snapshot.status !== 'connected' || snapshot.agents.length === 0) return;

    const validIds = new Set(snapshot.agents.map((agent) => agent.id));
    const sanitized = slots.map((id) => (id && validIds.has(id) ? id : null));
    const nextSlots = sanitized.some(Boolean)
      ? sanitized
      : [...snapshot.agents.slice(0, 4).map((agent) => agent.id), null, null];

    if (nextSlots.some((id, index) => id !== slots[index])) patch({ slots: nextSlots });
  }, [patch, slots, snapshot.agents, snapshot.status]);
  const slotAgents = slots.map((id) => (id ? agentById.get(id) : undefined));
  const boundAgents = slotAgents.filter((agent) => agent !== undefined);
  const attentionAgents = boundAgents.filter((agent) =>
    ['awaiting_approval', 'error'].includes(agent.status),
  );
  const selectedAgent =
    boundAgents.find((agent) => agent.id === selectedId) ?? attentionAgents[0] ?? boundAgents[0];
  const selectedSlot = selectedAgent ? slots.indexOf(selectedAgent.id) : -1;
  const statusMeta = selectedAgent ? STATUS_META[selectedAgent.status] : null;
  const hidden = settings.hiddenControls;
  const interruptible = selectedAgent
    ? ['thinking', 'working', 'awaiting_approval'].includes(selectedAgent.status)
    : false;
  const reasoningLevel: ReasoningLevel = selectedAgent
    ? (settings.reasoningByAgent[selectedAgent.id] ?? 'medium')
    : 'medium';
  const reasoningIndex = REASONING_LEVELS.indexOf(reasoningLevel);
  const previewLevel =
    REASONING_LEVELS[reasoningGesture?.previewIndex ?? reasoningIndex] ?? reasoningLevel;

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      setFeedback(label);
      haptic([8, 18, 12]);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The command failed');
    }
  };

  const voice = useVoiceInput((transcript) => {
    if (selectedAgent)
      void run('Voice direction sent', () => actions.sendMessage(selectedAgent.id, transcript));
  });

  const openBinding = (slot = Math.max(0, selectedSlot)): void => {
    setBindingSlot(slot);
    setBindingOpen(true);
    setDeckOpen(false);
  };

  const openCreate = (slot?: number): void => {
    setCreateTarget(
      slot === undefined ? null : { slot, knownAgentIds: snapshot.agents.map((agent) => agent.id) },
    );
    setCreateOpen(true);
  };

  useEffect(() => {
    if (!createTarget) return;
    const createdAgent = snapshot.agents.find(
      (agent) => !createTarget.knownAgentIds.includes(agent.id),
    );
    if (!createdAgent) return;

    const nextSlots = [...slots];
    nextSlots[createTarget.slot] = createdAgent.id;
    patch({ slots: nextSlots });
    setSelectedId(createdAgent.id);
    setFeedback(`New chat mapped to key ${String(createTarget.slot + 1).padStart(2, '0')}`);
    setCreateTarget(null);
  }, [createTarget, patch, slots, snapshot.agents]);

  const commitReasoning = (level: ReasoningLevel): void => {
    if (!selectedAgent || level === reasoningLevel) return;
    patch({
      reasoningByAgent: { ...settings.reasoningByAgent, [selectedAgent.id]: level },
    });
    const label = REASONING_META[level].label;
    void run(`${label} reasoning set`, () =>
      actions.sendMessage(
        selectedAgent.id,
        `Use ${level} reasoning effort for the next operation.`,
      ),
    );
  };

  const beginReasoning = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!selectedAgent) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    reasoningPreview.current = reasoningIndex;
    setReasoningGesture({
      pointerId: event.pointerId,
      previewIndex: reasoningIndex,
    });
    haptic(7);
  };

  const dragReasoning = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!reasoningGesture || event.pointerId !== reasoningGesture.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const previewIndex = Math.round(ratio * (REASONING_LEVELS.length - 1));
    if (previewIndex === reasoningPreview.current) return;
    reasoningPreview.current = previewIndex;
    setReasoningGesture({ ...reasoningGesture, previewIndex });
    haptic(5);
  };

  const releaseReasoning = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!reasoningGesture || event.pointerId !== reasoningGesture.pointerId) return;
    const next = REASONING_LEVELS[reasoningPreview.current] ?? reasoningLevel;
    setReasoningGesture(null);
    commitReasoning(next);
  };

  const adjustReasoningFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!selectedAgent || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? REASONING_LEVELS.length - 1
          : Math.max(
              0,
              Math.min(
                REASONING_LEVELS.length - 1,
                reasoningIndex + (event.key === 'ArrowRight' ? 1 : -1),
              ),
            );
    commitReasoning(REASONING_LEVELS[nextIndex] ?? reasoningLevel);
  };

  return (
    <motion.main
      className="home-screen deck-v2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="deck-shell">
        <section className="command-bay" aria-label="Command controls">
          {selectedAgent && statusMeta ? (
            <button className="console-readout" onClick={() => onOpenAgent(selectedAgent.id)}>
              <span className="readout-project">{selectedAgent.projectName}</span>
              <span className="readout-key">KEY {String(selectedSlot + 1).padStart(2, '0')}</span>
              <span className="readout-status" style={{ color: statusMeta.color }}>
                <i />
                {statusMeta.label}
              </span>
              <strong>{selectedAgent.name}</strong>
              <span className="readout-operation">
                {selectedAgent.currentOperation ??
                  selectedAgent.latestMessage ??
                  'Ready for direction'}
              </span>
              <time>{formatElapsed(selectedAgent.startedAt, now)}</time>
              {selectedAgent.pendingApproval ? <em>DECISION REQUIRED</em> : null}
            </button>
          ) : (
            <button className="console-readout is-empty" onClick={() => openCreate(0)}>
              <span className="readout-project">NO CHAT SELECTED</span>
              <strong>Create or map a chat</strong>
              <span className="readout-operation">
                Your command buttons will target the selected chat.
              </span>
            </button>
          )}

          <div className="console-button-grid">
            <ConsoleButton
              icon={Bolt}
              label="Skills"
              code="01"
              tone="bone"
              disabled={!selectedAgent}
              onTrigger={() => setSkillsOpen(true)}
            />
            {!hidden.approve ? (
              <ConsoleButton
                icon={Check}
                label="Approve"
                code="02"
                tone="lime"
                disabled={!selectedAgent?.pendingApproval}
                onTrigger={() =>
                  selectedAgent && void run('Approved', () => actions.approve(selectedAgent.id))
                }
              />
            ) : null}
            {!hidden.reject ? (
              <ConsoleButton
                icon={X}
                label="Reject"
                code="03"
                tone="red"
                holdMs={720}
                disabled={!selectedAgent?.pendingApproval}
                onTrigger={() =>
                  selectedAgent && void run('Rejected', () => actions.reject(selectedAgent.id))
                }
              />
            ) : null}
            {!hidden.interrupt ? (
              <ConsoleButton
                icon={Pause}
                label="Interrupt"
                code="04"
                tone="amber"
                holdMs={720}
                disabled={!interruptible}
                onTrigger={() =>
                  selectedAgent &&
                  void run('Interrupted', () => actions.interrupt(selectedAgent.id))
                }
              />
            ) : null}
            {!hidden.continue ? (
              <ConsoleButton
                icon={Play}
                label="Continue"
                code="05"
                tone="violet"
                disabled={!selectedAgent}
                onTrigger={() =>
                  selectedAgent &&
                  void run('Continued', () =>
                    actions.sendMessage(selectedAgent.id, 'Continue from where you stopped.'),
                  )
                }
              />
            ) : null}
            {!hidden.voice ? (
              <ConsoleButton
                icon={Mic}
                label={voice.listening ? 'Recording' : 'Voice'}
                code="06"
                tone="blue"
                active={voice.listening}
                disabled={!selectedAgent}
                onTrigger={() => {
                  if (!voice.start() && selectedAgent)
                    void run('Voice note sent (mock)', () =>
                      actions.sendMessage(
                        selectedAgent.id,
                        'Voice direction (simulated by the local mock provider).',
                      ),
                    );
                }}
              />
            ) : null}
            {!hidden.send ? (
              <ConsoleButton
                icon={Send}
                label="Send"
                code="07"
                tone="bone"
                disabled={!selectedAgent}
                onTrigger={() => selectedAgent && onOpenAgent(selectedAgent.id, true)}
              />
            ) : null}
            <ConsoleButton
              icon={Plus}
              label="New chat"
              code="08"
              tone="dark"
              onTrigger={() => {
                const emptySlot = slots.indexOf(null);
                openCreate(emptySlot >= 0 ? emptySlot : undefined);
              }}
            />
            <ConsoleButton
              icon={SlidersHorizontal}
              label="Deck"
              code="09"
              tone="dark"
              onTrigger={() => setDeckOpen(true)}
            />
          </div>

          {!hidden.reasoning ? (
            <button
              type="button"
              className={`reasoning-bar ${reasoningLevel === 'ultra' ? 'is-ultra' : ''}`}
              disabled={!selectedAgent}
              role="slider"
              aria-label="Reasoning effort. Hold and drag to change."
              aria-valuemin={0}
              aria-valuemax={REASONING_LEVELS.length - 1}
              aria-valuenow={reasoningIndex}
              aria-valuetext={REASONING_META[reasoningLevel].label}
              onPointerDown={beginReasoning}
              onPointerMove={dragReasoning}
              onPointerUp={releaseReasoning}
              onPointerCancel={() => setReasoningGesture(null)}
              onKeyDown={adjustReasoningFromKeyboard}
            >
              <span>REASONING</span>
              <strong>{REASONING_META[reasoningLevel].shortLabel}</strong>
              <em>HOLD + DRAG</em>
            </button>
          ) : null}
        </section>

        <section className="chat-bay" aria-label="Mapped chat keys">
          <AnimatePresence mode="wait" initial={false}>
            {reasoningGesture && selectedAgent ? (
              <ReasoningPanel key="reasoning" level={previewLevel} chatTitle={selectedAgent.name} />
            ) : (
              <motion.div
                key="chats"
                className={`chat-key-grid chat-layout-${settings.density}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {slotAgents.map((agent, index) => (
                  <MicroAgentKey
                    key={index}
                    agent={agent}
                    slot={index}
                    selected={agent?.id === selectedAgent?.id}
                    now={now}
                    color={agent ? settings.agentColors[agent.id] : undefined}
                    onSelect={() => agent && setSelectedId(agent.id)}
                    onAssign={() => openBinding(index)}
                    onReassign={() => openBinding(index)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="deck-connection" data-status={snapshot.status}>
          <i />
          <span>
            {snapshot.status === 'connected'
              ? `LAN ${snapshot.latencyMs ?? '—'}ms`
              : snapshot.status}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {feedback ? (
          <motion.button
            className="toast console-toast"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={() => setFeedback(null)}
          >
            {feedback}
            <X />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {skillsOpen ? (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="bottom-sheet skill-sheet console-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Launch a skill"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">INSTANT WORKFLOW</span>
                  <h2>Launch a skill</h2>
                </div>
                <button className="icon-button" onClick={() => setSkillsOpen(false)}>
                  <X />
                </button>
              </div>
              <div className="skill-grid">
                {SKILLS.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => {
                      if (selectedAgent)
                        void run(`${skill.name} launched`, () =>
                          actions.sendMessage(selectedAgent.id, skill.detail),
                        );
                      setSkillsOpen(false);
                    }}
                  >
                    <Bolt />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {deckOpen ? (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="bottom-sheet deck-menu-sheet console-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Deck settings"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">AD // SYSTEM</span>
                  <h2>Deck setup</h2>
                </div>
                <button className="icon-button" onClick={() => setDeckOpen(false)}>
                  <X />
                </button>
              </div>
              <div className="deck-menu-grid">
                <button onClick={() => openBinding()}>
                  <Link2 />
                  <span>
                    <strong>Map chat keys</strong>
                    <small>Tie six chats to six physical buttons</small>
                  </span>
                </button>
                <button
                  className={mountedDisplay.enabled ? 'selected' : ''}
                  onClick={() => {
                    void mountedDisplay.toggle();
                    setDeckOpen(false);
                  }}
                >
                  <MonitorUp />
                  <span>
                    <strong>{mountedDisplay.enabled ? 'Mounted mode on' : 'Mounted mode'}</strong>
                    <small>Fullscreen and wake while work is active</small>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setDeckOpen(false);
                  }}
                >
                  <Settings2 />
                  <span>
                    <strong>Customize surface</strong>
                    <small>Layout, colors, size, and visible controls</small>
                  </span>
                </button>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ChatBindingSheet
        open={bindingOpen}
        initialSlot={bindingSlot}
        agents={snapshot.agents}
        slots={slots}
        onChange={(next) => patch({ slots: next })}
        onCreate={(slot) => {
          setBindingOpen(false);
          openCreate(slot);
        }}
        onClose={() => setBindingOpen(false)}
      />
      <CustomizeSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        agents={snapshot.agents}
        controller={preferences}
      />
      <CreateAgentSheet
        open={createOpen}
        onClose={(result) => {
          setCreateOpen(false);
          if (result !== 'created') setCreateTarget(null);
        }}
        actions={actions}
      />
    </motion.main>
  );
}
