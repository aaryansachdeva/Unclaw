import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Titlebar } from './components/Titlebar';
import { StreamView } from './components/StreamView';
import { Greeting } from './components/Greeting';
import { InputBar } from './components/InputBar';
import { WidgetRail } from './components/WidgetRail';
import { SheetPanel } from './components/SheetPanel';
import { RemindersPanel } from './components/Reminders';
import { StocksPanel } from './components/Stocks';
import { NewsPanel } from './components/News';
import { WeatherPanel } from './components/Weather';
import { usePixelStreaming } from './hooks/usePixelStreaming';
import { useVideoRectPublisher } from './hooks/useVideoRectPublisher';
import { useChatMemory } from './hooks/useChatMemory';
import { SheetKey } from './hooks/useSheet';
import { useVoiceAgent } from './voice/useVoiceAgent';
import { chatViaSoul, SoulChatAction } from './services/soulChat';
import { listReminders } from './services/reminders';
import { getStocks } from './services/stocks';
import { personalityFor } from './personalities';
import { AGENTS } from './types';

/** Base64-encode UTF-8 safely for transmission to UE. */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** Names of soul tools that mutate the reminders store and should
 *  trigger a panel refresh after the chat round. */
function isReminderAction(name: string | undefined): boolean {
  return name === 'create_event_reminder'
    || name === 'update_reminder'
    || name === 'delete_reminder'
    || name === 'mark_reminder_complete';
}

/** Map a soul `action` payload to a UE descriptor and dispatch it. */
function dispatchActionToUE(
  ps: { emitUIInteraction: (descriptor: object) => void },
  action: SoulChatAction,
  speechText: string,
): void {
  const eventType = action.name === 'do_dance' ? 'doDance' : action.name;
  ps.emitUIInteraction({
    EventType: eventType,
    SendData: true,
    Response: toBase64(speechText),
    Timestamp: new Date().toISOString(),
  });
}

const SIGNALING_URL = 'ws://localhost:8080';

