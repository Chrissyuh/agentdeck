import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BellRing,
  Bolt,
  BrainCircuit,
  Check,
  ChevronRight,
  Ellipsis,
  Grip,
  Mic,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Settings2,
  X,
} from 'lucide-react';
import type { AgentDeckActions, AgentDeckSnapshot } from '@agentdeck/client';
import { formatElapsed, STATUS_META } from '@agentdeck/shared';
import type { PreferencesController } from '../preferences';
import { haptic, useClock, useVoiceInput } from '../hooks';
import { ConnectionBadge, HoldButton, StatusOrb, TactileButton } from '../components/controls';
import { MicroAgentKey } from '../components/MicroAgentKey';
import { CustomizeSheet } from '../components/CustomizeSheet';
import { CreateAgentSheet } from '../components/CreateAgentSheet';

interface HomeScreenProps {
  snapshot: AgentDeckSnapshot;
  actions: AgentDeckActions;
  preferences: PreferencesController;
  mountedDisplay: { enabled: boolean; toggle(): Promise<void> };
  onOpenAgent(agentId: string): void;
}

const SKILLS = [
  { name: 'Review a PR', detail: 'Inspect the current change and report actionable findings.' },
  {
    name: 'Debug an error',
    detail: 'Reproduce the latest failure, identify its cause, and propose a fix.',
  },
  {
    name: 'Refactor code',
    detail: 'Find the highest-value structural improvement without changing behavior.',
  },
  { name: 'Run verification', detail: 'Run the relevant checks and summarize any failures.' },
] as const;

