// React hook around StreamingTranscriber. One instance per app (the
// hook holds it in a ref). Exposes the live committed/tentative text
// + start/stop/finalize controls.
//
// The hook is intentionally minimal — no business logic about WHEN to
// start/stop. Push-to-talk lives in App.tsx; continuous mode lives in
// useVoiceAgent. Both call this hook to drive the same low-level
// transcriber.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StreamingTranscriber,
  type StreamingEvent,
  type StreamingMode,
} from './streamingClient';

export interface StreamingState {
  /** Words the LocalAgreement-2 algorithm has confirmed. Render solid. */
  committed: string;
  /** Latest model output past the agreement point. Render dim/italic. */
  tentative: string;
  /** True between `start()` and `stop()`. */
  isActive: boolean;
  /** Last error message, cleared on next `start()`. */
  error: string | null;
}

const INITIAL: StreamingState = {
  committed: '',
  tentative: '',
  isActive: false,
  error: null,
};

export function useStreamingTranscriber() {
  const [state, setState] = useState<StreamingState>(INITIAL);
  // Stable ref: one transcriber per hook instance, lifetime = component.
  const transcriberRef = useRef<StreamingTranscriber | null>(null);
  if (!transcriberRef.current) {
    transcriberRef.current = new StreamingTranscriber();
  }

  // Subscribe once. The transcriber emits events; we map them to state.
  useEffect(() => {
    const t = transcriberRef.current!;
    const off = t.on((ev: StreamingEvent) => {
      switch (ev.kind) {
        case 'started':
          setState({
            committed: '',
            tentative: '',
            isActive: true,
            error: null,
          });
          break;
        case 'partial':
          setState((s) => ({
            ...s,
            committed: ev.committed,
            tentative: ev.tentative,
          }));
          break;
        case 'final':
          // Promote the entire final text to committed; clear tentative.
          // The hook user reads `committed` after their `await finalize()`
          // resolves, so this is just for any subscribed UI that
          // wants to keep showing the result.
          setState((s) => ({
            ...s,
            committed: ev.text,
            tentative: '',
          }));
          break;
        case 'stopped':
          setState((s) => ({ ...s, isActive: false }));
          break;
        case 'level':
          // Intentionally NOT in React state — level updates fire at
          // ~60 Hz; routing them through React reconciliation drove
          // the per-chunk-amplifying lag the user reported. Anything
          // that needs the level should subscribe to the transcriber
          // class directly via `getTranscriber()` and use refs/RAF
          // for DOM-side updates.
          break;
        case 'error':
          setState((s) => ({ ...s, error: ev.message }));
          break;
      }
    });
    return () => {
      off();
      // Tear down the mic + WS if the hook unmounts mid-session.
      void t.stop();
    };
  }, []);

  const start = useCallback(async (mode: StreamingMode) => {
    await transcriberRef.current!.start(mode);
  }, []);

  /** Open the WS without taking the mic. Caller must drive audio in
   *  via `pushFrame`. Used by continuous voice mode where
   *  VoiceController already owns the mic for VAD. */
  const startFeed = useCallback(async (mode: StreamingMode) => {
    await transcriberRef.current!.startFeed(mode);
  }, []);

  const pushFrame = useCallback((samples: Float32Array) => {
    transcriberRef.current!.pushFrame(samples);
  }, []);

  const finalize = useCallback(async (): Promise<string> => {
    return transcriberRef.current!.finalize();
  }, []);

  const stop = useCallback(async () => {
    await transcriberRef.current!.stop();
  }, []);

  const reset = useCallback(() => {
    transcriberRef.current!.reset();
    setState((s) => ({ ...s, committed: '', tentative: '', error: null }));
  }, []);

  /** Combined display string — committed + tentative joined with a space.
   *  Convenience for components that don't need to render them differently. */
  const display = useMemo(() => {
    const c = state.committed.trim();
    const t = state.tentative.trim();
    if (c && t) return `${c} ${t}`;
    return c || t;
  }, [state.committed, state.tentative]);

  return {
    ...state,
    display,
    start,
    startFeed,
    pushFrame,
    finalize,
    stop,
    reset,
  };
}
