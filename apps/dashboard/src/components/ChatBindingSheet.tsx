import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Link2, Plus, Unlink, X } from 'lucide-react';
import type { Agent } from '@agentdeck/protocol';
import { STATUS_META } from '@agentdeck/shared';
import { haptic } from '../hooks';

interface ChatBindingSheetProps {
  open: boolean;
  initialSlot: number;
  agents: Agent[];
  providerName: string | null;
  slots: Array<string | null>;
  onChange(slots: Array<string | null>): void;
  onCreate(slot: number): void;
  onClose(): void;
}

export function ChatBindingSheet({
  open,
  initialSlot,
  agents,
  providerName,
  slots,
  onChange,
  onCreate,
  onClose,
}: ChatBindingSheetProps) {
  const [activeSlot, setActiveSlot] = useState(initialSlot);
  const providerLabel = providerName ?? 'Agent';

  useEffect(() => {
    if (open) setActiveSlot(initialSlot);
  }, [initialSlot, open]);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const normalizedSlots = Array.from({ length: 6 }, (_, index) => slots[index] ?? null);

  const bind = (agentId: string): void => {
    const next = [...normalizedSlots];
    const previousSlot = next.indexOf(agentId);
    const displaced = next[activeSlot] ?? null;
    next[activeSlot] = agentId;
    if (previousSlot >= 0 && previousSlot !== activeSlot) next[previousSlot] = displaced;
    onChange(next);
    haptic([8, 18, 12]);
  };

  const clear = (): void => {
    const next = [...normalizedSlots];
    next[activeSlot] = null;
    onChange(next);
    haptic(10);
  };

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
            className="bottom-sheet binding-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Map chats to physical buttons"
            initial={{ y: '105%' }}
            animate={{ y: 0 }}
            exit={{ y: '105%' }}
            transition={{ type: 'spring', stiffness: 330, damping: 36 }}
          >
            <div className="binding-heading">
              <div>
                <span>BUTTON MAP</span>
                <h2>Tie chats to keys</h2>
                <p>Choose a key, then choose the {providerLabel} task it should control.</p>
              </div>
              <button onClick={onClose} aria-label="Close button mapping">
                <X />
              </button>
            </div>

            <div className="binding-body">
              <div className="binding-slots" aria-label="Physical chat keys">
                {normalizedSlots.map((agentId, index) => {
                  const agent = agentId ? agentById.get(agentId) : undefined;
                  return (
                    <button
                      key={index}
                      className={activeSlot === index ? 'selected' : ''}
                      onClick={() => setActiveSlot(index)}
                    >
                      <small>KEY {String(index + 1).padStart(2, '0')}</small>
                      <strong>{agent?.name ?? 'Unassigned'}</strong>
                      {activeSlot === index ? <Check /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="binding-chat-list">
                <div className="binding-list-label">
                  <span>AVAILABLE CHATS</span>
                  <button onClick={() => onCreate(activeSlot)}>
                    <Plus /> New {providerLabel} task
                  </button>
                </div>
                {agents.map((agent) => {
                  const boundSlot = normalizedSlots.indexOf(agent.id);
                  const meta = STATUS_META[agent.status];
                  return (
                    <button
                      key={agent.id}
                      className={boundSlot === activeSlot ? 'selected' : ''}
                      onClick={() => bind(agent.id)}
                    >
                      <span className="binding-status" style={{ background: meta.color }} />
                      <span>
                        <small>{agent.projectName}</small>
                        <strong>{agent.name}</strong>
                      </span>
                      <em>
                        {boundSlot >= 0
                          ? `KEY ${String(boundSlot + 1).padStart(2, '0')}`
                          : 'UNBOUND'}
                      </em>
                      <Link2 />
                    </button>
                  );
                })}
                {normalizedSlots[activeSlot] ? (
                  <button className="binding-clear" onClick={clear}>
                    <Unlink /> Clear key {String(activeSlot + 1).padStart(2, '0')}
                  </button>
                ) : null}
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
