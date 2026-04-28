import { useState, useCallback, useRef, useEffect } from 'react';
import { Titlebar } from './components/Titlebar';
import { StreamView } from './components/StreamView';
import { InputBar } from './components/InputBar';
import { AgentSwitcher } from './components/AgentSwitcher';
import { Greeting } from './components/Greeting';
import { VoiceIndicator } from './components/VoiceIndicator';
import { usePixelStreaming } from './hooks/usePixelStreaming';
import { useVideoRectPublisher } from './hooks/useVideoRectPublisher';
import { useChatMemory } from './hooks/useChatMemory';
import { useVoiceAgent } from './voice/useVoiceAgent';
import { chatViaSoul } from './services/soulChat';
import { personalityFor } from './personalities';
import { AGENTS } from './types';

/** Base64-encode UTF-8 safely for transmission to UE. */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

const SIGNALING_URL = 'ws://localhost:8080';

export function App() {
  const { videoParentRef, connectionState, pixelStreaming } = usePixelStreaming({
    signalingUrl: SIGNALING_URL,
  });

  // Publishes the streamed <video>'s screen geometry to UE so the
  // CursorGazeComponent can translate the host OS cursor (read via Win32
  // GetCursorPos) into video-relative coords. Lets eye gaze keep tracking
  // the cursor even when the UnClaw window isn't focused.
  useVideoRectPublisher(pixelStreaming, videoParentRef);

  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);

  // Persona + per-agent chat memory. Switching agents swaps the persona
  // and the history slot independently, so Grace and Mark each remember
  // their own conversations.
  const persona = personalityFor(AGENTS[currentAgentIndex].name);
  const memory = useChatMemory(persona.id);

  const handleAgentSwitch = useCallback((newIndex: number) => {
    setCurrentAgentIndex(newIndex);
    pixelStreaming?.emitUIInteraction({
      EventType: 'agentSwitched',
      AgentId: newIndex,
      Agent: AGENTS[newIndex],
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming]);

  // Track whether the AI is currently producing audible output. Voice
  // mode uses this to gate VAD (avoid re-triggering on streamed audio
  // leaking through the mic) and to detect barge-in.
  const isAISpeakingRef = useRef(false);

  // Forward declaration for cross-references between voice and chat:
  //   - `voice` is constructed BEFORE handleSendMessage so its onTranscript
  //     can call into the chat flow via this ref.
  //   - `handleSendMessage` references `voice.notifyAIFinished` via this
  //     ref to avoid a circular const-before-declaration error.
  const notifyAIFinishedRef = useRef<() => void>(() => {});

  const handleSendMessage = useCallback(async (message: string) => {
    if (isSending) return;
    setIsSending(true);
    isAISpeakingRef.current = true;

    // Record the user turn FIRST so the assistant turn lands after it
    // even if the network hiccups partway through.
    memory.add('user', message);
    const history = memory.getHistory();

    try {
      const result = await chatViaSoul(message, {
        systemExtension: persona.prompt,
        history,
      });

      // Persist the assistant's spoken text only (drop mood/behavior
      // wrapper -- those are regenerated fresh next turn anyway and
      // bloat the history payload).
      if (result.response) memory.add('assistant', result.response);

      if (pixelStreaming) {
        pixelStreaming.emitUIInteraction({
          EventType: 'respond_with_mood_server',
          JobId: result.id,
          Mood: result.mood,
          Response: toBase64(result.response),
          Behavior: result.behavior ?? '',
          Timestamp: new Date().toISOString(),
        });
      }

      // Best-effort estimate of when the AI finishes speaking so the
      // voice agent can re-arm with cold-start grace. Soul's `duration`
      // field gives us audio length in seconds.
      const speakSec = (result as { duration?: number }).duration ?? 4;
      window.setTimeout(() => {
        isAISpeakingRef.current = false;
        notifyAIFinishedRef.current();
      }, Math.round(speakSec * 1000));
    } catch (err) {
      console.error('[chat] soul /chat failed:', err);
      isAISpeakingRef.current = false;
    } finally {
      setIsSending(false);
    }
  }, [pixelStreaming, isSending, persona, memory]);

  // Continuous voice agent. Transcripts route into the same chat path
  // as typed messages. Persona name seeds Whisper for better accuracy
  // on proper nouns ("Grace" vs "grace", etc.).
  const voice = useVoiceAgent({
    onTranscript: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      void handleSendMessage(trimmed);
    },
    isAISpeaking: () => isAISpeakingRef.current,
    whisperPrompt: () => `Conversation with ${persona.displayName}.`,
    onBargeIn: () => {
      // Drop the streamed audio immediately so the user hears themselves
      // instead of the AI's tail. Real server-side abort is a Phase 3 polish.
      const v = document.querySelector('video');
      if (v) v.muted = true;
      isAISpeakingRef.current = false;
    },
    onError: (msg) => console.warn('[voice]', msg),
  });

  // Keep the forward-ref pointed at the current voice agent. Stable
  // identity for `notifyAIFinished` (it's a useCallback inside the hook),
  // so this useEffect runs once unless React decides to remount.
  useEffect(() => {
    notifyAIFinishedRef.current = voice.notifyAIFinished;
  }, [voice.notifyAIFinished]);

  // Restore audio after barge-in once a new chat round starts.
  useEffect(() => {
    if (isSending) {
      const v = document.querySelector('video');
      if (v) v.muted = false;
    }
  }, [isSending]);

  const handleClearMemory = useCallback(() => {
    if (memory.turns.length === 0) return;
    if (window.confirm(`Clear conversation history with ${persona.displayName}?`)) {
      memory.clear();
    }
  }, [memory, persona]);

  const isConnected = connectionState === 'connected';

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <StreamView
        videoParentRef={videoParentRef}
        connectionState={connectionState}
      />
      <div
        className="absolute z-20 pointer-events-none"
        style={{
          top: '70px',
          left: '36px',
          width: '50%',
        }}
      >
        <Greeting visible={isConnected} userName="Aryan" />
      </div>
      <Titlebar />

      <div
        className="absolute bottom-0 left-0 right-0 z-30"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '0 20px 20px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
          <AgentSwitcher
            agents={AGENTS}
            currentIndex={currentAgentIndex}
            onSwitch={handleAgentSwitch}
            disabled={!isConnected}
          />
          <VoiceIndicator
            isListening={voice.isListening}
            isUserSpeaking={voice.isUserSpeaking}
            isTranscribing={voice.isTranscribing}
            vadLevel={voice.vadLevel}
            silence={voice.silence}
            error={voice.error}
          />
          {memory.turns.length > 0 && (
            <button
              type="button"
              onClick={handleClearMemory}
              title={`Clear ${persona.displayName}'s memory (${memory.turns.length} turns)`}
              style={{
                marginLeft: 'auto',
                padding: '6px 12px',
                background: 'transparent',
                color: 'rgba(255,255,255,0.45)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '6px',
                fontSize: '10.5px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'rgba(255,255,255,0.45)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
              }}
            >
              clear · {memory.turns.length}
            </button>
          )}
        </div>
        <div style={{ width: '100%' }}>
          <InputBar
            onSendMessage={handleSendMessage}
            disabled={!isConnected || isSending}
            // Mic stays available even when PS isn't connected -- voice
            // doesn't need the stream to be up to test (transcripts still
            // route through soul). Only block while a chat is in flight.
            micDisabled={isSending}
            voiceActive={voice.isListening}
            onToggleVoice={() => { void voice.toggle(); }}
          />
        </div>
      </div>
    </div>
  );
}
