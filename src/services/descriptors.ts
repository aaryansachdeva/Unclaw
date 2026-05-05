import { PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';
import { AIResponse } from './ai';
import { textToSpeech } from './tts';
import { uploadAudioGetJobId } from './lipsync';

/** Base64-encode a string safely for transmission to UE */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/**
 * Run the full TTS → LipSync server pipeline, then send a descriptor
 * to Unreal with just the job id. Unreal fetches face curves + audio
 * from the server using that id.
 */
async function sendServerMoodDescriptor(
  ps: PixelStreaming,
  message: string,
  mood: string,
): Promise<void> {
  try {
    console.log('[descriptor] TTS:', message);
    const audio = await textToSpeech(message);
    console.log('[descriptor] audio:', audio.size, 'bytes — uploading');
    const jobId = await uploadAudioGetJobId(audio);
    console.log('[descriptor] jobId:', jobId, 'mood:', mood);

    ps.emitUIInteraction({
      EventType: 'respond_with_mood_server',
      JobId: jobId,
      Mood: mood,
      Response: toBase64(message),
      Timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[descriptor] respond_with_mood_server pipeline failed:', err);
    // Fallback: let UE at least know something was said, no lipsync
    ps.emitUIInteraction({
      EventType: 'respond_with_mood',
      SendData: true,
      Response: toBase64(message),
      Mood: mood,
      Timestamp: new Date().toISOString(),
    });
  }
}

/** Build and send a descriptor to Unreal Engine based on the AI response */
export async function sendDescriptor(
  ps: PixelStreaming,
  aiResponse: AIResponse,
): Promise<void> {
  const { functionName, functionArguments, message } = aiResponse;
  const args = functionArguments as Record<string, string>;

  // Primary conversational path: route through the server for real lipsync
  if (functionName === 'respond_with_mood') {
    await sendServerMoodDescriptor(ps, message, args.mood || 'happy');
    return;
  }

  // Other function names use direct descriptors (for now)
  let descriptor: Record<string, unknown> | null = null;

  switch (functionName) {
    case 'say_hello':
      descriptor = {
        EventType: 'say_hello',
        SendData: true,
        Response: toBase64(message),
        Timestamp: new Date().toISOString(),
      };
      break;

    case 'give_a_kiss':
      descriptor = {
        EventType: 'give_a_kiss',
        SendData: true,
        Response: toBase64(message),
        Timestamp: new Date().toISOString(),
      };
      break;

    case 'doDance':
      descriptor = {
        EventType: 'doDance',
        SendData: true,
        Response: toBase64(message),
        Timestamp: new Date().toISOString(),
      };
      break;

    case 'react_as_star_wars_fan':
      descriptor = {
        EventType: 'doSWIdle',
        SendData: true,
        Response: toBase64(message),
        Timestamp: new Date().toISOString(),
      };
      break;

    default:
      // Generic fallback
      descriptor = {
        EventType: functionName,
        SendData: true,
        Response: toBase64(message),
        FunctionArguments: args,
        Timestamp: new Date().toISOString(),
      };
      break;
  }

  if (descriptor) {
    ps.emitUIInteraction(descriptor);
  }
}
