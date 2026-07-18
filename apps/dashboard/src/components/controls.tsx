import { useRef, useState, type PointerEvent } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { AgentStatus } from '@agentdeck/protocol';
import { STATUS_META } from '@agentdeck/shared';
import type { ConnectionStatus } from '@agentdeck/client';
import { haptic } from '../hooks';

interface TactileButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: LucideIcon;
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  detail?: string;
}

export function TactileButton({
  icon: Icon,
  label,
  tone = 'neutral',
  detail,
  className = '',
  onClick,
  ...props
}: TactileButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.965, y: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      className={`tactile-button tactile-${tone} ${className}`}
      onClick={(event) => {
        haptic(9);
        onClick?.(event);
      }}
      {...props}
    >
      <Icon className="control-icon" strokeWidth={1.9} aria-hidden="true" />
      <span className="control-copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </motion.button>
  );
}

interface HoldButtonProps extends Omit<TactileButtonProps, 'onClick'> {
  onConfirm: () => void | Promise<void>;
  holdMs?: number;
}

export function HoldButton({ onConfirm, holdMs = 720, ...props }: HoldButtonProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const start = (event: PointerEvent<HTMLButtonElement>): void => {
    if (props.disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    fired.current = false;
    setHolding(true);
    haptic(7);
    timer.current = setTimeout(() => {
      fired.current = true;
      setHolding(false);
      haptic([18, 30, 24]);
      void onConfirm();
    }, holdMs);
  };

  return (
    <div className={`hold-control ${holding ? 'is-holding' : ''}`}>
      <TactileButton
        {...props}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        aria-describedby={`${props.label.replaceAll(' ', '-').toLowerCase()}-hint`}
      />
      <span className="hold-progress" style={{ transitionDuration: `${holdMs}ms` }} />
      <span className="hold-hint" id={`${props.label.replaceAll(' ', '-').toLowerCase()}-hint`}>
        {fired.current ? 'Confirmed' : 'Hold to confirm'}
      </span>
    </div>
  );
}

export function StatusOrb({ status, small = false }: { status: AgentStatus; small?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`status-orb ${meta.active ? 'is-active' : ''} ${small ? 'is-small' : ''}`}
      style={{ '--status-color': meta.color, '--status-glow': meta.glow } as React.CSSProperties}
      aria-label={meta.label}
      title={meta.label}
    />
  );
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  unpaired: 'Unpaired',
};

export function ConnectionBadge({
  status,
  latency,
}: {
  status: ConnectionStatus;
  latency: number | null;
}) {
  return (
    <div className={`connection-badge connection-${status}`} role="status">
      <span className="connection-dot" />
      <span>{CONNECTION_LABELS[status]}</span>
      {status === 'connected' && latency !== null ? (
        <span className="latency">{latency} ms</span>
      ) : null}
    </div>
  );
}
