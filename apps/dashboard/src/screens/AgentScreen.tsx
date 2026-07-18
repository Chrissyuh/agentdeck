import { useCallback, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  MessageSquareText,
  Mic,
  Pause,
  Play,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Agent } from '@agentdeck/protocol';
import type { AgentDeckActions, AgentDeckSnapshot } from '@agentdeck/client';
import { formatElapsed, shortTime, STATUS_META } from '@agentdeck/shared';
import type { PreferencesController } from '../preferences';
import { haptic, useClock, useVoiceInput } from '../hooks';
import { ConnectionBadge, HoldButton, StatusOrb, TactileButton } from '../components/controls';

interface AgentScreenProps {
  agent: Agent;
  snapshot: AgentDeckSnapshot;
  actions: AgentDeckActions;
  preferences: PreferencesController;
  onBack: () => void;
}

export function AgentScreen({ agent, snapshot, actions, preferences, onBack }: AgentScreenProps) {
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const now = useClock();
  const statusMeta = STATUS_META[agent.status];
  const hidden = preferences.preferences.hiddenControls;

  const run = useCallback(async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      setFeedback(label);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The command failed');
    }
  }, []);

  const sendDirection = useCallback(
    async (text: string): Promise<void> => {
      const clean = text.trim();
      if (!clean) return;
      await run('Direction sent', () => actions.sendMessage(agent.id, clean));
      setMessage('');
      setComposerOpen(false);
    },
    [actions, agent.id, run],
  );

  const voice = useVoiceInput((transcript) => {
    setMessage(transcript);
    setComposerOpen(true);
    haptic([8, 18, 12]);
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void sendDirection(message);
  };

  const interruptible = ['thinking', 'working', 'awaiting_approval'].includes(agent.status);

  return (
    <motion.main
      className="agent-screen"
      initial={{ opacity: 0, x: 35 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 35 }}
      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      style={
        {
          '--agent-color': statusMeta.color,
          '--agent-glow': statusMeta.glow,
        } as React.CSSProperties
      }
    >
      <header className="agent-header">
        <button className="back-button" onClick={onBack} aria-label="Back to agents">
          <ArrowLeft />
        </button>
        <div className="agent-title-block">
          <StatusOrb status={agent.status} />
          <div>
            <span>{agent.projectName}</span>
            <h1>{agent.name}</h1>
          </div>
        </div>
        <div className="agent-header-meta">
          <div className="header-runtime">
            <span>Runtime</span>
            <strong>{formatElapsed(agent.startedAt, now)}</strong>
          </div>
          <ConnectionBadge status={snapshot.status} latency={snapshot.latencyMs} />
        </div>
      </header>

      <div className="agent-workspace">
        <section className="operation-column">
          <div className="operation-panel">
            <span className="panel-kicker">Current operation</span>
            <div className="operation-title">
              {STATUS_META[agent.status].active ? (
                <span className="operation-wave">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <CircleStop />
              )}
              <h2>{agent.currentOperation ?? statusMeta.label}</h2>
            </div>
            <div className="operation-meta">
              <span>{statusMeta.label}</span>
              <span>Updated {shortTime(agent.updatedAt)}</span>
            </div>
          </div>

          {agent.pendingApproval ? (
            <motion.div
              className="approval-panel"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              layout
            >
              <div className="approval-icon">
                <ShieldCheck />
              </div>
              <div>
                <span className="panel-kicker">
                  {agent.pendingApproval.risk} risk · decision required
                </span>
                <h3>{agent.pendingApproval.title}</h3>
                <p>{agent.pendingApproval.description}</p>
              </div>
            </motion.div>
          ) : null}

          <div className={`latest-message-panel ${agent.pendingApproval ? '' : 'is-wide'}`}>
            <span className="panel-kicker">Latest message</span>
            <p>{agent.latestMessage ?? 'No messages yet.'}</p>
          </div>

          <section className="event-strip" aria-label="Recent events">
            <div className="event-heading">
              <span className="panel-kicker">Recent events</span>
              <span>{agent.events.length} recorded</span>
            </div>
            <div className="event-list">
              {[...agent.events]
                .reverse()
                .slice(0, 4)
                .map((event) => (
                  <div className={`event-item event-${event.kind}`} key={event.id}>
                    <span className="event-node" />
                    <div>
                      <strong>{event.title}</strong>
                      {event.detail ? <p>{event.detail}</p> : null}
                    </div>
                    <time>{shortTime(event.timestamp)}</time>
                  </div>
                ))}
            </div>
          </section>
        </section>

        <section className="control-column" aria-label="Agent controls">
          <span className="panel-kicker control-kicker">Controls</span>
          <div className="control-grid">
            {!hidden.approve ? (
              <TactileButton
                icon={Check}
                label="Approve"
                detail={agent.pendingApproval ? 'Allow operation' : 'No request'}
                tone="success"
                disabled={!agent.pendingApproval}
                onClick={() => void run('Approved', () => actions.approve(agent.id))}
              />
            ) : null}
            {!hidden.reject ? (
              <HoldButton
                icon={X}
                label="Reject"
                detail={agent.pendingApproval ? 'Deny operation' : 'No request'}
                tone="danger"
                disabled={!agent.pendingApproval}
                onConfirm={() => run('Rejected', () => actions.reject(agent.id))}
              />
            ) : null}
            {!hidden.interrupt ? (
              <HoldButton
                icon={Pause}
                label="Interrupt"
                detail="Stop safely"
                tone="warning"
                disabled={!interruptible}
                onConfirm={() => run('Interrupted', () => actions.interrupt(agent.id))}
              />
            ) : null}
            {!hidden.continue ? (
              <TactileButton
                icon={Play}
                label="Continue"
                detail="Resume work"
                tone="accent"
                onClick={() => void sendDirection('Continue from where you stopped.')}
              />
            ) : null}
            {!hidden.send ? (
              <TactileButton
                icon={Send}
                label="Send"
                detail="Give direction"
                tone="accent"
                onClick={() => setComposerOpen(true)}
              />
            ) : null}
            {!hidden.voice ? (
              <TactileButton
                icon={Mic}
                label={voice.listening ? 'Recording…' : 'Voice'}
                detail={
                  voice.supported
                    ? voice.listening
                      ? 'Tap to use note'
                      : 'Record locally'
                    : 'Simulate note'
                }
                className={voice.listening ? 'is-listening' : ''}
                onClick={() => {
                  if (!voice.start()) {
                    void run('Voice note sent (mock)', () =>
                      actions.sendMessage(
                        agent.id,
                        'Voice direction (simulated by the local mock provider).',
                      ),
                    );
                  }
                }}
              />
            ) : null}
            {!hidden.reasoning ? (
              <TactileButton
                icon={BrainCircuit}
                label="Reasoning"
                detail="Set effort"
                onClick={() => setReasoningOpen(true)}
              />
            ) : null}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {feedback ? (
          <motion.button
            className="toast"
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 25 }}
            onClick={() => setFeedback(null)}
          >
            {feedback} <X />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {composerOpen ? (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              className="bottom-sheet composer-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Send direction to ${agent.name}`}
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onSubmit={submit}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">Direction to {agent.name}</span>
                  <h2>Send a message</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setComposerOpen(false)}
                >
                  <X />
                </button>
              </div>
              <div className="composer-input">
                <MessageSquareText />
                <textarea
                  autoFocus
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Give concise direction…"
                  maxLength={4000}
                  rows={3}
                />
                <button type="submit" disabled={!message.trim()}>
                  <Send /> Send
                </button>
              </div>
            </motion.form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {reasoningOpen ? (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.section
              className="bottom-sheet reasoning-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Reasoning effort"
              initial={{ y: '105%' }}
              animate={{ y: 0 }}
              exit={{ y: '105%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              <div className="sheet-header">
                <div>
                  <span className="eyebrow">Agent direction</span>
                  <h2>Reasoning effort</h2>
                </div>
                <button className="icon-button" onClick={() => setReasoningOpen(false)}>
                  <X />
                </button>
              </div>
              <div className="reasoning-options">
                {[
                  ['Quick', 'Optimize for speed and short answers.'],
                  ['Standard', 'Balance depth, speed, and tool use.'],
                  ['Deep', 'Think through complex tradeoffs carefully.'],
                ].map(([label, detail]) => (
                  <button
                    key={label}
                    onClick={() => {
                      void sendDirection(
                        `Use ${label?.toLowerCase()} reasoning effort for the next operation.`,
                      );
                      setReasoningOpen(false);
                    }}
                  >
                    <BrainCircuit />
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.main>
  );
}
