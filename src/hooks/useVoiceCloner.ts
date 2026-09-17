// Record-or-drop voice cloning as a hook: Settings > Voice and the character
// setup after an import both clone through soul's /tts/voices with the same
// rules (up to 15 s from the microphone, or any clip file), so the state
// machine lives here once.

import { useCallback, useEffect, useRef, useState } from 'react';

import { cloneVoice, listCustomVoices, recordClip, type CustomVoice } from '../services/voices';

export const CLONE_MAX_MS = 15000;

export type CloneBusy = 'idle' | 'recording' | 'uploading';

export function useVoiceCloner() {
  const [voices, setVoices] = useState<CustomVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CloneBusy>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVoices(await listCustomVoices());
      setError(null);
    } catch (e) {
      setVoices([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (busy !== 'recording') return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [busy]);

  /** Upload a clip under `name`; resolves with the stored voice, or null on
   *  failure (the reason is in `error`). */
  const submit = useCallback(async (name: string, clip: Blob, filename: string): Promise<CustomVoice | null> => {
    setBusy('uploading');
    setError(null);
    try {
      const v = await cloneVoice(name.trim() || 'My voice', clip, filename);
      await refresh();
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy('idle');
    }
  }, [refresh]);

  /** Record until stop() or the 15 s cap, then clone under `name`. */
  const record = useCallback(async (name: string): Promise<CustomVoice | null> => {
    setError(null);
    setElapsedMs(0);
    try {
      const rec = recordClip(CLONE_MAX_MS);
      stopRef.current = rec.stop;
      setBusy('recording');
      const blob = await rec.done;
      stopRef.current = null;
      const ext = rec.mimeType.includes('mp4') ? 'm4a' : 'webm';
      return await submit(name, blob, `take.${ext}`);
    } catch (e) {
      stopRef.current = null;
      setBusy('idle');
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in System Settings > Privacy > Microphone.'
        : (e instanceof Error ? e.message : String(e)));
      return null;
    }
  }, [submit]);

  const stop = useCallback(() => { stopRef.current?.(); }, []);

  const uploadFile = useCallback(async (name: string, file: File) => submit(name, file, file.name), [submit]);

  return {
    voices, error, setError, busy, refresh, record, stop, uploadFile,
    seconds: Math.min(CLONE_MAX_MS, elapsedMs) / 1000,
  };
}
