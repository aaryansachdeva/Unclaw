import { PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';
import { AIResponse } from './ai';

/** Base64-encode a string safely for transmission to UE */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** Build and send a descriptor to Unreal Engine based on the AI response */
export function sendDescriptor(ps: PixelStreaming, aiResponse: AIResponse): void {
  const { functionName, functionArguments, message } = aiResponse;
  const args = functionArguments as Record<string, string>;

  let descriptor: Record<string, unknown> | null = null;

  switch (functionName) {
    case 'respond_with_mood':
      descriptor = {
        EventType: 'respond_with_mood',
        SendData: true,
        Response: toBase64(message),
        Mood: args.mood || 'happy',
        Timestamp: new Date().toISOString(),
      };
      break;

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
