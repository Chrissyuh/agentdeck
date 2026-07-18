import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentStatus } from '@agentdeck/protocol';

let feedbackAudioContext: AudioContext | null = null;
let feedbackAudioUnlocked = false;
let feedbackInteractionUnlocked = false;

if (typeof window !== 'undefined') {
  const unlockFeedback = (): void => {
    feedbackInteractionUnlocked = true;
  };
  window.addEventListener('pointerdown', unlockFeedback, { once: true, passive: true });
  window.addEventListener('keydown', unlockFeedback, { once: true });
}

function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return navigator.vibrate(pattern);
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  feedbackAudioContext ??= new AudioContextConstructor();
  return feedbackAudioContext;
}

function playTone(
  context: AudioContext,
  frequency: number,
  duration: number,
  volume: number,
  offset = 0,
  type: OscillatorType = 'square',
): void {
  const startsAt = context.currentTime + offset;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(volume, startsAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration);
}

function playMechanicalClick(): void {
  const context = getAudioContext();
  if (!context) return;
  const play = (): void => {
    feedbackAudioUnlocked = true;
    playTone(context, 145, 0.022, 0.035);
    playTone(context, 980, 0.015, 0.018, 0.004, 'triangle');
  };
  if (context.state === 'suspended')
    void context
      .resume()
      .then(play)
      .catch(() => undefined);
  else play();
}

export function haptic(pattern: number | number[] = 12): void {
  if (!vibrate(pattern)) playMechanicalClick();
}

function notifyChatUpdate(
  status: Extract<AgentStatus, 'awaiting_approval' | 'completed' | 'error'>,
): void {
  if (!feedbackInteractionUnlocked) return;
  const vibration =
    status === 'error' ? [22, 35, 22] : status === 'awaiting_approval' ? [14, 28, 14] : 18;
  if (vibrate(vibration) || !feedbackAudioUnlocked || !feedbackAudioContext) return;

  const context = feedbackAudioContext;
  const frequencies: readonly [number, number] =
    status === 'error' ? [210, 155] : status === 'awaiting_approval' ? [620, 820] : [520, 690];
  playTone(context, frequencies[0], 0.075, 0.025, 0, 'triangle');
  playTone(context, frequencies[1], 0.09, 0.025, 0.09, 'triangle');
}

function isNotifiableStatus(
  status: AgentStatus,
): status is Extract<AgentStatus, 'awaiting_approval' | 'completed' | 'error'> {
  return status === 'awaiting_approval' || status === 'completed' || status === 'error';
}

export function useChatUpdateFeedback(agents: Agent[]): void {
  const previousStatuses = useRef<Map<string, AgentStatus> | null>(null);

  useEffect(() => {
    const nextStatuses = new Map(agents.map((agent) => [agent.id, agent.status]));
    if (previousStatuses.current) {
      for (const agent of agents) {
        if (
          previousStatuses.current.get(agent.id) !== agent.status &&
          isNotifiableStatus(agent.status)
        ) {
          notifyChatUpdate(agent.status);
        }
      }
    }
    previousStatuses.current = nextStatuses;
  }, [agents]);
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

interface SpeechRecognitionResultEvent extends Event {
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
}

interface SpeechRecognitionErrorEvent extends Event {
  error?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function voiceErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'no-speech':
      return "I didn't catch that. Try again or use the microphone on your keyboard.";
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked here. Use the microphone on your keyboard.';
    case 'audio-capture':
      return 'No microphone is available. You can still type the direction.';
    default:
      return 'Speech recognition is unavailable. Use the microphone on your keyboard.';
  }
}

export function useVoiceInput(
  onTranscript: (transcript: string) => void,
  onUnavailable: (message: string) => void,
) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptCallback = useRef(onTranscript);
  const unavailableCallback = useRef(onUnavailable);
  transcriptCallback.current = onTranscript;
  unavailableCallback.current = onUnavailable;
  const [supported] = useState(() => Boolean(speechRecognitionConstructor()));

  const start = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      return true;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      unavailableCallback.current(voiceErrorMessage(undefined));
      return false;
    }

    const nextRecognition = new Recognition();
    recognition.current = nextRecognition;
    nextRecognition.continuous = false;
    nextRecognition.interimResults = false;
    nextRecognition.lang = document.documentElement.lang || navigator.language || 'en-US';
    nextRecognition.maxAlternatives = 1;
    nextRecognition.onstart = () => {
      setListening(true);
      haptic(8);
    };
    nextRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript?.trim())
        .filter((value): value is string => Boolean(value))
        .join(' ');
      if (transcript) {
        transcriptCallback.current(transcript);
        haptic([8, 18, 12]);
      }
    };
    nextRecognition.onerror = (event) => {
      unavailableCallback.current(voiceErrorMessage(event.error));
    };
    nextRecognition.onend = () => {
      recognition.current = null;
      setListening(false);
    };

    try {
      nextRecognition.start();
    } catch {
      recognition.current = null;
      setListening(false);
      unavailableCallback.current(voiceErrorMessage(undefined));
      return false;
    }
    return true;
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  return { listening, supported, start, stop };
}
