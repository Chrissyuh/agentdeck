import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { haptic } from '../hooks';

interface ConsoleButtonProps {
  icon: LucideIcon;
  label: string;
  code?: string;
  tone?: 'bone' | 'lime' | 'violet' | 'amber' | 'red' | 'blue' | 'dark';
  holdMs?: number;
  disabled?: boolean;
  active?: boolean;
  onTrigger(): void;
}

export function ConsoleButton({
  icon: Icon,
  label,
  code,
  tone = 'bone',
  holdMs,
  disabled = false,
  active = false,
  onTrigger,
}: ConsoleButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const [holding, setHolding] = useState(false);

  const clearHold = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const beginHold = (): void => {
    if (!holdMs || disabled || timer.current) return;
    fired.current = false;
    setHolding(true);
    haptic(7);
    timer.current = setTimeout(() => {
      fired.current = true;
      timer.current = null;
      setHolding(false);
      haptic([10, 24, 18]);
      onTrigger();
    }, holdMs);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!holdMs || disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginHold();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!holdMs || event.repeat || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    beginHold();
  };

  return (
    <button
      type="button"
      className={`console-button ${holding ? 'is-holding' : ''} ${active ? 'is-active' : ''}`}
      data-tone={tone}
      disabled={disabled}
      onClick={() => {
        if (holdMs || fired.current) {
          fired.current = false;
          return;
        }
        haptic(8);
        onTrigger();
      }}
      onPointerDown={onPointerDown}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onKeyDown={onKeyDown}
      onKeyUp={clearHold}
      aria-label={`${label}${holdMs ? ', hold to activate' : ''}`}
    >
      <span className="console-button-code">{code ?? 'AD'}</span>
      <Icon aria-hidden="true" />
      <strong>{label}</strong>
      {holdMs ? (
        <span
          className="console-hold-track"
          style={{ '--hold-ms': `${holdMs}ms` } as CSSProperties}
        />
      ) : null}
    </button>
  );
}
