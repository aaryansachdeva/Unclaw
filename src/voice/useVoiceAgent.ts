// Thin React adapter around VoiceController. Exposes:
//   - status flags  (isListening, isUserSpeaking, isTranscribing, error)
//   - live signals  (getVadLevel for the visualizer, silence countdown)
//   - controls      (toggle, start, stop)
//   - hooks         (onTranscript, isAISpeaking)
//
// All heavy logic lives in VoiceController; this file is just glue.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  VoiceController,
  type StreamingFeed,
  type VoiceEvent,
} from './voiceController';
import type { EndpointerState } from './endpointer';

export interface UseVoiceAgentOptions {
  /** Called on every finalized transcript. Wire this to chatViaSoul. */
  onTranscript: (text: string) => void;
  /** Returns whether the AI is currently producing audio (gates VAD). */
  isAISpeaking: () => boolean;
  /** Optional Whisper prompt (persona name, vocabulary) to bias accuracy. */
  /** Called when the user has visibly tried to interrupt (mute AI etc.). */
  onBargeIn?: () => void;
  /** Called when an unrecoverable voice error happens (mic denied, etc.). */
  onError?: (msg: string) => void;
  /** Optional streaming transcriber. When set, VoiceController routes
   *  audio frames to it during speech and reads the final text from
   *  finalize() instead of POSTing the whole utterance to Whisper.
   *  Continuous voice mode wires this to the shared StreamingTranscriber
   *  so the input bar can show partial words as they arrive. */
  streaming?: StreamingFeed;
}

export interface VoiceAgentState {
  isListening: boolean;       // mic stream open + worklet running
  isUserSpeaking: boolean;    // VAD says they're talking right now
  isTranscribing: boolean;    // a Whisper request is in flight
  state: EndpointerState;
  /** Silence countdown: required ms until endpoint, elapsed ms so far. */
  silence: { requiredMs: number; elapsedMs: number };
  error: string | null;
}

const INITIAL: VoiceAgentState = {
  isListening: false,
  isUserSpeaking: false,
  isTranscribing: false,
  state: 'idle',
  silence: { requiredMs: 0, elapsedMs: 0 },
  error: null,
};

export function useVoiceAgent(opts: UseVoiceAgentOptions) {
  const [state, setState] = useState<VoiceAgentState>(INITIAL);
  // Live VAD level for the visualizer. A ref, NOT state: 'frame' events fire
  // per 32ms audio frame, and routing them through setState re-rendered the
  // entire AppMain tree ~31x/sec for the whole time the mic was open. This is
  // the same fix useStreamingTranscriber documents for its 'level' events;
  // the visualizer polls getVadLevel() from its own rAF loop instead.
  const vadLevelRef = useRef(0);

  // Stable refs for callbacks so VoiceController is constructed once.
  const onTranscriptRef = useRef(opts.onTranscript);
  const isAISpeakingRef = useRef(opts.isAISpeaking);
  const onBargeInRef = useRef(opts.onBargeIn);
  const onErrorRef = useRef(opts.onError);
  const streamingRef = useRef(opts.streaming);
  useEffect(() => {
    onTranscriptRef.current = opts.onTranscript;
    isAISpeakingRef.current = opts.isAISpeaking;
    onBargeInRef.current = opts.onBargeIn;
    onErrorRef.current = opts.onError;
    streamingRef.current = opts.streaming;
  });

  const controller = useMemo(() => new VoiceController({
    isAISpeaking: () => isAISpeakingRef.current(),
    // Indirection so a late-mounted streaming hook still wires up.
    // VoiceController only checks `streaming` on the relevant code
    // paths, so this proxy stays cheap.
    streaming: {
      startFeed: (mode) => streamingRef.current?.startFeed(mode) ?? Promise.resolve(),
      pushFrame: (samples) => streamingRef.current?.pushFrame(samples),
      finalize: () => streamingRef.current?.finalize() ?? Promise.resolve(''),
      stop: () => streamingRef.current?.stop() ?? Promise.resolve(),
    },
  }), []);

  // Subscribe to controller events and translate them to React state.
  // The controller emits `state` once per endpointer transition; we
  // derive every UI flag from that single signal so they can't drift.
  useEffect(() => {
    const off = controller.on((ev: VoiceEvent) => {
      switch (ev.kind) {
        case 'frame':
          vadLevelRef.current = ev.smoothedProb;
          break;
        case 'silenceTimer':
          setState(s => ({ ...s, silence: { requiredMs: ev.requiredMs, elapsedMs: ev.elapsedMs } }));
          break;
        case 'state': {
          // 'speech' is the only state where we paint "user is talking."
          // 'trailing' is paused-mid-utterance; UI shows the silence
          // countdown (driven by silenceTimer events) but NOT the
          // speaking indicator. Any non-trailing state clears the
          // countdown so it doesn't linger when the user resumes.
          const isUserSpeaking = ev.state === 'speech';
          const silence = ev.state === 'trailing' ? undefined : { requiredMs: 0, elapsedMs: 0 };
          setState(s => ({
            ...s,
            state: ev.state,
            isUserSpeaking,
            silence: silence ?? s.silence,
          }));
          break;
        }
        case 'transcribing':
          setState(s => ({ ...s, isTranscribing: ev.pending }));
          break;
        case 'transcript':
          onTranscriptRef.current(ev.text);
          break;
        case 'bargeIn':
          onBargeInRef.current?.();
          break;
        case 'error':
          setState(s => ({ ...s, error: ev.message }));
          onErrorRef.current?.(ev.message);
          break;
      }
    });
    return () => { off(); };
  }, [controller]);

  // Stop on unmount.
  useEffect(() => {
    return () => { void controller.stop(); };
  }, [controller]);

  const start = useCallback(async () => {
    setState(s => ({ ...s, error: null }));
    try {
      await controller.start();
      setState(s => ({ ...s, isListening: true }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(s => ({ ...s, error: msg, isListening: false }));
    }
  }, [controller]);

  const stop = useCallback(async () => {
    await controller.stop();
    setState({ ...INITIAL, error: state.error });
  }, [controller, state.error]);

  const toggle = useCallback(() => {
    return state.isListening ? stop() : start();
  }, [state.isListening, start, stop]);

  const notifyAIFinished = useCallback(() => {
    controller.notifyAIFinished();
  }, [controller]);

  const getVadLevel = useCallback(() => vadLevelRef.current, []);

  return {
    ...state,
    getVadLevel,
    start,
    stop,
    toggle,
    notifyAIFinished,
  };
}
