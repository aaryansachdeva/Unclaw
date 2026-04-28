// ElevenLabs TTS service (Turbo v2.5 via REST API).

const ELEVENLABS_API_KEY = 'sk_9ffe7306658ff64f7e3bbc134224cfb7aa81b82a0aefa05f';
const ELEVENLABS_VOICE_ID = 'zmcVlqmyk3Jpn5AVYcAL';
const ELEVENLABS_MODEL = 'eleven_turbo_v2_5';
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

/**
 * Synthesize `text` to speech and return the raw MP3 bytes as a Blob.
 * Throws if the request fails.
 */
export async function textToSpeech(text: string): Promise<Blob> {
  const res = await fetch(ELEVENLABS_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs TTS error ${res.status}: ${errText}`);
  }

  return await res.blob();
}
