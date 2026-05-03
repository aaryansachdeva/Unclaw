import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Titlebar } from './components/Titlebar';
import { StreamView } from './components/StreamView';
import { Greeting } from './components/Greeting';
import { InputBar, type InputBarHandle } from './components/InputBar';
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
import { useStreamingTranscriber } from './voice/useStreamingTranscriber';
import { chatViaSoul, SoulChatAction, SoulChatResult } from './services/soulChat';
import { pollNextEscalation } from './services/escalation';
import { listReminders } from './services/reminders';
import { getStocks } from './services/stocks';
import {
  deleteProfile,
  saveProfileEverywhere,
  syncProfile,
  type UserProfile,
} from './services/profile';
import {
  loadStoredToken,
  fetchCurrentUser,
  signOut,
  type AuthSession,
  type AuthUser,
} from './services/auth';
import { SignInScreen } from './components/Auth/SignInScreen';
import { Wizard } from './components/Onboarding/Wizard';
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
  // True while a gpt-5-mini escalation is running in the background. UI
  // can show a small "thinking" pill; input stays unblocked so the user
  // can still type. NOTE v1 limitation: a new chat round won't cancel
  // the escalation, so the background task may still queue an answer
  // that arrives after a follow-up message. Acceptable for now.
  const [escalating, setEscalating] = useState(false);
  // Recent activity labels streamed from soul (e.g. "navigating",
  // "looking at the page", "checking memory"). Stacked above the dock:
  // the latest sits at the bottom in full opacity, the previous one
  // floats above at half opacity, anything older animates out upward.
  // Caps at 2 visible. Empty array = no escalation in flight.
  const [statusHistory, setStatusHistory] = useState<Array<{ id: number; text: string }>>([]);
  const statusIdRef = useRef(0);

  // Pending screenshot stack — base64 PNGs captured via the global
  // shortcut (Ctrl+Shift+G) or the trigger button. The user can stack
  // multiple captures by hitting the shortcut several times before
  // sending; all of them ride along with the next chat message so the
  // vision model can compare/correlate them. Each shot has a stable
  // id so the row can animate in/out cleanly with framer-motion.
  // Cleared as a unit on send, or one-at-a-time via × on each chip.
  const [attachedImages, setAttachedImages] = useState<Array<{
    id: number; base64: string; width: number; height: number;
  }>>([]);
  const screenshotIdRef = useRef(0);

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

  // Auth session — fetched at app start from safeStorage.
  //   undefined: still resolving (don't render anything auth-dependent)
  //   null:      no valid session, show SignInScreen
  //   object:    signed in
  const [authToken, setAuthToken] = useState<string | null | undefined>(undefined);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // User profile — fetched at app start. `null` means soul has no
  // profile yet, which triggers the onboarding wizard in firstRun mode.
  // `undefined` means the fetch hasn't resolved yet (we render nothing
  // profile-dependent until then to avoid a flash of "Aryan").
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  // Wizard visibility + mode. 'first' = no profile yet, can't be cancelled.
  // 'edit' = user reopened to tweak; cancel returns to chat.
  // null = wizard closed.
  const [wizardMode, setWizardMode] = useState<'first' | 'edit' | null>(null);

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

  // Streaming Moonshine transcriber. One instance for the whole app;
  // both push-to-talk (spacebar) and continuous voice mode (button)
  // drive the same low-level transcriber. They're mutually exclusive
  // — only one mode can be active at a time, enforced by the start
  // calls below.
  const streaming = useStreamingTranscriber();

  // Ref to the InputBar's imperative handle — used to drop the final
  // text from a push-to-talk session into the textarea so the user
  // can review and edit before sending.
  const inputBarRef = useRef<InputBarHandle | null>(null);

  // Push-to-talk state. Distinct from `streaming.isActive` because
  // the continuous voice button also flips streaming.isActive on,
  // and we only want the spacebar release to inject text into the
  // textarea (continuous mode auto-sends instead).
  const pushHeldRef = useRef(false);
  // Snapshot of the textarea's content at the moment voice activated.
  // Every streaming partial overwrites the textarea with
  //   `voiceBaselineRef.current + sep + committed + tentative`
  // so the unified surface always shows: existing-typed-text + the
  // currently-streaming voice text. On finalize/stop, baseline is
  // promoted to the new total so a subsequent activation appends
  // cleanly past the just-finalized text.
  const voiceBaselineRef = useRef<string>('');

  // Holds the currently-running escalation poll interval (if any) so we
  // can clear it from anywhere — useEffect cleanup, escalation done, etc.
  const escalationIntervalRef = useRef<number | null>(null);

  // Graceful interruption state.
  // ----------------------------------------------------------------------
  // `lastResponseRef` always reflects the most recent AI response text so
  // we can pass it as context if the user barges in mid-sentence.
  //
  // `pendingInterruptedRef` holds the response text captured AT THE MOMENT
  // of barge-in. It's threaded into the next chat's system_extension so
  // the LLM knows what it was saying when it got cut off and can adapt
  // (don't repeat info already shared, react to the user's new question).
  //
  // `bargeInResumeTimerRef` is the false-alarm timer: if barge-in fires
  // but no transcription comes back within ~1.5s (e.g. it was a cough,
  // background noise, or the mic picked up the AI's own voice), we
  // un-mute playback and let the AI keep going where it left off.
  const lastResponseRef = useRef<string>('');
  const pendingInterruptedRef = useRef<string | null>(null);
  const bargeInResumeTimerRef = useRef<number | null>(null);

  function clearBargeInTimer() {
    if (bargeInResumeTimerRef.current !== null) {
      window.clearTimeout(bargeInResumeTimerRef.current);
      bargeInResumeTimerRef.current = null;
    }
  }

  /** Drive UE for one chat result: face/mood/audio descriptor, optional
   *  animation action (kiss/dance/hello), reminder-panel refresh, and
   *  the speaking-finished timer for the voice barge-in gate. Used both
   *  for the primary /chat response AND for each polled escalation step. */
  const dispatchChatResult = useCallback((result: SoulChatResult) => {
    if (result.response) {
      memory.add('assistant', result.response);
      // Cache the latest response so a barge-in can pass it as
      // "what I was just saying" context to the LLM.
      lastResponseRef.current = result.response;
    }

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

    isAISpeakingRef.current = true;
    const speakSec = (result as { duration?: number }).duration ?? 4;
    window.setTimeout(() => {
      isAISpeakingRef.current = false;
      notifyAIFinishedRef.current();
    }, Math.round(speakSec * 1000));
  }, [pixelStreaming, memory]);

  /** Start a 1.2s poll loop against /escalation/{id}/next. Each polled
   *  result is dispatched through the same UE pipeline a primary /chat
   *  result uses. Stops when the server says no more work AND the queue
   *  is drained. The polling rate is conservative: gpt-5-mini + browser
   *  tools have multi-second loops and there's nothing to gain by
   *  hammering the endpoint faster. */
  const startEscalationPolling = useCallback((jobId: string) => {
    // Clear any previous interval — defensive, e.g. if two escalations
    // overlapped (shouldn't happen but isSending isn't bulletproof).
    if (escalationIntervalRef.current !== null) {
      window.clearInterval(escalationIntervalRef.current);
      escalationIntervalRef.current = null;
    }
    setEscalating(true);
    statusIdRef.current += 1;
    setStatusHistory([{ id: statusIdRef.current, text: 'thinking' }]);

    const stop = () => {
      if (escalationIntervalRef.current !== null) {
        window.clearInterval(escalationIntervalRef.current);
        escalationIntervalRef.current = null;
      }
      setEscalating(false);
      setStatusHistory([]);
    };

    const pushStatus = (text: string) => {
      setStatusHistory(prev => {
        if (prev.length > 0 && prev[prev.length - 1].text === text) return prev;
        statusIdRef.current += 1;
        const next = [...prev, { id: statusIdRef.current, text }];
        return next.slice(-2);
      });
    };

    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const step = await pollNextEscalation(jobId);
        if (!step) {
          // Network error or 404 (e.g. server purged after TTL).
          // Treat a 404-after-success as a graceful stop; transient
          // network errors will resolve on the next tick.
          return;
        }
        if (step.status) {
          pushStatus(step.status);
        }
        if (step.result) {
          dispatchChatResult(step.result);
        }
        if (!step.more && !step.result) {
          stop();
        }
      } finally {
        inFlight = false;
      }
    };
    // First tick right away so the user doesn't wait the full interval
    // for whatever might already be queued.
    void tick();
    escalationIntervalRef.current = window.setInterval(() => {
      void tick();
    }, 1200);
  }, [dispatchChatResult]);

  // Tidy up the polling interval when App unmounts — orphaned intervals
  // would keep firing fetches against a dead server.
  useEffect(() => () => {
    if (escalationIntervalRef.current !== null) {
      window.clearInterval(escalationIntervalRef.current);
      escalationIntervalRef.current = null;
    }
  }, []);

  // Subscribe to screenshots captured via the Ctrl+Shift+G global
  // shortcut (or a manual trigger). The captured PNG sits as a pending
  // attachment until the user sends their next message, which carries
  // it to soul and routes the request to the vision-capable escalation
  // model.
  //
  // After staging the image we also focus the input bar so the user
  // can immediately type a prompt about the screenshot. The window
  // itself is already pulled to front by main.ts (mainWindow.show +
  // focus); this completes the gesture by landing the caret in the
  // textarea. requestAnimationFrame defers one tick so React has
  // committed the re-render with the new chip before the focus call.
  useEffect(() => {
    if (!window.electronAPI?.onScreenshotCaptured) return;
    return window.electronAPI.onScreenshotCaptured((payload) => {
      screenshotIdRef.current += 1;
      setAttachedImages((prev) => [...prev, {
        id: screenshotIdRef.current,
        base64: payload.base64,
        width: payload.width,
        height: payload.height,
      }]);
      requestAnimationFrame(() => {
        inputBarRef.current?.focus();
      });
    });
  }, []);


  // Same staging as Ctrl+Shift+G screenshots, but for clipboard paste
  // inside the input bar. InputBar normalizes the image to PNG before
  // it reaches us, so this handler can just push and forget.
  const handlePasteImage = useCallback(
    (img: { base64: string; width: number; height: number }) => {
      screenshotIdRef.current += 1;
      setAttachedImages((prev) => [...prev, {
        id: screenshotIdRef.current,
        base64: img.base64,
        width: img.width,
        height: img.height,
      }]);
    },
    [],
  );

  const handleSendMessage = useCallback(async (message: string) => {
    if (isSending) return;

    // Allow image-only sends: the user can stage one or more
    // screenshots and hit Enter with no text. Soul fills in a generic
    // "What is shown in this screenshot?" prompt on its end.
    const trimmed = message.trim();
    const pendingImages = attachedImages;
    if (!trimmed && pendingImages.length === 0) return;

    // Interrupt any in-flight escalation BEFORE sending the new
    // message. Stops the polling loop and clears the status pill.
    // The actual audio cutoff happens on the UE side: as soon as
    // soul stops sending fresh ARKit curves (because we cancelled
    // the escalation server-side and the new response will replace
    // the playback descriptor anyway), UE's lipsync component runs
    // out of frames and the speech ends.
    if (escalationIntervalRef.current !== null) {
      window.clearInterval(escalationIntervalRef.current);
      escalationIntervalRef.current = null;
    }
    setEscalating(false);
    setStatusHistory([]);
    isAISpeakingRef.current = false;

    // If a barge-in fired and resulted in this send, un-mute audio
    // (it was muted when barge-in started) and cancel the false-
    // alarm "resume" timer. The interrupted text below will be
    // threaded into the LLM's system extension so it can adapt.
    clearBargeInTimer();
    const interruptedText = pendingInterruptedRef.current;
    pendingInterruptedRef.current = null;
    const videoEl = document.querySelector('video');
    if (videoEl) videoEl.muted = false;

    setIsSending(true);
    isAISpeakingRef.current = true;

    if (trimmed) memory.add('user', trimmed);
    const history = memory.getHistory();

    // Snapshot the screenshot stack at send time and immediately
    // clear so the user can start staging the next batch without
    // waiting for this round to finish.
    if (pendingImages.length > 0) setAttachedImages([]);

    // When the user interrupts mid-response, give the LLM the text it
    // was saying so it can adapt — don't repeat info, treat the user's
    // input as a follow-up/correction. Composed AFTER the persona
    // prompt so the persona voice still leads.
    const systemExt = interruptedText
      ? `${persona.prompt}\n\n[INTERRUPTION CONTEXT] You were just speaking when the user interrupted you. The text you were in the middle of saying was: "${interruptedText.slice(0, 600)}". The user may have only heard part of it. Respond to what they're saying NOW — don't simply repeat what you already said. If their new message is a follow-up question, a correction, or a tangent, address it directly and naturally.`
      : persona.prompt;

    try {
      const result = await chatViaSoul(trimmed, {
        systemExtension: systemExt,
        history,
        images: pendingImages.map((img) => img.base64),
      });

      dispatchChatResult(result);

      // 20b chose to escalate (or soul auto-routed to escalation
      // because we attached image(s)). The transition reply has
      // already been voiced via dispatchChatResult — now start
      // polling for narrations and the final response.
      if (result.escalation && result.escalation.id) {
        startEscalationPolling(result.escalation.id);
      }
    } catch (err) {
      console.error('[chat] soul /chat failed:', err);
      isAISpeakingRef.current = false;
    } finally {
      setIsSending(false);
    }
  }, [isSending, persona, memory, attachedImages, dispatchChatResult, startEscalationPolling]);

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
    // Continuous voice mode pipes through the same Moonshine streaming
    // transcriber as push-to-talk, so the input bar shows partial
    // words while the user speaks. VoiceController owns the mic + VAD;
    // it just routes the audio into `streaming` and reads the final
    // text from finalize() on endpoint detection.
    streaming: {
      startFeed: streaming.startFeed,
      pushFrame: streaming.pushFrame,
      finalize: streaming.finalize,
      stop: streaming.stop,
    },
    onBargeIn: () => {
      // Stage 1: tentative interruption — we've heard ~256 ms of
      // confident user speech while the AI is talking. Mute audio
      // immediately so the user has silence to talk into; cache
      // what was being said so the next chat (if it actually
      // fires) can pass it to the LLM as "you were interrupted
      // saying X" context.
      const v = document.querySelector('video');
      if (v) v.muted = true;
      isAISpeakingRef.current = false;
      pendingInterruptedRef.current = lastResponseRef.current || null;

      // Stage 2: false-alarm guard — if no transcription comes
      // back within the resume window, the "barge-in" was probably
      // noise/cough/echo. Restore audio playback and clear the
      // pending-interrupt state so the AI keeps going where it
      // left off without the LLM ever hearing about it.
      clearBargeInTimer();
      bargeInResumeTimerRef.current = window.setTimeout(() => {
        bargeInResumeTimerRef.current = null;
        // Only resume if no real chat fired in the meantime.
        if (pendingInterruptedRef.current !== null) {
          pendingInterruptedRef.current = null;
          const v2 = document.querySelector('video');
          if (v2) v2.muted = false;
          // Don't flip isAISpeakingRef back to true — the audio
          // was already in flight and its natural duration timer
          // (set in dispatchChatResult) will clear it normally.
        }
      }, 1500);
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
  // (so reminder tool calls reflect immediately). Gated on the
  // pixel-streaming connection: nothing hits soul before the stream
  // is up, so a cold launch doesn't burn requests against a server
  // that the user hasn't even seen the agent on yet.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    let cancelled = false;
    void (async () => {
      const r = await listReminders();
      if (!cancelled && r.available) {
        setRemindersCount(r.reminders.filter(x => !x.completed_at).length);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, connectionState]);

  // Resume auth session on app start. Independent of stream state —
  // the SignInScreen renders over the loading screen anyway, so the
  // user can authenticate while the UnClaw Engine is still warming up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadStoredToken();
        if (cancelled) return;
        if (!stored) {
          setAuthToken(null);
          setAuthUser(null);
          return;
        }
        const user = await fetchCurrentUser(stored);
        if (cancelled) return;
        if (user) {
          setAuthToken(stored);
          setAuthUser(user);
        } else {
          setAuthToken(null);
          setAuthUser(null);
        }
      } catch {
        if (!cancelled) {
          setAuthToken(null);
          setAuthUser(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSignedIn = useCallback((session: AuthSession) => {
    setAuthToken(session.token);
    setAuthUser(session.user);
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut(authToken ?? null);
    setAuthToken(null);
    setAuthUser(null);
    setProfile(undefined);
    setWizardMode(null);
    // Allow a fresh sync if the user signs back in this session.
    profileSyncedRef.current = false;
  }, [authToken]);

  // Fetch the user profile, but only once the stream is connected.
  // Null -> open the onboarding wizard in firstRun mode. Any non-null
  // profile lets us silently skip onboarding and feed the saved name
  // into the greeting / system prompts. Server-side rendering of the
  // profile into chat prompts happens automatically in soul, so we
  // don't have to thread profile values into the systemExtension here.
  const profileSyncedRef = useRef(false);
  useEffect(() => {
    // Profile sync runs once we have BOTH a connected stream AND a
    // signed-in user. The sync reconciles cloud (Worker) and local
    // (soul) — cloud wins when present, soul migrates up when cloud
    // is empty. Wizard fires only when both sides are empty.
    if (connectionState !== 'connected') return;
    if (!authToken) return;
    if (profileSyncedRef.current) return;
    profileSyncedRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const p = await syncProfile(authToken);
        if (cancelled) return;
        setProfile(p);
        if (!p) setWizardMode('first');
      } catch (err) {
        if (cancelled) return;
        console.warn('[profile] sync failed', err);
        // Fail-soft: treat as "no profile" so the wizard opens. The
        // user can re-enter their info; next sync will mirror it.
        setProfile(null);
        setWizardMode('first');
      }
    })();
    return () => { cancelled = true; };
  }, [connectionState, authToken]);

  useEffect(() => {
    if (connectionState !== 'connected') return;
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
  }, [connectionState]);

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

  // Push-to-talk: hold spacebar -> stream voice -> release -> the
  // dictated text stays in the textarea past wherever the user was.
  //
  // Activation contexts:
  //   * Outside any text field: voice activates immediately on the
  //     first non-repeat keydown.
  //   * Inside a text field (textarea/input): the first few spaces
  //     type normally so a SINGLE-press space remains a literal space.
  //     Once the OS auto-repeat hits LONG_HOLD_REPEATS, voice
  //     activates AND we strip the run of trailing spaces the user
  //     just typed (so they don't end up in the prompt).
  //
  // Behavior:
  //   * Voice DOES NOT swap the textarea for a separate view. The
  //     textarea remains the surface; partial transcriptions drive
  //     setText() on every update so words appear past the user's
  //     baseline content (snapshot at activation time).
  //   * Successive activations APPEND naturally — baseline gets
  //     promoted on each finalize so the next press starts from the
  //     end of what was just dictated.
  //   * Window focus is required: an out-of-focus app won't grab
  //     spacebar (the listener wouldn't fire then anyway, but we
  //     belt-and-suspender it with document.hasFocus()).
  //   * Disabled while the continuous-voice button is on — it owns
  //     the mic and runs its own activation loop.
  useEffect(() => {
    if (!isConnected || !authToken) return undefined;

    const LONG_HOLD_REPEATS = 8;     // ~250 ms at typical 30 Hz auto-repeat
    let repeatCount = 0;

    const isTextTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const startVoice = (fromTextField: boolean) => {
      if (pushHeldRef.current) return;
      if (voice.isListening) return;
      pushHeldRef.current = true;
      // Strip the run of literal spaces the OS auto-repeated into the
      // textarea while we were detecting the hold. Critical: do it
      // SYNCHRONOUSLY by reading the text now, computing the stripped
      // version, AND mirroring it into the textarea — if we just call
      // a strip method on the InputBar the React setMessage is async
      // and getText() in the next line still returns the un-stripped
      // value. That bug was leaving 8+ trailing spaces in the
      // baseline, which then survived the next finalize.
      let baseline = inputBarRef.current?.getText() ?? '';
      if (fromTextField) {
        const stripped = baseline.replace(/[ \t]+$/u, '');
        if (stripped !== baseline) {
          inputBarRef.current?.setText(stripped);
          baseline = stripped;
        }
      }
      voiceBaselineRef.current = baseline;
      void streaming.start('push').catch((err) => {
        pushHeldRef.current = false;
        console.warn('[push-to-talk] start failed', err);
      });
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Only act when the app actually has OS-level focus. Without
      // this guard, OS-level keystroke routing in Electron windows
      // can occasionally fire keydown for background windows on
      // some configurations.
      if (!document.hasFocus()) return;

      const inText = isTextTarget(e.target);

      if (e.repeat) {
        repeatCount += 1;
        if (inText && !pushHeldRef.current && repeatCount >= LONG_HOLD_REPEATS) {
          e.preventDefault();
          startVoice(true);
          return;
        }
        if (pushHeldRef.current) {
          // Hold continues — swallow further auto-repeat spaces.
          e.preventDefault();
        }
        return;
      }

      // Initial keydown (no repeat yet).
      repeatCount = 0;
      if (inText) {
        // Let the first space type normally. Voice activation
        // requires the user to keep holding past LONG_HOLD_REPEATS.
        return;
      }
      // Outside text fields: activate immediately.
      e.preventDefault();
      startVoice(false);
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      repeatCount = 0;
      if (!pushHeldRef.current) return;
      pushHeldRef.current = false;
      e.preventDefault();
      void (async () => {
        const baseline = voiceBaselineRef.current;
        const promote = (text: string) => {
          const trimmed = text.trim();
          const sep =
            baseline.length > 0 && trimmed.length > 0 && !baseline.endsWith(' ')
              ? ' '
              : '';
          const next = trimmed ? `${baseline}${sep}${trimmed}` : baseline;
          inputBarRef.current?.setText(next);
          voiceBaselineRef.current = next;
        };
        try {
          const finalText = await streaming.finalize();
          await streaming.stop();
          promote(finalText);
        } catch (err) {
          // Network died, server crashed, etc. Salvage whatever was
          // last successfully partial-transcribed so the user keeps
          // their words instead of having the textarea snap back to
          // the pre-voice baseline.
          const salvaged = streaming.committed.trim();
          console.warn(
            `[push-to-talk] finalize failed; salvaged ${salvaged.length} chars`,
            err,
          );
          promote(salvaged);
          await streaming.stop().catch(() => undefined);
        } finally {
          inputBarRef.current?.focus();
        }
      })();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [isConnected, authToken, streaming, voice.isListening]);

  // Drive the textarea live as streaming partials arrive. ONLY the
  // committed portion lands in the textarea — tentative text gets
  // rendered as a light-gray overlay sitting on top of the textarea
  // (handled by InputBar via the voiceTentative prop). This way the
  // unconfirmed words have a clear visual distinction from the
  // committed text without requiring a separate live-transcript view.
  // Effect deps don't include tentative — that re-renders InputBar
  // directly through its prop, no need to call setText for it.
  useEffect(() => {
    if (!streaming.isActive) return;
    const baseline = voiceBaselineRef.current;
    // trimStart on the committed string — defensive: tokenizer
    // decoders sometimes emit a leading whitespace that survives the
    // server-side .strip() (e.g. NBSP). Stripping client-side too
    // ensures the textarea never starts with whitespace.
    const c = streaming.committed.trim().replace(/^\s+/u, '');
    if (!c) {
      inputBarRef.current?.setText(baseline);
      return;
    }
    const sep =
      baseline.length > 0 && !baseline.endsWith(' ') ? ' ' : '';
    inputBarRef.current?.setText(`${baseline}${sep}${c}`);
  }, [streaming.isActive, streaming.committed]);

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
        user={authUser}
        onSignOut={() => { void handleSignOut(); }}
      />

      {/* Sign-in screen. Mounted whenever auth has resolved to "no
          session" — sits over the loading screen so the user can
          authenticate while the UnClaw Engine is still warming up.
          Renders on top of everything else (zIndex 60). */}
      {authToken === null && (
        <SignInScreen onSignedIn={handleSignedIn} />
      )}

      {/* Everything below this point — greeting, widgets, sheet, status,
          screenshots, input bar, wizard — is gated on BOTH a connected
          stream AND a signed-in user. */}
      {isConnected && authToken && (
        <>
      <Greeting userName={profile?.name || 'friend'} />

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

      {/* Escalation status — stacked text-only labels streaming the
          current activity ("thinking", "navigating", "looking at the
          page", etc.) just above the input bar. Newest sits at the
          bottom in full opacity; the prior one floats above at half
          opacity. When a third arrives the oldest exits upward.
          `layout` slides the prior label up smoothly as the new one
          enters from below. */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          // Sits above the screenshot-thumbnail anchor (122) so the
          // two never overlap. When the thumbnail row is present the
          // status floats higher to clear the chips.
          bottom: attachedImages.length > 0 ? 220 : 122,
          zIndex: 31,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-start',
          transition: 'bottom 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <AnimatePresence initial={false}>
          {escalating && statusHistory.map((s, i) => {
            const isNewest = i === statusHistory.length - 1;
            return (
              <motion.span
                key={s.id}
                layout
                initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
                animate={{
                  opacity: isNewest ? 0.95 : 0.42,
                  y: 0,
                  filter: 'blur(0px)',
                }}
                exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  fontStyle: 'italic',
                  letterSpacing: '0.01em',
                  color: 'var(--text-secondary)',
                  textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.text}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Pending screenshot stack — shown when the user has captured
          one or more images via Ctrl+Shift+G. Each chip animates in
          from below with a tiny stagger; hovering reveals an × per
          chip. The whole row sits directly above the input bar.
          On send, the entire stack rides along with the message. */}
      {attachedImages.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            bottom: 122,
            zIndex: 32,
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <AnimatePresence initial={false}>
            {attachedImages.map((img) => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.94 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ScreenshotThumbnail
                  base64={img.base64}
                  onDismiss={() =>
                    setAttachedImages((prev) =>
                      prev.filter((x) => x.id !== img.id))
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Bottom dock — single InputBar pill with the AgentSwitcher
          inlined in its second row (matches the old project layout).
          Absolute-positioned so SheetPanel can never displace it.
          Hidden while the onboarding wizard is open: the wizard
          OCCUPIES this same anchor (left:16, right:16, bottom:16),
          so the input bar would visually fight it. We also gate on
          `profile !== undefined` so the bar doesn't flash before the
          first profile fetch resolves. */}
      {profile !== undefined && !wizardMode && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
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
              ref={inputBarRef}
              personaName={persona.displayName}
              isSending={isSending}
              disabled={!isConnected}
              hasAttachments={attachedImages.length > 0}
              onSendMessage={handleSendMessage}
              onOpenSheet={handleToggleWidget}
              onDispatchAnimation={dispatchAnimation}
              onClearMemory={handleClearMemory}
              onOpenOnboarding={() => setWizardMode('edit')}
              onResetProfile={() => {
                void deleteProfile()
                  .catch((err) => console.warn('[profile] delete failed', err))
                  .finally(() => {
                    setProfile(null);
                    setWizardMode('first');
                  });
              }}
              voice={{
                active: voice.isListening,
                disabled: isSending,
                vadLevel: voice.vadLevel,
                isUserSpeaking: voice.isUserSpeaking,
                isTranscribing: voice.isTranscribing,
                toggle: () => { void voice.toggle(); },
              }}
              voiceActive={streaming.isActive}
              voiceTentative={
                streaming.isActive
                  ? streaming.tentative.trim().replace(/^\s+/u, '')
                  : ''
              }
              onPrevPersona={handlePrevPersona}
              onNextPersona={handleNextPersona}
              personaDisabled={!isConnected}
              onPasteImage={handlePasteImage}
            />
          </div>
        </motion.div>
      )}

      {/* Onboarding wizard. Mounted on first launch (no profile) and
          on demand via the pencil icon / /onboard slash command. The
          welcome line plays automatically on first-run mount; the
          aha-moment greeting plays after a successful save. Both flow
          through dispatchChatResult so UE plays them via the same
          path as a regular reply. */}
      <AnimatePresence>
        {wizardMode && (
          <Wizard
            key="onboarding-wizard"
            firstRun={wizardMode === 'first'}
            initial={profile}
            personaPrompt={persona.prompt}
            onSave={(p) => saveProfileEverywhere(p, authToken ?? null)}
            onChatResult={dispatchChatResult}
            onComplete={(saved) => {
              setProfile(saved);
              setWizardMode(null);
            }}
            onCancel={() => setWizardMode(null)}
          />
        )}
      </AnimatePresence>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Screenshot thumbnail — pending attachment preview shown above the
// input bar after the user captures a region via Ctrl+Shift+G. Hover
// reveals a circular × that clears the attachment without sending.
// ---------------------------------------------------------------------

function ScreenshotThumbnail({
  base64,
  onDismiss,
}: {
  base64: string;
  onDismiss: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        height: 84,
        maxWidth: 220,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        boxShadow: '0 6px 20px -4px rgba(0, 0, 0, 0.50)',
        background: 'rgba(20, 22, 28, 0.6)',
        backdropFilter: 'blur(20px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
        cursor: 'default',
      }}
    >
      <img
        src={`data:image/png;base64,${base64}`}
        // Empty alt: the thumbnail is decorative UI, not standalone
        // content. Screen readers skip it; on render failure no text
        // leaks where the image would be.
        alt=""
        draggable={false}
        style={{
          display: 'block',
          height: '100%',
          width: 'auto',
          maxWidth: 220,
          objectFit: 'cover',
        }}
      />
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Remove screenshot"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'rgba(20, 20, 20, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          color: 'rgba(255, 255, 255, 0.95)',
          // Flex-center the icon so it lands dead center regardless
          // of font metrics. Replaces a literal '×' glyph (which sat
          // a few pixels above the optical center on most fonts).
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          cursor: 'pointer',
          opacity: hover ? 1 : 0,
          transform: hover ? 'scale(1)' : 'scale(0.85)',
          transition:
            'opacity 0.16s cubic-bezier(0.16,1,0.3,1), transform 0.16s cubic-bezier(0.16,1,0.3,1)',
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}
