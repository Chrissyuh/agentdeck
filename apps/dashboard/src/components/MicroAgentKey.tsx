import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { motion } from 'framer-motion';
import { Link2, Plus } from 'lucide-react';
import type { Agent } from '@agentdeck/protocol';
import { formatElapsed, STATUS_META } from '@agentdeck/shared';
import { haptic } from '../hooks';

interface MicroAgentKeyProps {
  agent?: Agent;
  slot: number;
  selected: boolean;
  now: number;
  color?: string;
  onSelect(): void;
  onAssign(): void;
  onReassign(): void;
}

export function MicroAgentKey({
  agent,
  slot,
  selected,
  now,
  color,
  onSelect,
  onAssign,
  onReassign,
}: MicroAgentKeyProps) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const clearHold = (): void => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const beginHold = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!agent) return;
    held.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      haptic([8, 20, 12]);
      onReassign();
    }, 520);
  };

  if (!agent) {
    return (
      <button
        type="button"
        className="chat-key chat-key-empty"
        onClick={onAssign}
        aria-label={`Assign a chat to key ${slot + 1}`}
      >
        <span className="chat-key-number">{String(slot + 1).padStart(2, '0')}</span>
        <Plus aria-hidden="true" />
        <strong>Map chat</strong>
      </button>
    );
  }

  const meta = STATUS_META[agent.status];
  const keyColor = color ?? meta.color;
  const style = {
    '--key-color': keyColor,
    '--key-glow': color ? `${color}42` : meta.glow,
  } as CSSProperties;

  return (
    <motion.button
      type="button"
      className={`chat-key ${selected ? 'selected' : ''}`}
      style={style}
      whileTap={{ scale: 0.97 }}
      onPointerDown={beginHold}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onContextMenu={(event) => {
        event.preventDefault();
        onReassign();
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        haptic(8);
        onSelect();
      }}
      aria-pressed={selected}
      aria-label={`${agent.name}, ${meta.label}, key ${slot + 1}. Hold to remap.`}
    >
      <span className="chat-key-number">{String(slot + 1).padStart(2, '0')}</span>
      <span className="chat-key-project">{agent.projectName}</span>
      <strong>{agent.name}</strong>
      <span className="chat-key-footer">
        <i />
        {meta.label}
        <time>{formatElapsed(agent.startedAt, now)}</time>
      </span>
      <Link2 className="chat-key-link" aria-hidden="true" />
    </motion.button>
  );
}
