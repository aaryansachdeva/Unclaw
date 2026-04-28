// Whisper transcription client. POSTs WAV blobs to soul.exe's /transcribe
// proxy (which forwards to Groq's whisper-large-v3-turbo). Designed to
// support speculative early-fire transcription: kick off a request after
// ~1 s of speech so it computes in parallel with the rest of the
// utterance, and cancel + re-fire if the user keeps talking.

import { SAMPLE_RATE, TRANSCRIBE_URL, WHISPER_LANGUAGE, WHISPER_MODEL } from './constants';

export interface TranscriptionResult {
  text: string;
  durationS: number;
  /** Full Groq response body for debugging. */
  raw: unknown;
  /** ms from POST send to response. */
  totalMs: number;
  /** ms reported by the soul proxy as Groq round-trip. */
  proxyMs: number | undefined;
}

export interface TranscribeOptions {
  /** Cancellation handle. Pass `controller.signal`. */
  signal?: AbortSignal;
  /** Optional Whisper hint (vocabulary, persona name). Improves accuracy. */
  prompt?: string;
  /** BCP-47 code or 'auto'. Defaults to constants.WHISPER_LANGUAGE. */
  language?: string;
  /** Override model. Defaults to whisper-large-v3-turbo. */
  model?: string;
}

/**
 * Encode PCM Float32 samples (in [-1, 1]) at 16 kHz mono as a WAV blob.
 * Inlined here (no separate util) so this module is self-contained.
 */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);  // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    // Clamp + scale Float32 [-1, 1] to Int16.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Transcribe `samples` (Float32Array at 16 kHz mono) via the soul proxy.
 * Aborts cleanly when `opts.signal` triggers — the proxy doesn't currently
 * cancel the upstream Groq request, but the wasted bytes are tiny.
 */
export async function transcribe(
  samples: Float32Array,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const wav = encodeWav(samples);
  const fd = new FormData();
  fd.append('file', wav, 'audio.wav');
  fd.append('model', opts.model ?? WHISPER_MODEL);
  fd.append('language', opts.language ?? WHISPER_LANGUAGE);
  if (opts.prompt) fd.append('prompt', opts.prompt);

  const t0 = performance.now();
  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    body: fd,
    signal: opts.signal,
  });
  const totalMs = performance.now() - t0;
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`transcribe ${res.status}: ${txt.slice(0, 200)}`);
  }
  const raw = await res.json();
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    durationS: typeof raw.duration === 'number' ? raw.duration : samples.length / SAMPLE_RATE,
    raw,
    totalMs,
    proxyMs: typeof raw._proxy_ms === 'number' ? raw._proxy_ms : undefined,
  };
}