export function App() {
  const { videoParentRef, connectionState, pixelStreaming } = usePixelStreaming({
    signalingUrl: SIGNALING_URL,
  });

  // Publishes the streamed <video>'s screen geometry to UE so the
  // CursorGazeComponent can translate the host OS cursor into video-
  // relative coords.
  useVideoRectPublisher(pixelStreaming, videoParentRef);

  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);
  // Bumped after every chat round so the Reminders panel re-fetches.
  const [refreshKey, setRefreshKey] = useState(0);

  // Single active widget panel — lifted up so opening one closes the
  // others. The dock and the sheet both subscribe to this state.
  const [activeWidget, setActiveWidget] = useState<SheetKey | null>(null);

  // Refs to each widget icon so SheetPanel can restore focus on close.
  const reminderRef = useRef<HTMLButtonElement | null>(null);
  const stocksRef = useRef<HTMLButtonElement | null>(null);
  const newsRef = useRef<HTMLButtonElement | null>(null);
  const weatherRef = useRef<HTMLButtonElement | null>(null);
  const triggerRefs = useMemo(() => ({
    reminders: reminderRef,
    stocks: stocksRef,
    news: newsRef,
    weather: weatherRef,
  }), []);

  // Rail-badge state — fetched at the App level so the badges
  // populate even before the user has ever opened the corresponding
  // panel. The panels still own their own fetch loop for their full
  // content; this is just the lightweight count/aggregate snapshot.
  const [remindersCount, setRemindersCount] = useState(0);
  const [stocksDayPct, setStocksDayPct] = useState<number | null>(null);

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
  // mode uses this to gate VAD and to detect barge-in.
  const isAISpeakingRef = useRef(false);

  // Forward declaration for cross-references between voice and chat.
  const notifyAIFinishedRef = useRef<() => void>(() => {});

  const handleSendMessage = useCallback(async (message: string) => {
    if (isSending) return;
    setIsSending(true);
    isAISpeakingRef.current = true;

    memory.add('user', message);
    const history = memory.getHistory();

    try {
      const result = await chatViaSoul(message, {
        systemExtension: persona.prompt,
        history,
      });

      if (result.response) memory.add('assistant', result.response);

      const action = result.action;
      const actionName = action?.name;
      const isAnimAction = actionName === 'give_a_kiss'
        || actionName === 'do_dance'
        || actionName === 'say_hello';

      if (pixelStreaming) {
        pixelStreaming.emitUIInteraction({
          EventType: 'respond_with_mood_server',
          JobId: result.id,
          Mood: result.mood,
          Response: toBase64(result.response),
          Behavior: result.behavior ?? '',
          Timestamp: new Date().toISOString(),
        });

        if (isAnimAction && action) {
          dispatchActionToUE(pixelStreaming, action, result.response);
        }
      }

      if (action && isReminderAction(action.name)) {
        setRefreshKey(k => k + 1);
      }

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

  // Slash-command animation dispatcher — hands a ready-to-go UE
  // descriptor to the dock so it can fire `/dance`, `/kiss`, `/hello`
  // without round-tripping through the LLM.
  const dispatchAnimation = useCallback((
    name: 'give_a_kiss' | 'do_dance' | 'say_hello',
  ) => {
    if (!pixelStreaming) return;
    const eventType = name === 'do_dance' ? 'doDance' : name;
    pixelStreaming.emitUIInteraction({
      EventType: eventType,
      SendData: true,
      Response: '',
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming]);

  const voice = useVoiceAgent({
    onTranscript: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      void handleSendMessage(trimmed);
    },
    isAISpeaking: () => isAISpeakingRef.current,
    whisperPrompt: () => `Conversation with ${persona.displayName}.`,
    onBargeIn: () => {
      const v = document.querySelector('video');
      if (v) v.muted = true;
      isAISpeakingRef.current = false;
    },
    onError: (msg) => console.warn('[voice]', msg),
  });

  useEffect(() => {
    notifyAIFinishedRef.current = voice.notifyAIFinished;
  }, [voice.notifyAIFinished]);

  useEffect(() => {
    if (isSending) {
      const v = document.querySelector('video');
      if (v) v.muted = false;
    }
  }, [isSending]);

  // Top-level badge poll. Independent of the panels — the rail
  // shows counts from app start, and refresh on every chat round
  // (so reminder tool calls reflect immediately).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await listReminders();
      if (!cancelled && r.available) {
        setRemindersCount(r.reminders.filter(x => !x.completed_at).length);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const fetchStocks = async () => {
      const s = await getStocks();
      if (cancelled) return;
      if (s.available && s.data && s.data.quotes.length > 0) {
        const avg = s.data.quotes.reduce((acc, q) => acc + q.change_pct, 0)
          / s.data.quotes.length;
        setStocksDayPct(avg);
      }
    };
    void fetchStocks();
    const id = window.setInterval(fetchStocks, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const handleClearMemory = useCallback(() => {
    if (memory.turns.length === 0) return;
    memory.clear();
  }, [memory]);

  // Toggle a sheet open/closed. When closing, also surrender focus
  // back to the dock — SheetPanel handles the refocus itself but
  // anyone calling toggle directly needs the same effect.
  const handleToggleWidget = useCallback((key: SheetKey) => {
    setActiveWidget(prev => (prev === key ? null : key));
  }, []);

  const handleCloseSheet = useCallback(() => setActiveWidget(null), []);

  const isConnected = connectionState === 'connected';
  // "Reconnecting…" shows whenever we're not in the connected state.
  // The loading screen takes over for the very first connect, so we
  // gate this on `connectionState !== 'connecting'` to avoid stacking
  // the banner on top of the logo while the socket is still warming up.
  const showReconnecting = connectionState !== 'connected'
    && connectionState !== 'connecting';

  // Active sheet content. App owns the routing so the SheetPanel
  // doesn't need to know about the data layer.
  const sheetContent = useMemo(() => {
    switch (activeWidget) {
      case 'reminders':
        return (
          <RemindersPanel
            refreshKey={refreshKey}
            onCountChange={setRemindersCount}
          />
        );
      case 'stocks':
        return (
          <StocksPanel
            refreshKey={refreshKey}
            onDayPctChange={setStocksDayPct}
          />
        );
      case 'news':
        return <NewsPanel refreshKey={refreshKey} />;
      case 'weather':
        return <WeatherPanel refreshKey={refreshKey} />;
      default:
        return null;
    }
  }, [activeWidget, refreshKey]);

  // Cycle through personas — chevron-prev / chevron-next versions for
  // the AgentSwitcher row above the input bar.
  const handlePrevPersona = useCallback(() => {
    handleAgentSwitch((currentAgentIndex - 1 + AGENTS.length) % AGENTS.length);
  }, [currentAgentIndex, handleAgentSwitch]);
  const handleNextPersona = useCallback(() => {
    handleAgentSwitch((currentAgentIndex + 1) % AGENTS.length);
  }, [currentAgentIndex, handleAgentSwitch]);

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <StreamView
        videoParentRef={videoParentRef}
        connectionState={connectionState}
      />
      <Titlebar
        memoryCount={memory.turns.length}
        personaName={persona.displayName}
        onClearMemory={handleClearMemory}
        showReconnecting={showReconnecting}
      />

      <Greeting userName="Aryan" />

      <WidgetRail
        activeWidget={activeWidget}
        onToggle={handleToggleWidget}
        remindersCount={remindersCount}
        stocksDayPct={stocksDayPct}
        triggerRefs={triggerRefs}
      />

      <SheetPanel
        activeKey={activeWidget}
        onClose={handleCloseSheet}
        triggerRefs={triggerRefs}
      >
        {sheetContent}
      </SheetPanel>

      {/* Bottom dock — single InputBar pill with the AgentSwitcher
          inlined in its second row (matches the old project layout).
          Absolute-positioned so SheetPanel can never displace it. */}
      <div
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 16,
          zIndex: 30,
          pointerEvents: 'none',
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <InputBar
            personaName={persona.displayName}
            isSending={isSending}
            disabled={!isConnected || isSending}
            onSendMessage={handleSendMessage}
            onOpenSheet={handleToggleWidget}
            onDispatchAnimation={dispatchAnimation}
            onClearMemory={handleClearMemory}
            voice={{
              active: voice.isListening,
              disabled: isSending,
              vadLevel: voice.vadLevel,
              isUserSpeaking: voice.isUserSpeaking,
              isTranscribing: voice.isTranscribing,
              toggle: () => { void voice.toggle(); },
            }}
            onPrevPersona={handlePrevPersona}
            onNextPersona={handleNextPersona}
            personaDisabled={!isConnected}
          />
        </div>
      </div>
    </div>
  );
}
