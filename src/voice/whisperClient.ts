// Whisper transcription client. POSTs WAV blobs to soul.exe's /transcribe
// proxy (which forwards to Groq's whisper-large-v3-turbo). Fires once
// per utterance, after the endpointer has decided the user has stopped.

import {
  HALLUCINATION_TEXTS,
  MAX_NO_SPEECH_PROB,
  SAMPLE_RATE,
  getTranscribeUrl,
  WHISPER_LANGUAGE,
  WHISPER_MODEL,
} from './constants';

export interface TranscriptionResult {
  text: string;
  durationS: number;
  /** Full Groq response body for debugging. */
  raw: unknown;
  /** ms from POST send to response. */
  totalMs: number;
  /** ms reported by the soul proxy as Groq round-trip. */
  proxyMs: number | undefined;
  /** Why the text is empty, if it is. Useful for log-level decisions upstream. */
  rejection?: 'no_speech' | 'hallucination' | null;
}

interface VerboseSegment {
  no_speech_prob?: number;
  avg_logprob?: number;
  text?: string;
}

/** Compare-friendly form of a Whisper output: lowercase, punctuation stripped. */
function normalizeForCompare(s: string): string {
  return s.toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')   // strip punctuation + symbols
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TranscribeOptions {
  /** Cancellation handle. Pass `controller.signal`. */
  signal?: AbortSignal;
  /** Optional Whisper hint (vocabulary, persona name). Improves accuracy. */
  prompt?: string;
}

/**
 * Encode PCM Float32 samples (in [-1, 1]) at 16 kHz mono as a WAV blob.
 * Inlined here (no separate util) so this module is self-contained.
 */
function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
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
  fd.append('model', WHISPER_MODEL);
  fd.append('language', WHISPER_LANGUAGE);
  if (opts.prompt) fd.append('prompt', opts.prompt);

  const t0 = performance.now();
  const res = await fetch(getTranscribeUrl(), {
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
  const rawText = typeof raw.text === 'string' ? raw.text : '';

  // Anti-hallucination filter. Whisper turbo fills near-silent or noisy
  // audio with stock YouTube outros ("Thank you.", "Thanks for
  // watching.") even at temperature=0. We catch those two ways:
  //
  //   1. The verbose_json response includes per-segment
  //      `no_speech_prob`. If the segment-duration-weighted average is
  //      high, Whisper itself is signalling "this isn't speech."
  //   2. A small set of stock hallucinated phrases — the comparison is
  //      done after lowercasing and stripping punctuation, so
  //      "Thank you." and "thank you" both match.
  let rejection: 'no_speech' | 'hallucination' | null = null;
  const segs: VerboseSegment[] = Array.isArray(raw.segments) ? raw.segments : [];
  if (segs.length > 0) {
    let totalDur = 0;
    let weighted = 0;
    for (const s of segs) {
      const start = typeof (s as { start?: number }).start === 'number' ? (s as { start: number }).start : 0;
      const end = typeof (s as { end?: number }).end === 'number' ? (s as { end: number }).end : start;
      const dur = Math.max(end - start, 0.05);
      const p = typeof s.no_speech_prob === 'number' ? s.no_speech_prob : 0;
      totalDur += dur;
      weighted += p * dur;
    }
    const avgNoSpeech = totalDur > 0 ? weighted / totalDur : 0;
    if (avgNoSpeech >= MAX_NO_SPEECH_PROB) rejection = 'no_speech';
  }

  const normalized = normalizeForCompare(rawText);
  if (!rejection && HALLUCINATION_TEXTS.has(normalized)) {
    rejection = 'hallucination';
  }

  if (rejection) {
    console.info(`[stt] dropped (${rejection}): "${rawText.trim()}"`);
  }

  return {
    text: rejection ? '' : rawText,
    durationS: typeof raw.duration === 'number' ? raw.duration : samples.length / SAMPLE_RATE,
    raw,
    totalMs,
    proxyMs: typeof raw._proxy_ms === 'number' ? raw._proxy_ms : undefined,
    rejection,
  };
}
