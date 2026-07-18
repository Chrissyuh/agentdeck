import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { useClock } from '../hooks';

export function AmbientScreen({ agentCount, onWake }: { agentCount: number; onWake(): void }) {
  const now = useClock(1_000);
  const date = new Date(now);
  return (
    <motion.button
      className="ambient-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2 }}
      onClick={onWake}
      aria-label="Wake AgentDeck"
    >
      <span className="ambient-orb">
        <MoonStar />
      </span>
      <time>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
      <span>{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      <small>All {agentCount} agents are quiet · tap to wake</small>
    </motion.button>
  );
}
