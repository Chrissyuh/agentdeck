import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Grip, Plus } from 'lucide-react';
import type { Agent } from '@agentdeck/protocol';
import { formatElapsed, STATUS_META } from '@agentdeck/shared';
import { StatusOrb } from './controls';
import { haptic } from '../hooks';

interface MicroAgentKeyProps {
  agent?: Agent;
  slot: number;
  selected: boolean;
  arranging: boolean;
  now: number;
  color?: string;
  onSelect(): void;
  onCreate(): void;
}

export function MicroAgentKey({
  agent,
  slot,
  selected,
  arranging,
  now,
  color,
  onSelect,
  onCreate,
}: MicroAgentKeyProps) {
  const sortableId = agent?.id ?? `empty-${slot}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled: !agent || !arranging,
  });

  if (!agent) {
    return (
      <button
        className="micro-agent-key empty-key"
        onClick={onCreate}
        aria-label={`Create agent in slot ${slot + 1}`}
      >
        <Plus />
        <span>Empty slot</span>
      </button>
    );
  }

  const meta = STATUS_META[agent.status];
  const keyColor = color ?? meta.color;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    '--key-color': keyColor,
    '--key-glow': color ? `${color}38` : meta.glow,
    zIndex: isDragging ? 20 : undefined,
  } as CSSProperties;

  return (
    <motion.button
      ref={setNodeRef}
      layout
      type="button"
      className={`micro-agent-key ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      {...(arranging ? { ...attributes, ...listeners } : {})}
      style={style}
      whileTap={arranging ? undefined : { scale: 0.975, y: 1 }}
      onClick={() => {
        haptic(8);
        onSelect();
      }}
      aria-pressed={selected}
      aria-label={`${agent.name}, ${meta.label}, slot ${slot + 1}`}
    >
      <span className="micro-key-light">
        <StatusOrb status={agent.status} />
      </span>
      <span className="micro-key-copy">
        <small>{agent.projectName}</small>
        <strong>{agent.name}</strong>
        <span>{meta.label}</span>
      </span>
      <time>{formatElapsed(agent.startedAt, now)}</time>
      {arranging ? <Grip className="micro-key-grip" /> : null}
    </motion.button>
  );
}
