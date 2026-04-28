// LipSync server client — uploads audio, receives a job id that Unreal
// can use to GET the full result (face curves + audio) from the same server.

const LIPSYNC_SERVER_URL = 'http://127.0.0.1:8765';

/**
 * POST an audio Blob to the LipSync server's /upload endpoint. The server
 * runs inference, caches the result under a unique id, and returns the id.
 *
 * The game then sends that id to Unreal via a Pixel Streaming descriptor,
 * and Unreal GETs /result/{id} to pull the face curves + audio for playback.
 */
export async function uploadAudioGetJobId(
  audio: Blob,
  filename = 'tts.mp3',
): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, filename);

  const res = await fetch(`${LIPSYNC_SERVER_URL}/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`LipSync server upload error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { id?: string };
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('LipSync server did not return a job id');
  }
  return data.id;
}