export function HomeScreen({
  snapshot,
  actions,
  preferences,
  mountedDisplay,
  onOpenAgent,
}: HomeScreenProps) {
  const [arranging, setArranging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const now = useClock();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const orderedAgents = useMemo(() => {
    const indices = new Map(preferences.preferences.order.map((id, index) => [id, index]));
    return [...snapshot.agents].sort((a, b) => {
      const aIndex = indices.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = indices.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [preferences.preferences.order, snapshot.agents]);

  const visibleAgents = orderedAgents.slice(0, 6);
  const attentionAgents = orderedAgents.filter((agent) =>
    ['awaiting_approval', 'error'].includes(agent.status),
  );
  const selectedAgent =
    orderedAgents.find((agent) => agent.id === selectedId) ??
    attentionAgents[0] ??
    orderedAgents[0];
  const hidden = preferences.preferences.hiddenControls;

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

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const ids = orderedAgents.map((agent) => agent.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    preferences.patch({ order: arrayMove(ids, from, to) });
    haptic(12);
  };

  const sendReasoning = (): void => {
    if (!selectedAgent) return;
    const label = ['quick', 'standard', 'deep'][reasoning] ?? 'standard';
    void run(`${label[0]?.toUpperCase()}${label.slice(1)} reasoning`, () =>
      actions.sendMessage(
        selectedAgent.id,
        `Use ${label} reasoning effort for the next operation.`,
      ),
    );
  };

  const slots = Array.from({ length: 6 }, (_, index) => visibleAgents[index]);
  const sortableIds = slots.map((agent, index) => agent?.id ?? `empty-${index}`);
  const statusMeta = selectedAgent ? STATUS_META[selectedAgent.status] : null;
  const interruptible = selectedAgent
    ? ['thinking', 'working', 'awaiting_approval'].includes(selectedAgent.status)
    : false;

  return (
    <motion.main
      className="home-screen micro-home"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <header className="deck-header micro-header">
        <div className="brand-lockup">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>AgentDeck</h1>
            <span>Micro surface</span>
          </div>
        </div>
        <div className="header-actions">
          {attentionAgents.length > 0 ? (
            <button
              className="attention-button"
              onClick={() => setSelectedId(attentionAgents[0]?.id ?? null)}
            >
              <BellRing />
              <span>
                {attentionAgents.length === 1
                  ? '1 needs attention'
                  : `${attentionAgents.length} need attention`}
              </span>
            </button>
          ) : null}
          <ConnectionBadge status={snapshot.status} latency={snapshot.latencyMs} />
          <button
            className="header-button header-menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Deck menu"
          >
            <Ellipsis />
          </button>
        </div>
      </header>

      <div className="micro-surface">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <section
              className={`micro-agent-grid micro-layout-${preferences.preferences.density}`}
              aria-label="Six agent keys"
            >
              {slots.map((agent, index) => (
                <MicroAgentKey
                  key={agent?.id ?? `empty-${index}`}
                  agent={agent}
                  slot={index}
                  selected={agent?.id === selectedAgent?.id}
                  arranging={arranging}
                  now={now}
                  color={agent ? preferences.preferences.agentColors[agent.id] : undefined}
                  onSelect={() => setSelectedId(agent?.id ?? null)}
                  onCreate={() => setCreateOpen(true)}
                />
              ))}
            </section>
          </SortableContext>
        </DndContext>

        <section className="micro-console" aria-label="Selected agent controls">
          {selectedAgent && statusMeta ? (
            <>
              <button className="micro-selected" onClick={() => onOpenAgent(selectedAgent.id)}>
                <StatusOrb status={selectedAgent.status} />
                <span>
                  <small>{selectedAgent.projectName}</small>
                  <strong>{selectedAgent.name}</strong>
                </span>
                <span className="micro-selected-status">
                  {statusMeta.label}
                  <ChevronRight />
                </span>
              </button>

              <div className="micro-readout">
                <div>
                  <span>Now</span>
                  <strong>{selectedAgent.currentOperation ?? statusMeta.label}</strong>
                </div>
                <time>{formatElapsed(selectedAgent.startedAt, now)}</time>
                <p>{selectedAgent.latestMessage ?? 'Ready for direction.'}</p>
              </div>

              {selectedAgent.pendingApproval ? (
                <div className="micro-approval">
                  <BellRing />
                  <span>
                    <strong>{selectedAgent.pendingApproval.title}</strong>
                    <small>{selectedAgent.pendingApproval.description}</small>
                  </span>
                </div>
              ) : null}

              <div className="micro-command-grid">
                <TactileButton
                  icon={Bolt}
                  label="Skills"
                  detail="Launch workflow"
                  onClick={() => setSkillsOpen(true)}
                />
                {!hidden.approve ? (
                  <TactileButton
                    icon={Check}
                    label="Approve"
                    detail="Accept request"
                    tone="success"
                    disabled={!selectedAgent.pendingApproval}
                    onClick={() => void run('Approved', () => actions.approve(selectedAgent.id))}
                  />
                ) : null}
                {!hidden.reject ? (
                  <HoldButton
                    icon={X}
                    label="Reject"
                    detail="Deny request"
                    tone="danger"
                    disabled={!selectedAgent.pendingApproval}
                    onConfirm={() => run('Rejected', () => actions.reject(selectedAgent.id))}
                  />
                ) : null}
                {!hidden.interrupt ? (
                  <HoldButton
                    icon={Pause}
                    label="Interrupt"
                    detail="Stop safely"
                    tone="warning"
                    disabled={!interruptible}
                    onConfirm={() => run('Interrupted', () => actions.interrupt(selectedAgent.id))}
                  />
                ) : null}
                {!hidden.continue ? (
                  <TactileButton
                    icon={Play}
                    label="Continue"
                    detail="Resume work"
                    tone="accent"
                    onClick={() =>
                      void run('Continued', () =>
                        actions.sendMessage(selectedAgent.id, 'Continue from where you stopped.'),
                      )
                    }
                  />
                ) : null}
                {!hidden.voice ? (
                  <TactileButton
                    icon={Mic}
                    label={voice.listening ? 'Recording…' : 'Voice'}
                    detail={
                      voice.supported
                        ? voice.listening
                          ? 'Tap to send'
                          : 'Push to talk'
                        : 'Simulate note'
                    }
                    className={voice.listening ? 'is-listening' : ''}
                    onClick={() => {
                      if (!voice.start()) {
                        void run('Voice note sent (mock)', () =>
                          actions.sendMessage(
                            selectedAgent.id,
                            'Voice direction (simulated by the local mock provider).',
                          ),
                        );
                      }
                    }}
                  />
                ) : null}
              </div>

              {!hidden.reasoning ? (
                <div className="micro-reasoning">
                  <BrainCircuit />
                  <span>
                    <strong>Reasoning</strong>
                    <small>{['Quick', 'Standard', 'Deep'][reasoning]}</small>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="1"
                    value={reasoning}
                    onChange={(event) => setReasoning(Number(event.target.value))}
                    onPointerUp={sendReasoning}
                    aria-label="Reasoning effort"
                  />
                </div>
              ) : null}
            </>
          ) : (
            <button className="micro-empty-console" onClick={() => setCreateOpen(true)}>
              <Plus /> Spawn your first agent
            </button>
          )}
        </section>
      </div>

      {arranging ? (
        <div className="arrange-hint">
          <Grip /> Drag agent keys into position
        </div>
      ) : null}

      <AnimatePresence>
        {feedback ? (
          <motion.button
            className="toast"
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={() => setFeedback(null)}
          >
            {feedback} <X />
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
              className="bottom-sheet skill-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Launch a skill"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">Instant workflow</span>
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
                    <ChevronRight />
                  </button>
                ))}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="bottom-sheet deck-menu-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Deck menu"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">AgentDeck</span>
                  <h2>Deck controls</h2>
                </div>
                <button className="icon-button" onClick={() => setMenuOpen(false)}>
                  <X />
                </button>
              </div>
              <div className="deck-menu-grid">
                <button
                  className={mountedDisplay.enabled ? 'selected' : ''}
                  onClick={() => {
                    void mountedDisplay.toggle();
                    setMenuOpen(false);
                  }}
                >
                  <MonitorUp />
                  <span>
                    <strong>{mountedDisplay.enabled ? 'Mounted mode on' : 'Mounted mode'}</strong>
                    <small>Fullscreen while agents are active</small>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setArranging((value) => !value);
                    setMenuOpen(false);
                  }}
                >
                  <Grip />
                  <span>
                    <strong>{arranging ? 'Finish arranging' : 'Arrange agent keys'}</strong>
                    <small>Match your physical workspace</small>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setCreateOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <Plus />
                  <span>
                    <strong>New mock agent</strong>
                    <small>Spawn another simulated task</small>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <Settings2 />
                  <span>
                    <strong>Customize</strong>
                    <small>Colors, controls, size, and layouts</small>
                  </span>
                </button>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CustomizeSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        agents={snapshot.agents}
        controller={preferences}
      />
      <CreateAgentSheet open={createOpen} onClose={() => setCreateOpen(false)} actions={actions} />
    </motion.main>
  );
}
