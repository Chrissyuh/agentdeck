import { useCallback, useEffect, useRef, useState } from 'react';

export function haptic(pattern: number | number[] = 12): void {
  navigator.vibrate?.(pattern);
}

export function useClock(interval = 1_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function useMountedDisplay(
  enabled: boolean,
  keepAwake: boolean,
  setEnabled: (enabled: boolean) => void,
) {
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async (): Promise<void> => {
    const manager = navigator.wakeLock;
    if (!manager || document.visibilityState !== 'visible') return;
    try {
      wakeLock.current = await manager.request('screen');
    } catch {
      wakeLock.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled && keepAwake) void requestWakeLock();
    else {
      void wakeLock.current?.release();
      wakeLock.current = null;
    }

    const restore = (): void => {
      if (
        enabled &&
        keepAwake &&
        document.visibilityState === 'visible' &&
        wakeLock.current?.released !== false
      ) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', restore);
    return () => document.removeEventListener('visibilitychange', restore);
  }, [enabled, keepAwake, requestWakeLock]);

  useEffect(() => {
    if (
      !enabled ||
      document.fullscreenElement ||
      window.matchMedia('(display-mode: standalone)').matches
    )
      return;
    const enter = (): void => {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    document.addEventListener('pointerdown', enter, { once: true });
    return () => document.removeEventListener('pointerdown', enter);
  }, [enabled]);

  useEffect(
    () => () => {
      void wakeLock.current?.release();
    },
    [],
  );

  const toggle = useCallback(async (): Promise<void> => {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      haptic([8, 20, 12]);
      if (keepAwake) await requestWakeLock();
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        // Standalone PWAs and older iOS versions may not expose the fullscreen API.
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  }, [enabled, keepAwake, requestWakeLock, setEnabled]);

  return { enabled, toggle };
}

export function useVoiceInput(onTranscript: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const disposed = useRef(false);
  const [supported] = useState(() =>
    Boolean(
      typeof window !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined',
    ),
  );

  const start = useCallback(() => {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      return true;
    }
    if (!supported) return false;
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const nextRecorder = new MediaRecorder(stream);
        recorder.current = nextRecorder;
        startedAt.current = Date.now();
        nextRecorder.onstop = () => {
          const seconds = Math.max(0.1, (Date.now() - startedAt.current) / 1_000);
          stream.getTracks().forEach((track) => track.stop());
          recorder.current = null;
          if (!disposed.current) {
            setListening(false);
            onTranscript(`Voice note · ${seconds.toFixed(1)}s (local mock)`);
            haptic([8, 18, 12]);
          }
        };
        nextRecorder.onerror = () => {
          stream.getTracks().forEach((track) => track.stop());
          recorder.current = null;
          setListening(false);
        };
        nextRecorder.start();
        setListening(true);
        haptic(8);
      })
      .catch(() => setListening(false));
    return true;
  }, [onTranscript, supported]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
    };
  }, []);

  return { listening, supported, start };
}
