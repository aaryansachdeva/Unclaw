// Custom cloned voices. Soul keeps one clip per voice under pocket/refs and
// both local clone engines (Pocket, Chatterbox) resolve the stem through
// their normal tiers, so a voice cloned here works whichever of the two is
// selected. Thin transport over soul's /tts/voices routes.

import { getSoulBaseUrl } from './soulBase';

export interface CustomVoice {
  /** The stem both engines resolve; also the id saved in settings. */
  slug: string;
  /** What the user typed. */
  name: string;
  /** Unix seconds. */
  created: number;
  /** Seconds of speech kept after trimming (capped at 15). */
  seconds: number;
  /** Which engines already hold a cached state for it. */
  engines: { pocket: boolean | string; chatterbox: boolean | string };
}

export async function listCustomVoices(): Promise<CustomVoice[]> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/voices`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`soul /tts/voices ${res.status}`);
  const body = (await res.json()) as { voices?: CustomVoice[] };
  return Array.isArray(body.voices) ? body.voices : [];
}

/** Upload a clip (the recorder's webm/opus blob or a picked file) and get the
 *  stored voice back. Soul answers 400 with a plain sentence when the clip is
 *  unusable (too short, no speech, undecodable); that sentence is the error. */
export async function cloneVoice(name: string, clip: Blob, filename: string): Promise<CustomVoice> {
  const form = new FormData();
  form.append('name', name);
  form.append('audio', clip, filename);
  const res = await fetch(`${getSoulBaseUrl()}/tts/voices`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    let detail = `soul /tts/voices ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (typeof j.detail === 'string') detail = j.detail;
    } catch { /* keep the status line */ }
    throw new Error(detail);
  }
  return (await res.json()) as CustomVoice;
}

export async function deleteCustomVoice(slug: string): Promise<void> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/voices/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`soul delete voice ${res.status}`);
}

/** Record from the default microphone for up to `maxMs`, resolving with the
 *  encoded clip. Call the returned stop() early to end the take; the same
 *  promise resolves either way. */
export function recordClip(maxMs = 15000): { done: Promise<Blob>; stop: () => void; mimeType: string } {
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const chunks: BlobPart[] = [];
  const done = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const finished = new Promise<Blob>((resolve) => {
      recorder!.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || mimeType || 'audio/webm' }));
    });
    recorder.start(250);
    timer = setTimeout(() => stop(), maxMs);
    try {
      return await finished;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  })();
  const stop = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  return { done, stop, mimeType };
}
