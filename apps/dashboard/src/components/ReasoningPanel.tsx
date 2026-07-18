import { motion } from 'framer-motion';
import { BrainCircuit } from 'lucide-react';
import { REASONING_LEVELS, REASONING_META, type ReasoningLevel } from '../reasoning';

interface ReasoningPanelProps {
  level: ReasoningLevel;
  chatTitle: string;
}

export function ReasoningPanel({ level, chatTitle }: ReasoningPanelProps) {
  const selectedIndex = REASONING_LEVELS.indexOf(level);
  const meta = REASONING_META[level];

  return (
    <motion.section
      className="reasoning-panel"
      data-level={level}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      aria-live="polite"
    >
      <span className="reasoning-panel-kicker">Drag to set · release to commit</span>
      <div className="reasoning-glyph" aria-hidden="true">
        <BrainCircuit />
        <span>{String(selectedIndex + 1).padStart(2, '0')}</span>
      </div>
      <div className="reasoning-panel-copy">
        <small>{chatTitle}</small>
        <strong>{meta.label}</strong>
        <p>{meta.detail}</p>
      </div>
      <div className="reasoning-spectrum" aria-hidden="true">
        {REASONING_LEVELS.map((candidate, index) => (
          <i key={candidate} className={index <= selectedIndex ? 'lit' : ''} />
        ))}
      </div>
    </motion.section>
  );
}
