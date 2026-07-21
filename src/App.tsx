import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertTriangle } from 'lucide-react';
import { Titlebar } from './components/Titlebar';
import { StreamView } from './components/StreamView';
import { Greeting } from './components/Greeting';
import { InputBar, type InputBarHandle } from './components/InputBar';
import { ChatPane, ChatPaneHeader } from './components/ChatPane';
import { WidgetRail } from './components/WidgetRail';
import { SheetPanel } from './components/SheetPanel';
import { RemindersPanel } from './components/Reminders';
import { StocksPanel } from './components/Stocks';
import { NewsPanel } from './components/News';
import { WeatherPanel } from './components/Weather';
// Shared color/lighting constants live in CustomizationOverlay; the unified
// customization surface itself is CustomWardrobe (drives every character now).
import { ACCENT_COLORS, BG_COLORS, BG_GLOW_DEFAULT, LIGHT_INTENSITY_DEFAULT, CLOTHING_COLORS } from './components/CustomizationOverlay';
import { CustomWardrobe } from './components/CustomWardrobe';
import { CameraModeToggle } from './components/CameraModeToggle';
import { StreamEffects } from './components/StreamEffects';
import { dressCharacter, type DressScope } from './wardrobe/dressCharacter';
import { wardrobeDefaultsFor } from './wardrobe/catalog';
import { cameraCustomize, cameraForMode, cameraDefaultFor, type CameraMode } from './wardrobe/camera';
import { PulseGrid } from './components/PulseGrid';
import { hexToRgb01, round3 } from './components/ColorPickerPanel';
import { useEnvironment } from './hooks/useEnvironment';
import { SettingsPanel } from './components/SettingsPanel';
import { SoulBootScreen } from './components/SoulBootScreen';
import { SetupWizard } from './components/SetupWizard';
import { UpdateOverlay } from './components/UpdateOverlay';
import type { WardrobeSettings } from './services/userSettings';
import {
  initSoulBase,
  getSoulBaseUrl,
  getSignallingPlayerUrl,
  subscribeSoulPorts,
} from './services/soulBase';
import { usePixelStreaming } from './hooks/usePixelStreaming';
import { useVideoRectPublisher } from './hooks/useVideoRectPublisher';
import { useChatMemory, type Turn } from './hooks/useChatMemory';
import { fetchCloudChat, pushCloudChat, gatherLocalChat, restoreLocalChat, deleteCloudChat } from './services/chatSync';
import { SheetKey } from './hooks/useSheet';
import { useVoiceAgent } from './voice/useVoiceAgent';
import { useStreamingTranscriber } from './voice/useStreamingTranscriber';
import { chatViaSoul, streamChatViaSoul, fireIdle, fetchCurrentBodyIdle, SoulBodyDirective, SoulChatAction, SoulChatChunk, SoulChatResult } from './services/soulChat';
import { startPassthroughBridge } from './services/passthrough';
import { usePassthroughPrefs } from './hooks/usePassthroughPrefs';
import { pollNextEscalation } from './services/escalation';
import { sendListeningEvent } from './services/listening';
import { listReminders } from './services/reminders';
import { expressFace } from './services/express';
import { getStocks } from './services/stocks';
import {
  deleteSettings,
  saveSettingsEverywhere,
  reconcileForAccount,
  firstName,
  type UserSettings,
} from './services/userSettings';
import {
  loadStoredToken,
  fetchCurrentUser,
  signOut,
  type AuthSession,
  type AuthUser,
} from './services/auth';
import { resetEverything } from './services/accountReset';
import { fetchApiKeys, modelSupportsVision } from './services/apiKeys';
import { Wizard } from './components/Onboarding/Wizard';
import { characterFor } from './characters';
import { AGENTS, type Agent } from './types';
import { useAgentStack, BASE_AGENT, BASE_INSTANCE_ID } from './hooks/useAgentStack';
import { AddCharacterPicker, type StoreEntry } from './components/AddCharacterPicker';
import { ClawsBalance } from './components/ClawsBalance';
import { fetchClaws, earnClaws, spendOnCharacter, CHARACTER_CLAW_COST } from './services/claws';
import {
  fetchEntitlements,
  createCheckout,
  fetchDownloadUrl,
  fetchVoiceUrls,
  BASE_CHARACTER_IDS,
  PAID_CHARACTER_IDS,
  STORE_PRICING,
  BUNDLE_SKU,
  BUNDLE_PRICE_USD,
} from './services/store';

/** Carousel sentinel: cycling onto this opens the Add picker over a blank
 *  stage (UE cleared via agentSwitch with an unknown id). */
const ADD_SLOT = '__add__';

/** Turn a raw chat/voice pipeline error into one short, on-brand line the
 *  end user can act on. The thrown message looks like
 *  `soul /chat 400: {"detail":"..."}`; we pull soul's detail out and map the
 *  common failures to a next move. End users never see devtools, so this is
 *  the only place they learn the request failed. */
function friendlyPipelineError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  let detail = raw;
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      const j = JSON.parse(brace[0]);
      if (j && typeof j.detail === 'string') detail = j.detail;
    } catch { /* keep raw */ }
  }
  const low = detail.toLowerCase();
  if (low.includes('llm_model is required') || low.includes('complete onboarding')) {
    return "No chat model is set. Open Settings and pick your chat model to start talking.";
  }
  if (/(401|403|unauthor|invalid.*key|authentication|api[ _-]?key)/.test(low)) {
    return "Couldn't reach the model. Check your API key in Settings.";
  }
  if (/(quota|insufficient_quota|429|rate.?limit|billing)/.test(low)) {
    return "The model provider rejected the request (quota or rate limit). Check your plan, then try again.";
  }
  if (/(timeout|timed out|502|503|504|econn|network|fetch failed|failed to fetch)/.test(low)) {
    return "Couldn't reach the model. Check your connection and try again.";
  }
  if (/(tts|voice|elevenlabs|kokoro|supertonic|11labs)/.test(low)) {
    return "Voice generation failed. Check your voice settings or key.";
  }
  return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
}

/** localStorage flag set when the user clicked "Continue without an
 *  account" on the sign-in screen. Persists across launches so guests
 *  don't see the sign-in screen on every relaunch. Cleared on real
 *  sign-in or on account reset. */
const GUEST_MODE_KEY = 'unclaw.guestMode';
/** Which account id the machine's local state (soul profile + API keys + local
 *  chat history) currently belongs to. Used to scope local data to an account
 *  so a different login can't inherit it. null/absent = guest/fresh machine. */
const LOCAL_ACCOUNT_KEY = 'unclaw.localAccountId';

/** Wipe every per-instance chat-history blob (`unclaw.chat.<id>`) from
 *  localStorage. Called when the machine changes owning account so the prior
 *  account's conversations don't show under the new one. */
function clearLocalChatHistory(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('unclaw.chat.')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

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

/** Forward soul's body-director directives (idle rotation, conviction-
 *  gated talk loops, explicit body tokens) to the text2body AnimBP.
 *  Each directive already carries its UIInteraction field names
 *  (idleNum/talkNum+talkTime/actionNum/gestureNum). Fire-and-forget:
 *  the AnimBP owns its own exits (ShouldPlay* bools are consume-flags
 *  cleared on state entry; Action leaves via the automatic rule,
 *  Talking via the TalkingTime timer, gestures via montage consume).
 *  Only doIdle persists, which is the point of idle rotation. */
let idleRevertTimer: number | null = null;
/** Drop a scheduled idle-revert. Called on character switch / reset so a
 *  timer armed for the PREVIOUS character can't fire a doIdle onto the next
 *  one (the revert idle number is character-agnostic in shape but was chosen
 *  for the body that scheduled it). */
function cancelScheduledIdleRevert(): void {
  if (idleRevertTimer !== null) {
    window.clearTimeout(idleRevertTimer);
    idleRevertTimer = null;
  }
}
function dispatchBodyToUE(
  ps: { emitUIInteraction: (descriptor: object) => void },
  body: SoulBodyDirective[] | undefined,
): void {
  if (!body?.length) return;
  for (const d of body) {
    const { event, clip, revertAfterS, revertIdleNum, ...fields } = d;
    if (event === 'doIdle' && idleRevertTimer !== null) {
      // A fresh idle pick supersedes any scheduled return-home.
      window.clearTimeout(idleRevertTimer);
      idleRevertTimer = null;
    }
    ps.emitUIInteraction({
      EventType: event,
      ...fields,
      Timestamp: new Date().toISOString(),
    });
    // Short idle VISITS carry a revert: after revertAfterS the body
    // returns to the home loop (idle is the one state UE never exits
    // on its own, and 5-10s is far finer than the idle-beat period).
    if (event === 'doIdle'
        && typeof revertAfterS === 'number' && revertAfterS > 0
        && typeof revertIdleNum === 'number') {
      idleRevertTimer = window.setTimeout(() => {
        idleRevertTimer = null;
        ps.emitUIInteraction({
          EventType: 'doIdle',
          idleNum: revertIdleNum,
          Timestamp: new Date().toISOString(),
        });
      }, revertAfterS * 1000);
    }
  }
}

/** Map a soul `action` payload to a UE descriptor and dispatch it. */
function dispatchActionToUE(
  ps: { emitUIInteraction: (descriptor: object) => void },
  action: SoulChatAction,
  speechText: string,
): void {
  const eventType =
    action.name === 'do_dance' ? 'doDance' :
    action.name === 'react_as_star_wars_fan' ? 'doSWIdle' :
    action.name;
  ps.emitUIInteraction({
    EventType: eventType,
    SendData: true,
    Response: toBase64(speechText),
    Timestamp: new Date().toISOString(),
  });
}

// Signalling player WS URL, resolved at usePixelStreaming mount time
// from the supervisor's live ports (soul picks via OS-assigned port
// 0). The hook below blocks on initSoulBase before constructing
// usePixelStreaming so this getter always returns the live port by
// the time it's called.
function signalingUrl(): string { return getSignallingPlayerUrl(); }

/**
 * Top-level gate: don't mount the main UI (and therefore the pixel-
 * streaming connection) until soul has booted. The Electron main
 * process spawns soul on app start and fires 'soul:ready' over IPC
 * once soul prints its READY banner. While we wait, SoulBootScreen
 * shows the live log stream so the user can see what's happening.
 *
 * If we mounted <usePixelStreaming> immediately, it would fight an
 * autoreconnect loop against soul's not-yet-listening signaling
 * server, flicker the connection state, and confuse the wardrobe
 * init handshake. Gating cleanly side-steps all of that.
 *
 * If electronAPI isn't present (e.g. someone opens the renderer in a
 * plain browser), we assume soul is reachable and bypass the gate
 * immediately, preserves the dev-portal use case.
 */
export function App() {
  // Setup gate (packaged-build first-run only). null = still checking;
  // the brief null render is preferable to a flash of SoulBootScreen
  // before realizing the wizard should run instead.
  const [setupComplete, setSetupComplete] = useState<boolean | null>(
    () => (typeof window === 'undefined' || !window.electronAPI?.setup) ? true : null,
  );

  useEffect(() => {
    if (setupComplete !== null) return;
    const api = window.electronAPI?.setup;
    if (!api) { setSetupComplete(true); return; }
    let cancelled = false;
    // Bounded retry. getStatus is a synchronous main-process snapshot so it
    // effectively never rejects, but if the IPC bridge isn't wired yet we
    // retry rather than guess. On give-up we default to FALSE (show the
    // wizard), NOT true: the wizard self-completes when setup is actually
    // done (its own getStatus reports isComplete and calls onComplete),
    // whereas assuming "complete" on a never-provisioned machine would
    // strand the user on the boot screen forever with no soul to wait on.
    const attempt = (retries: number) => {
      api.getStatus().then((snap) => {
        if (cancelled) return;
        setSetupComplete(snap?.isComplete ?? false);
      }).catch(() => {
        if (cancelled) return;
        if (retries > 0) setTimeout(() => attempt(retries - 1), 300);
        else setSetupComplete(false);
      });
    };
    attempt(3);
    return () => { cancelled = true; };
  }, [setupComplete]);

  // Focus reclamation for macOS floating-window quirk.
  //
  // Diagnosed via a console focus trace: a click on the streamed
  // <video> triggers `focus` → `mousedown` → `click` → `blur` ~33ms
  // after the click event completes. The blur is AppKit's documented
  // behavior for `NSFloatingWindowLevel` windows (Unclaw uses
  // `setAlwaysOnTop(true, 'floating')`): the floating window is
  // allowed to receive a click via `acceptFirstMouse: true`, but
  // key-window status is returned to the previously-active app once
  // the click delivery finishes, because floating windows are
  // designed as utility palettes, not primary surfaces.
  //
  // Two-listener defense:
  //   * mousedown (capture) records the timestamp, then asks the
  //     main process to focus us. This handles the FIRST click after
  //     focus loss.
  //   * blur catches AppKit's "return key status" yank a beat later;
  //     if it lands within 250ms of a recent mousedown AND we have
  //     not already retried for this click, we re-fire the focus
  //     IPC. One retry per click so we don't loop indefinitely if
  //     another app is legitimately holding focus.
  useEffect(() => {
    let lastClickAt = 0;
    let retriedForClickAt = 0;
    const onMouseDown = () => {
      lastClickAt = performance.now();
      retriedForClickAt = 0;
      if (document.hasFocus()) return;
      window.electronAPI?.focusWindow?.();
    };
    const onBlur = () => {
      const sinceClick = performance.now() - lastClickAt;
      if (sinceClick > 250) return;
      if (retriedForClickAt === lastClickAt) return;
      retriedForClickAt = lastClickAt;
      // Defer one frame so AppKit completes its activation routine
      // before we reassert. Without the frame delay the OS can
      // simply re-yank inside the same event loop pass.
      requestAnimationFrame(() => {
        window.electronAPI?.focusWindow?.();
      });
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('blur', onBlur, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('blur', onBlur, true);
    };
  }, []);

  // Update gate (packaged-build, every-launch). Sits between setup and
  // soul-boot, checks the remote manifest, downloads + swaps any drifted
  // categories, then dismisses (or shows a restart prompt). Defaults to
  // true when the update IPC isn't available (dev, pre-update-API builds).
  const [updatesChecked, setUpdatesChecked] = useState<boolean>(
    () => typeof window === 'undefined' || !window.electronAPI?.update,
  );

  const [soulReady, setSoulReady] = useState(
    // Default to ready when running outside Electron, the renderer
    // in a browser dev session has no main-process soul supervisor
    // to wait on, and the user is presumably running `./run_soul.sh`
    // themselves.
    () => typeof window === 'undefined' || !window.electronAPI?.soul,
  );

  // Ports gate. After soulReady fires we still wait one tick for the
  // service-base cache to hydrate from the supervisor (its [ports]
  // IPC always lands BEFORE [ready], but renderer-side initSoulBase
  // hasn't been awaited yet). Without this, AppMain mounts and
  // signalingUrl() / getSoulBaseUrl() return the legacy fallback
  // ports, fine when the dynamic + legacy ports happen to collide,
  // a stream-dead-on-arrival otherwise.
  const [portsReady, setPortsReady] = useState(
    () => typeof window === 'undefined' || !window.electronAPI?.soul?.getPorts,
  );
  useEffect(() => {
    if (!soulReady || portsReady) return;
    let cancelled = false;
    void initSoulBase().finally(() => {
      if (!cancelled) setPortsReady(true);
    });
    return () => { cancelled = true; };
  }, [soulReady, portsReady]);

  if (setupComplete === null) {
    // Brief loading flash, IPC roundtrip is sub-50ms in practice.
    return null;
  }
  if (!setupComplete) {
    return <SetupWizard onComplete={() => setSetupComplete(true)} />;
  }
  if (!updatesChecked) {
    return <UpdateOverlay onComplete={() => setUpdatesChecked(true)} />;
  }
  if (!soulReady) {
    return <SoulBootScreen onReady={() => setSoulReady(true)} />;
  }
  if (!portsReady) {
    // Soul is up but our port cache hasn't hydrated yet, fall through
    // to the boot screen for the (typically sub-frame) hydration window
    // rather than mounting AppMain with stale fallback URLs.
    return <SoulBootScreen onReady={() => { /* already ready */ }} />;
  }

  return <AppMain />;
}

function AppMain() {
  // Soul-respawn port-rehydration. The supervisor resets its internal
  // livePorts to null on `startSoul`, parses the fresh [ports] banner
  // from the new boot, and re-fires 'soul:ports'. The soulBase cache
  // would otherwise hold the dead session's ports until the user
  // reloads the renderer, so every fetch + the pixel-streaming
  // signalling WS would point at a port nothing is listening on.
  // subscribeSoulPorts updates the cache in place when the new banner
  // arrives. Doesn't tear down the pixel-streaming hook (the user-
  // visible reconnect is owned by usePixelStreaming + UE itself); just
  // keeps the cache fresh so service fetches resolve correctly.
  // The signalling WS URL drives usePixelStreaming's connection. Hold it in
  // state so a soul respawn on a DIFFERENT port re-renders AppMain with the new
  // URL, which re-runs the PS effect against the live port. Without this the URL
  // was frozen at first render and ps.reconnect() redialled the dead old port
  // forever after any respawn (dynamic ports change every boot).
  const [sigUrl, setSigUrl] = useState<string>(() => signalingUrl());
  useEffect(() => {
    return subscribeSoulPorts(() => {
      // A fresh [ports] banner landed (soul respawn). subscribeSoulPorts already
      // refreshed the soulBase cache; push the new signalling URL into state so
      // the pixel-streaming hook redials the LIVE port. Same string => React
      // bails the re-render, so an unchanged-port banner is a no-op.
      setSigUrl(signalingUrl());
    });
  }, []);

  const { videoParentRef, connectionState, pixelStreaming, waitForAck } = usePixelStreaming({
    signalingUrl: sigUrl,
  });

  // Publishes the streamed <video>'s screen geometry to UE so the
  // CursorGazeComponent can translate the host OS cursor into video-
  // relative coords.
  useVideoRectPublisher(pixelStreaming, videoParentRef);

  // Wardrobe descriptor emitter, narrow wrapper around the PS emit
  // so callers don't import PS types. Each payload is timestamped to
  // match the project's existing descriptor pattern. Declared up here
  // (right next to pixelStreaming) so any helper below, including
  // the connect/reset apply path, can reference it without TDZ.
  const emitWardrobeDescriptor = useCallback((payload: Record<string, unknown>) => {
    if (!pixelStreaming) {
      console.warn('[wardrobe] emit skipped, no pixelStreaming', payload);
      return;
    }
    console.log('[wardrobe] →', payload);
    pixelStreaming.emitUIInteraction({
      ...payload,
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming]);

  // The user's roster (persisted, starts as just Grace) + which slot of the
  // switcher carousel is selected. The carousel is [...stack, ADD_SLOT]; the
  // ADD_SLOT opens the picker over a blank stage. `selectedInstanceId` holds a
  // real roster instance id or ADD_SLOT.
  const { stack: agentStack, addInstance, removeInstance, renameInstance, setInstanceWardrobe, resetStack, hydrateStack } = useAgentStack();
  // Global environment — backdrop + key light + post effect (persists across
  // agents, NOT per-instance). See src/hooks/useEnvironment.ts. Applied on every
  // switch + whenever it changes.
  const { environment, setEnvironment } = useEnvironment();
  // Passthrough speech prefs (talkativeness + mute). Device-local + mirrored
  // to soul so the external agent honors them. See usePassthroughPrefs.
  const { prefs: passthroughPrefs, setVerbosity: setPassthroughVerbosity, toggleMuted: togglePassthroughMuted } = usePassthroughPrefs();
  // Selected carousel slot: a roster instance id, or ADD_SLOT for the picker.
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(BASE_INSTANCE_ID);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  // Which instance the switcher returns to when the Add picker is cancelled.
  const addReturnRef = useRef<string>(BASE_INSTANCE_ID);
  // Characters UE reports as actually loaded (mount-aware), via the
  // `installedCharacters` response. null = not reported yet -> fall back to the
  // full catalog (keeps dev + older UE builds working).
  const [installedCharacterIds, setInstalledCharacterIds] = useState<string[] | null>(null);
  // Character ids whose pak is downloaded locally (the flat character-paks
  // staging dir). This is the authoritative "do we have the pak" signal for
  // paid characters — independent of UE's report, which is null until UE
  // answers and would otherwise make an un-downloaded character look ready.
  const [localInstalledIds, setLocalInstalledIds] = useState<string[]>([]);
  // Paid characters whose staged pak drifted from the manifest version (a newer
  // pak was cooked). Still usable from the old bytes, but provisioning
  // re-downloads them on launch so an older install picks up the new pak.
  const [staleInstalledIds, setStaleInstalledIds] = useState<string[]>([]);
  // Character store: which paid characters this account owns (from the store
  // Worker / Polar). null = not fetched yet. Base characters are always owned.
  const [ownedCharacterIds, setOwnedCharacterIds] = useState<string[] | null>(null);
  // Claws — the in-app currency (server-authoritative balance). null = not
  // fetched yet. New accounts seed to STARTING_CLAWS on first /claws touch.
  const [clawsBalance, setClawsBalance] = useState<number | null>(null);
  const clawsBalanceRef = useRef<number | null>(null);
  clawsBalanceRef.current = clawsBalance;
  // Transient "not enough claws" message shown when a spend can't cover the cost.
  const [clawsNotice, setClawsNotice] = useState<string | null>(null);
  // User-facing error from the chat / voice pipeline (bad key, missing model,
  // provider down). The raw error only ever hit devtools before, which end
  // users can't see; this surfaces it as a dismissible toast.
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  // Per-character pak download progress (0..1) while a fetch is in flight.
  const [pakProgress, setPakProgress] = useState<Record<string, number>>({});
  const checkoutPollRef = useRef<number | null>(null);
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

  // Pending screenshot stack, base64 PNGs captured via the global
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

  // Active chat model, kept fresh so capability checks
  // (modelSupportsVision in particular) drive the input bar's
  // attach-image button visibility. Refreshed on mount and after
  // the onboarding wizard closes, that's the only time apiKeys
  // mutates within a session.
  const [activeLlmModel, setActiveLlmModel] = useState<string | null>(null);
  // Whether the agentic / escalation backend is enabled. When it is,
  // soul's image-attached fast-path routes any turn carrying images to
  // the vision-capable escalation model, so attachments are usable
  // even when the chat model itself is text-only.
  const [agenticEnabled, setAgenticEnabled] = useState(false);
  const refreshActiveLlmModel = useCallback(async () => {
    try {
      const keys = await fetchApiKeys();
      setActiveLlmModel(keys.llm_model);
      setAgenticEnabled(!!keys.agentic_enabled);
    } catch (err) {
      console.warn('[apiKeys] failed to read active llm_model', err);
    }
  }, []);
  useEffect(() => {
    void refreshActiveLlmModel();
  }, [refreshActiveLlmModel]);
  // The + image-attach button shows when images can actually be used:
  // either the chat model is vision-capable, or agentic is on (soul's
  // escalation fast-path digests the images on a vision model).
  const canAttachImages = useMemo(
    () => modelSupportsVision(activeLlmModel) || agenticEnabled,
    [activeLlmModel, agenticEnabled],
  );

  // Single active widget panel, lifted up so opening one closes the
  // others. The dock and the sheet both subscribe to this state.
  const [activeWidget, setActiveWidget] = useState<SheetKey | null>(null);
  // Full-screen customization mode, orthogonal to the rail sheets.
  // The wardrobe rail icon flips this; everything else stays.
  const [customizationActive, setCustomizationActive] = useState(false);
  // Live post-effect preview while customizing. Effects never reach UE (they're
  // composited over the <video> here), so they can't ride the descriptor path
  // like everything else. null = show whatever the instance has saved.
  const [effectPreview, setEffectPreview] =
    useState<{ effectId: string; effectStrength: number } | null>(null);
  // Settings modal, opened from Titlebar profile dropdown. Distinct
  // overlay from CustomizationOverlay so the two can't collide.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Passthrough mode. When true, UnClaw does no inference of its own: a
  // user's external coding agent (Claude Code, ...) drives the avatar by
  // calling soul's /passthrough/speak, which the passthrough bridge (see
  // effect below) renders + dispatches to UE. The InputBar swaps its
  // composer for a "Passthrough mode enabled" banner. Session-only (never
  // persisted) — entered/exited via the unclaw://passthrough deep link so
  // a plain relaunch always comes back up in normal chat mode.
  const [passthrough, setPassthrough] = useState(false);

  // Chat history side-pane. When true, the gray utility pane slides in
  // from the right and the workspace wrapper's right anchor animates
  // inward, physically pushing the streamed face in, rather than
  // overlaying it. The InputBar (with its status pills + screenshot
  // strip) ALSO slides into the pane region so the user can keep
  // typing while reading history. Toggled from the InputBar's expand
  // button. Closed by default; the pane is opt-in.
  const [chatPaneOpen, setChatPaneOpen] = useState(false);

  // TEMP(revert): Cmd+H toggles hiding ALL chrome (everything but the stream)
  // for clean capture / debugging. Driven by main's globalShortcut -> IPC so it
  // wins over the OS "Hide app" accelerator. Remove this state + effect + the
  // `unclaw-ui-hidden` class on the root div + the CSS rule in styles.css.
  const [uiHidden, setUiHidden] = useState(false);
  useEffect(() => {
    const off = window.electronAPI?.onTempToggleUi?.(() =>
      setUiHidden((v) => !v),
    );
    return () => { off?.(); };
  }, []);

  // Window width, drives the InputBar wrapper's animated left anchor
  // (it slides between the workspace bottom and the chat-pane bottom
  // as a single mounted unit so typing/voice state is never reset).
  // Tracked via ResizeObserver so it stays correct even when the user
  // drags the Electron window edge.
  const [winWidth, setWinWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 600,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWinWidth(w);
    });
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, []);

  // Pane width, 50% of the window by default, but the user can
  // override by dragging the resize handle on the pane's left edge.
  // `userPaneWidth` is null until they drag, then sticks at whatever
  // pixel value they landed on. Persisted to localStorage so the
  // chosen split survives reloads.
  const [userPaneWidth, setUserPaneWidth] = useState<number | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem('unclaw.chatPaneWidth');
    return v ? Number(v) || null : null;
  });
  // Floor 280 so the pane is always readable; ceiling at winWidth-280
  // so the workspace (stream + input) never disappears entirely.
  const chatPaneWidth = Math.round(
    Math.min(
      Math.max(280, winWidth - 280),
      Math.max(280, userPaneWidth ?? winWidth * 0.5),
    ),
  );

  // Unified tool-event timeline. Each tool the escalation uses lands
  // here as its own timestamped item; ChatPane merges these with the
  // chat turns by ts and renders each tool as its own row in the
  // conversation stack at the moment it was called. Ephemeral
  // (in-memory only, reset across reloads), chat memory itself
  // persists, but tool annotations don't.
  const [toolEvents, setToolEvents] = useState<Array<{
    id: number;
    ts: number;
    label: string;
  }>>([]);
  const toolEventIdRef = useRef(0);
  // Tracks the LAST label appended so consecutive identical statuses
  // ("thinking" → "thinking") don't spam the timeline with duplicates.
  const lastToolLabelRef = useRef<string>('');

  // Resize handler, owns a pointermove/pointerup pair on the document
  // so dragging continues even when the cursor leaves the 6px handle
  // strip. Clamped via the same min/max as chatPaneWidth above so the
  // workspace can't be reduced below 280px. Persists to localStorage
  // so the chosen split survives reloads.
  const handlePaneResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      // Pane is right-anchored, so width = (winWidth - cursorX).
      const next = Math.round(
        Math.min(
          Math.max(280, window.innerWidth - 280),
          Math.max(280, window.innerWidth - ev.clientX),
        ),
      );
      setUserPaneWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // Persist the final width AFTER the drag ends so we don't write
      // localStorage on every pixel of motion.
      try {
        const v = userPaneWidthRef.current;
        if (typeof v === 'number') {
          localStorage.setItem('unclaw.chatPaneWidth', String(v));
        }
      } catch {
        // Ignore, quota / private browsing.
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);
  // Mirror userPaneWidth into a ref so the persist-on-up callback
  // captured at drag-start time can see the latest value.
  const userPaneWidthRef = useRef<number | null>(userPaneWidth);
  userPaneWidthRef.current = userPaneWidth;

  // Refs to each widget icon so SheetPanel can restore focus on close.
  const reminderRef = useRef<HTMLButtonElement | null>(null);
  const stocksRef = useRef<HTMLButtonElement | null>(null);
  const newsRef = useRef<HTMLButtonElement | null>(null);
  const weatherRef = useRef<HTMLButtonElement | null>(null);
  const wardrobeRef = useRef<HTMLButtonElement | null>(null);
  const triggerRefs = useMemo(() => ({
    reminders: reminderRef,
    stocks: stocksRef,
    news: newsRef,
    weather: weatherRef,
    wardrobe: wardrobeRef,
  }), []);

  // Rail-badge state, fetched at the App level so the badges
  // populate even before the user has ever opened the corresponding
  // panel. The panels still own their own fetch loop for their full
  // content; this is just the lightweight count/aggregate snapshot.
  const [remindersCount, setRemindersCount] = useState(0);
  const [stocksDayPct, setStocksDayPct] = useState<number | null>(null);

  // Auth session, fetched at app start from safeStorage.
  //   undefined: still resolving (don't render anything auth-dependent)
  //   null:      no valid session, show SignInScreen
  //   object:    signed in
  // A signed-in account is now required: there is no guest path, so the
  // SignInScreen renders whenever `authToken` resolves to null.
  const [authToken, setAuthToken] = useState<string | null | undefined>(undefined);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // User profile, fetched at app start. `null` means soul has no
  // profile yet, which triggers the onboarding wizard in firstRun mode.
  // `undefined` means the fetch hasn't resolved yet (we render nothing
  // profile-dependent until then to avoid a flash of "Aryan").
  const [profile, setProfile] = useState<UserSettings | null | undefined>(undefined);
  // Bumped to force a full UE character re-init without a stream disconnect.
  // A "reset session" / "reset account" tells UE to drop back to the blank
  // stage; bumping this re-runs the connect-time reconcile driver so the
  // frontend re-drives + re-dresses the character on the fresh UE session
  // (otherwise the stale initialResolvedRef leaves the stage blank).
  const [ueSessionEpoch, setUeSessionEpoch] = useState(0);
  // True after a sign-in that changed the machine's owning account: the prior
  // owner's API keys were cleared (keys are local secrets, never synced), so we
  // surface a one-time banner telling the user to re-enter them.
  const [apiKeysNotice, setApiKeysNotice] = useState(false);
  // Store toast: 'added' fires when a purchase lands (entitlement appears),
  // 'ready' fires when a bought character finishes downloading + mounting.
  // null = nothing to show.
  const [storeToast, setStoreToast] = useState<{ kind: 'added' | 'ready'; ids: string[] } | null>(null);

  // Cloud-sync the character roster (added/renamed instances + each one's
  // wardrobe) by folding it into the UserSettings blob so the full setup —
  // everything except the device-local API keys — follows the account across
  // devices. Refs keep the sync effect's deps minimal (fire on roster change
  // only) while still reading the latest profile/token.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const authTokenRef = useRef(authToken);
  authTokenRef.current = authToken;
  const stackRef = useRef(agentStack);
  stackRef.current = agentStack;
  // Set just before a cloud→local roster restore so the resulting roster
  // change doesn't immediately echo the same data back up to the cloud.
  const suppressRosterPushRef = useRef(false);
  // Skip the very first effect run (initial localStorage hydration) — only a
  // genuine user-driven roster change should push.
  const rosterPushPrimedRef = useRef(false);
  useEffect(() => {
    if (!rosterPushPrimedRef.current) { rosterPushPrimedRef.current = true; return; }
    if (suppressRosterPushRef.current) { suppressRosterPushRef.current = false; return; }
    const token = authTokenRef.current;
    const prof = profileRef.current;
    // Only sync for a signed-in, onboarded account. Pre-onboarding the roster
    // is just base Grace, and there's no profile to attach it to yet.
    if (!token || !prof) return;
    void saveSettingsEverywhere({ ...prof, roster: agentStack }, token);
  }, [agentStack]);
  // Wizard visibility + mode. 'first' = no profile yet, can't be cancelled.
  // 'edit' = user reopened to tweak; cancel returns to chat.
  // null = wizard closed.
  const [wizardMode, setWizardMode] = useState<'first' | 'edit' | null>(null);
  // Live mirror of the Identity step's name input. The Wizard streams
  // it up via `onIdentityNameChange` so the Greeting on the workspace
  // (rendered alongside the wizard panel) can echo "good evening,
  // <name>" as the user types, they see their name take effect
  // before they hit Continue. Empty while the field is blank.
  const [wizardLiveName, setWizardLiveName] = useState('');

  // Close the chat pane whenever the onboarding wizard opens (any
  // mode, first-run auto-mount, edit via the pencil, or reset).
  // The wizard occupies the same bottom slot as the InputBar and
  // expects the workspace to be full-width; leaving the pane open
  // would crowd both. Placed here (after wizardMode is declared and
  // after setChatPaneOpen exists higher up) to avoid the TDZ error
  // we hit when the effect was hoisted nearer the chat-pane state.
  useEffect(() => {
    if (wizardMode) setChatPaneOpen(false);
  }, [wizardMode]);

  // Apply the user's custom assistant name (set in onboarding) only on
  // the default Grace persona, Mark stays Mark. This way the user can
  // rename their primary assistant without affecting the alternate
  // persona slot. The override flows through into displayName + the
  // in-prompt voice the LLM hears, so every surface that says "Grace"
  // (greeting, AgentSwitcher, Whisper prompt, system extension) picks
  // up the new name automatically.
  // Catalog lookup + the characters still addable (available, not yet in the
  // roster). "Available" = the whole catalog for now; the UE
  // `installedCharacters` reply will narrow this to downloaded characters.
  const agentById = useMemo(
    () => Object.fromEntries(AGENTS.map((a) => [a.agentId, a] as const)) as Record<string, Agent>,
    [],
  );
  // Store gating. A character is pickable only when OWNED (bought, or a free
  // base character) AND INSTALLED (its pak is present so UE can render it).
  //   owned + installed   -> pick (add an instance)
  //   owned + !installed  -> download the pak
  //   !owned              -> buy (opens a Polar checkout)
  // Until UE reports installs, treat everything as installed so dev + older
  // builds still work.
  const isOwned = useCallback(
    (id: string) => BASE_CHARACTER_IDS.includes(id) || (ownedCharacterIds?.includes(id) ?? false),
    [ownedCharacterIds],
  );
  const isInstalled = useCallback(
    (id: string) => {
      // Base characters ship in the app — always present.
      if (BASE_CHARACTER_IDS.includes(id)) return true;
      // Paid characters: the pak on disk locally is the source of truth (we
      // downloaded it). UE's mount report is a secondary signal (e.g. a dev
      // build with paks baked into Content/Paks).
      if (localInstalledIds.includes(id)) return true;
      return installedCharacterIds === null ? false : installedCharacterIds.includes(id);
    },
    [localInstalledIds, installedCharacterIds],
  );
  const storeEntries: StoreEntry[] = useMemo(
    () => AGENTS.map((a) => ({
      agent: a,
      owned: isOwned(a.agentId),
      installed: isInstalled(a.agentId),
      clawsCost: CHARACTER_CLAW_COST,
      sku: a.agentId,
      downloading: pakProgress[a.agentId] ?? null,
    })),
    [isOwned, isInstalled, pakProgress],
  );
  const storeBundle = useMemo(
    () => ({ priceUsd: BUNDLE_PRICE_USD, sku: BUNDLE_SKU, owned: PAID_CHARACTER_IDS.every((id) => isOwned(id)) }),
    [isOwned],
  );

  const onAddSlot = selectedInstanceId === ADD_SLOT;
  // Live mirror of onAddSlot for async listeners (agentSwitchFailed, the
  // reconcile reply). While the Add picker is open the stage is DELIBERATELY
  // blank — reconcile/retry must NOT drive the last agent back onto it, or it
  // reappears behind the picker AND leaves the state too tangled for Cancel to
  // restore cleanly. Assigned in render so it's current before effects run.
  const onAddSlotRef = useRef(onAddSlot);
  onAddSlotRef.current = onAddSlot;
  const currentInstance = onAddSlot
    ? null
    : agentStack.find((i) => i.id === selectedInstanceId) ?? agentStack[0];
  const activeAgentId = currentInstance?.agentId ?? null;
  const activeInstanceName = currentInstance?.name?.trim() || null;

  // persona = AI voice + chat memory. Falls back to Grace for characters with
  // no defined personality and while the Add picker is open. A renamed
  // instance carries its name into the voice; base Grace also honors the
  // onboarding custom name.
  const personaCustomName =
    activeInstanceName
    ?? (selectedInstanceId === BASE_INSTANCE_ID ? profile?.agent_name ?? null : null);
  // Resolve by the stable agent TYPE id (grace/mark/ava/goblin/chris/joi), not
  // the display name. A renamed instance keeps the type's persona + voice; only
  // the name is swapped. Unknown id (Add slot) -> Grace.
  const persona = characterFor(activeAgentId, personaCustomName);
  // Chat history is keyed by the ROSTER INSTANCE, not the persona — so two
  // Marks, a renamed Ava, and base Grace each remember independently (persona
  // collapses every non-Grace/Mark character onto Grace, which would otherwise
  // share one history). On the Add slot there's no live chat; park on base.
  const memoryKey = currentInstance?.id ?? BASE_INSTANCE_ID;
  // Bumped after a cloud chat restore so useChatMemory re-reads localStorage and
  // the visible conversation refreshes without an instance switch.
  const [chatReloadNonce, setChatReloadNonce] = useState(0);
  const memory = useChatMemory(memoryKey, chatReloadNonce);

  // Cloud-sync chat history (everything but API keys follows the account). The
  // active instance is the only one whose turns change, but we push the whole
  // gathered map so switching instances or clearing also syncs. Debounced so a
  // burst of turns collapses to one write. Skips the initial mount and the
  // restore-triggered change (suppress flag) so we never echo cloud data back.
  const chatSyncPrimedRef = useRef(false);
  const suppressChatPushRef = useRef(false);
  useEffect(() => {
    if (!chatSyncPrimedRef.current) { chatSyncPrimedRef.current = true; return; }
    if (suppressChatPushRef.current) { suppressChatPushRef.current = false; return; }
    const token = authTokenRef.current;
    if (!token || !profileRef.current) return; // signed-in + onboarded only
    const t = setTimeout(() => { void pushCloudChat(token, gatherLocalChat()); }, 4000);
    return () => clearTimeout(t);
  }, [memory.turns]);

  // On-screen label: the instance's name, else the character's catalog name
  // ("Add" on the picker slot). Decoupled from persona so Ava/Goblin/etc. show
  // their own name even though the AI voice currently falls back to Grace.
  const characterName = onAddSlot
    ? 'Add'
    : activeInstanceName
      ?? (selectedInstanceId === BASE_INSTANCE_ID
        ? profile?.agent_name ?? AGENTS[0].name
        : (activeAgentId ? agentById[activeAgentId]?.name : null) ?? 'Grace');

  // Roster for the InputBar's dropdown switcher: each instance with its
  // on-screen name (same derivation as `characterName`). The Add slot is NOT
  // in this list — it's the separate + button.
  const personaAgents = useMemo(
    () => agentStack.map((i) => ({
      id: i.id,
      name: i.name?.trim()
        || (i.id === BASE_INSTANCE_ID
          ? (profile?.agent_name ?? AGENTS[0].name)
          : (agentById[i.agentId]?.name ?? 'Grace')),
    })),
    [agentStack, profile?.agent_name, agentById],
  );

  // Dressing-chain generation counter. Every dress run claims a fresh epoch;
  // switches / resets / disconnects bump it too, so an in-flight chain aborts
  // at its next send instead of dressing a character it no longer owns. This
  // is what stops "old instance's outfit lands on the character I just
  // switched to" — the chain used to keep running through the swap.
  const dressEpochRef = useRef(0);
  // Ref twin of `ueActiveAgentId` (declared with its listeners further down)
  // so switch-time callbacks can read "what is UE showing right now" without
  // re-subscribing on every answer. null = unknown / mid-transition.
  const ueActiveAgentRef = useRef<string | null>(null);
  // Ref to applyInstanceWardrobe (defined after the send plumbing below);
  // assigned right after its definition, same pattern as agentStackRef.
  const applyInstanceWardrobeRef = useRef<
    ((
      w: WardrobeSettings | null | undefined,
      agentId?: string | null,
      opts?: { scope?: DressScope; epoch?: number },
    ) => Promise<void>) | null
  >(null);
  // The cross-class swap in flight: set when we emit agentSwitch (the scene
  // half of the wardrobe fires immediately under this epoch), consumed by the
  // characterReady listener (which finishes with the outfit half under the
  // SAME epoch, so it can't cancel a scene re-fire still in the air). A stale
  // entry is harmless: the epoch check rejects it.
  const pendingSwitchRef = useRef<{ agentId: string; epoch: number } | null>(null);
  // Retry state for UE's `agentSwitchFailed` (the C++ subsystem now broadcasts
  // it when a swap's cast fails / resolves to blank instead of stalling
  // silently). Holds the last switch we asked for so we can replay it, plus a
  // bounded retry counter. Reset to 0 on a genuinely new target and on
  // characterReady success; cleared when we give up (then reconcile).
  const lastSwitchTargetRef = useRef<
    { agentId: string; dir: number; wardrobe: WardrobeSettings | null } | null
  >(null);
  const switchRetryRef = useRef(0);
  const SWITCH_MAX_RETRIES = 3;
  // The agentId (lowercased) whose swap UE confirmed DISPATCHED via
  // `agentSwitchSuccess` (Swap to Character ran with a valid, latched id).
  // Distinguishes a genuine cast failure (dispatch succeeded, then the incoming
  // class wasn't a BP_CharacterBase / resolved blank -> replaying the identical
  // id just loops -> reconcile) from a swap that never dispatched (keep the
  // bounded retry). Cleared on characterReady success + when consumed by a
  // failure.
  const switchDispatchedRef = useRef<string | null>(null);
  // Non-null (a setTimeout id) while a "same character → blank → same character"
  // interstitial is mid-flight. UE's SwapCharacter no-ops when the target class
  // is already live (two roster instances of one character), so switching
  // between them doesn't transition. We route it through a blank frame for a
  // graceful fade. While set, the 'blank' rejection (agentSwitchFailed) is
  // expected and must not trigger the retry/reconcile.
  const sameIdBlankRef = useRef<number | null>(null);
  // How long the blank frame shows before the same character respawns.
  const SAME_ID_BLANK_MS = 380;

  const emitAgentSwitch = useCallback((
    agentId: string, dir: number, wardrobe?: WardrobeSettings | null,
  ) => {
    // Leaving a character obsoletes anything still being applied to it.
    dressEpochRef.current += 1;
    cancelScheduledIdleRevert();
    // MERGED SWITCH+DRESS: agentSwitch carries the wardrobe INDICES
    // (top/bottom/shoes/hair/eyelash/eyebrow) so UE can apply them inside the
    // swap graph. An UNSAVED slot goes as the character's DEFAULT index
    // (wardrobeDefaultsFor), not -1 — so a fresh character lands on its authored
    // look. The reliable application still runs at characterReady via the
    // changeWardrobeItem dress chain (which uses the same defaults).
    const def = wardrobeDefaultsFor(agentId);
    const idx = (v: number | undefined, fallback: number) =>
      (v == null || !Number.isFinite(v) ? fallback : Math.floor(v));
    pixelStreaming?.emitUIInteraction({
      EventType: 'agentSwitch',
      agentId,
      slideDir: dir,
      top:     idx(wardrobe?.topIndex,    def.top),
      bottom:  idx(wardrobe?.bottomIndex, def.bottom),
      shoes:   idx(wardrobe?.shoesIndex,  def.shoes),
      hair:    idx(wardrobe?.hairIndex,   def.hair),
      eyelash: idx(wardrobe?.lashIndex,   def.lash),
      eyebrow: idx(wardrobe?.browIndex,   def.brow),
    });
  }, [pixelStreaming]);

  // Switch UE to an agent, handling the same-class case: UE's SwapCharacter
  // no-ops when the target class is already live (two roster instances of one
  // character), so no characterReady will ever fire — dress the incoming
  // instance directly instead of waiting on a signal that never comes.
  //
  // For a genuine cross-character swap, the wardrobe splits in two:
  //   scene (key light + backdrop) fires NOW, in parallel with UE's
  //     destroy/GC/async-load. Those are persistent-level actors; by the time
  //     the new character fades in, the room is already lit correctly.
  //   outfit waits for characterReady (the clothes need a body to hang on).
  // Also mark UE "in transition" so the fast path can't misfire off a stale
  // reading until characterReady lands.
  const switchUeToAgent = useCallback((
    agentId: string, dir: number, wardrobe?: WardrobeSettings | null,
  ) => {
    // A new switch supersedes any pending same-id blank interstitial.
    if (sameIdBlankRef.current != null) {
      window.clearTimeout(sameIdBlankRef.current);
      sameIdBlankRef.current = null;
    }
    const lc = agentId.toLowerCase();
    // Fresh spawn of `agentId`: emit the switch, arm the retry/dispatch state,
    // and record a pending switch so characterReady dresses the selected
    // instance under this epoch. The environment (key light + backdrop) is
    // GLOBAL, re-asserted at characterReady, so agentSwitch goes out alone.
    const spawnFresh = () => {
      emitAgentSwitch(agentId, dir, wardrobe);
      ueActiveAgentRef.current = null;
      // Reset retries only on a genuinely new target (a replay keeps counting).
      if (lastSwitchTargetRef.current?.agentId.toLowerCase() !== lc) {
        switchRetryRef.current = 0;
      }
      lastSwitchTargetRef.current = { agentId, dir, wardrobe: wardrobe ?? null };
      const epoch = ++dressEpochRef.current;
      pendingSwitchRef.current = { agentId: lc, epoch };
    };
    const alreadyLive =
      ueActiveAgentRef.current != null && ueActiveAgentRef.current === lc;
    if (alreadyLive) {
      // Same character CLASS, different roster instance (e.g. grace → grace).
      // UE's SwapCharacter no-ops when the class is already live, so a plain
      // re-switch doesn't transition and re-dressing in place snaps the outfit
      // with no motion. Route it through a blank frame — grace → blank → grace
      // — so the character fades out and back in, and characterReady fires again
      // to dress the incoming instance. Clear the switch state first so the
      // 'blank' rejection (agentSwitchFailed) can't replay the old target while
      // we wait for the timer.
      lastSwitchTargetRef.current = null;
      switchRetryRef.current = 0;
      switchDispatchedRef.current = null;
      pendingSwitchRef.current = null;
      emitAgentSwitch('blank', dir);      // clear the stage (bumps epoch, cancels idle)
      ueActiveAgentRef.current = null;
      sameIdBlankRef.current = window.setTimeout(() => {
        sameIdBlankRef.current = null;
        spawnFresh();                      // now NOT alreadyLive -> real respawn
      }, SAME_ID_BLANK_MS);
      return;
    }
    spawnFresh();
  }, [emitAgentSwitch]);
  // Live ref to switchUeToAgent so the agentSwitchFailed retry (and headless
  // drivers) can call the current fn without re-subscribing.
  const switchUeToAgentRef = useRef(switchUeToAgent);
  switchUeToAgentRef.current = switchUeToAgent;

  // Select a carousel target by INSTANCE id (or ADD_SLOT). ADD_SLOT clears the
  // stage (an unknown id makes UE blank the scene) and opens the picker; a real
  // instance switches UE to that instance's underlying character.
  const selectInstance = useCallback((targetId: string, dir: number) => {
    if (targetId === ADD_SLOT) {
      addReturnRef.current = onAddSlot
        ? agentStack[agentStack.length - 1]?.id ?? BASE_INSTANCE_ID
        : selectedInstanceId;
      setSelectedInstanceId(ADD_SLOT);
      setAddPickerOpen(true);
      // Going blank is DELIBERATE: UE can't cast "blank" to a BP_CharacterBase
      // so it fires agentSwitchFailed — which must NOT trigger the retry/replay
      // (that would drag the last agent back onto the stage behind the Add
      // picker). Clear all pending-switch state before emitting.
      lastSwitchTargetRef.current = null;
      switchRetryRef.current = 0;
      switchDispatchedRef.current = null;
      pendingSwitchRef.current = null;
      emitAgentSwitch('blank', dir); // "blank" card (empty class) -> UE clears the stage. NOT "none" (reserved FName == NAME_None, hits SwapToCharacter's IsNone guard)
      ueActiveAgentRef.current = null; // stage is clearing; nothing is live
    } else {
      const inst = agentStack.find((i) => i.id === targetId);
      setSelectedInstanceId(targetId);
      setAddPickerOpen(false);
      if (inst) switchUeToAgent(inst.agentId, dir, inst.wardrobe);
    }
  }, [onAddSlot, agentStack, selectedInstanceId, emitAgentSwitch, switchUeToAgent]);

  const handlePickAgent = useCallback((agentId: string) => {
    const id = addInstance(agentId);
    setSelectedInstanceId(id);
    setAddPickerOpen(false);
    // A brand-new instance has no saved wardrobe; the same-class fast path
    // in switchUeToAgent just no-ops the dress, which is correct (authored
    // defaults, or whatever the stage already shows for this class).
    switchUeToAgent(agentId, 1, null);
  }, [addInstance, switchUeToAgent]);

  const handleCancelAdd = useCallback(() => {
    const back = addReturnRef.current || BASE_INSTANCE_ID;
    const inst = agentStack.find((i) => i.id === back) ?? agentStack[0];
    // Setting the selected instance updates wardrobeTargetRef (via its effect),
    // which is what the reconcile driver reads as its target.
    setSelectedInstanceId(inst?.id ?? BASE_INSTANCE_ID);
    setAddPickerOpen(false);
    // Don't blind-switch back. Re-run the reconcile driver (the same path as
    // connect / reset): it asks UE which character it's on and only switches
    // when UE isn't already showing this instance's agent, otherwise it just
    // re-dresses. Avoids a redundant reload when returning to the same agent.
    setUeSessionEpoch((e) => e + 1);
  }, [agentStack]);

  const handleRemoveInstance = useCallback((instanceId: string) => {
    if (instanceId === BASE_INSTANCE_ID) return;
    removeInstance(instanceId); // also drops this instance's saved wardrobe (lives on the instance)
    // Wipe this instance's chat history too, so a freed slot doesn't leave an
    // orphaned `unclaw.chat.<id>` blob lingering in localStorage.
    try { localStorage.removeItem(`unclaw.chat.${instanceId}`); } catch { /* ignore */ }
    if (selectedInstanceId === instanceId) {
      setSelectedInstanceId(BASE_INSTANCE_ID);
      // Falling back to base: if the removed instance shared base's character
      // class (a second Grace), UE won't re-spawn — dress base's look directly.
      const base = agentStack.find((i) => i.id === BASE_INSTANCE_ID);
      switchUeToAgent(BASE_AGENT, -1, base?.wardrobe);
    }
  }, [removeInstance, selectedInstanceId, switchUeToAgent, agentStack]);

  // Listen for UE's `installedCharacters` report (sent on connect, on request,
  // and after each pak mount) and narrow the addable set to it. Shares the PS
  // response channel with the wardrobe acks; we filter by EventType.
  useEffect(() => {
    if (!pixelStreaming) return;
    const onResponse = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { EventType?: unknown; ids?: unknown };
      if (msg.EventType !== 'installedCharacters' || !Array.isArray(msg.ids)) return;
      const ids = (msg.ids as unknown[]).filter((x): x is string => typeof x === 'string');
      setInstalledCharacterIds(ids);
      console.log('[installedCharacters] ←', ids);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-installed-router', onResponse);
    return () => ps.removeResponseEventListener?.('unclaw-installed-router');
  }, [pixelStreaming]);

  // On connect, prompt UE for the current installed/loaded set.
  useEffect(() => {
    if (connectionState !== 'connected' || !pixelStreaming) return;
    pixelStreaming.emitUIInteraction({ EventType: 'getInstalledCharacters' });
  }, [connectionState, pixelStreaming]);

  // ----------------------------------------------------------------------
  // Character store: entitlements + checkout + pak download.
  // ----------------------------------------------------------------------
  // Re-read which paks are on disk locally (after a download, or on launch).
  const refreshLocalInstalled = useCallback(async () => {
    try {
      const res = await window.electronAPI?.characterStore?.listInstalled?.();
      if (res?.ids) setLocalInstalledIds(res.ids);
      setStaleInstalledIds(res?.stale ?? []);
    } catch (err) {
      console.warn('[store] local installed list failed', err);
    }
  }, []);
  useEffect(() => { void refreshLocalInstalled(); }, [refreshLocalInstalled]);

  // Claws balance: fetch on sign-in (seeds the 250 starting balance for a new
  // account), clear on sign-out.
  const refreshClaws = useCallback(async () => {
    if (!authToken) { setClawsBalance(null); return; }
    const b = await fetchClaws(authToken);
    if (b != null) setClawsBalance(b);
  }, [authToken]);
  useEffect(() => { void refreshClaws(); }, [refreshClaws]);
  // Auto-dismiss the "not enough claws" notice.
  useEffect(() => {
    if (!clawsNotice) return;
    const t = window.setTimeout(() => setClawsNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [clawsNotice]);
  // Auto-dismiss the pipeline error notice (a touch longer so the user can read it).
  useEffect(() => {
    if (!pipelineError) return;
    const t = window.setTimeout(() => setPipelineError(null), 9000);
    return () => window.clearTimeout(t);
  }, [pipelineError]);

  // Award 1 claw for a SUCCESSFUL interaction only. Called from the chat
  // success paths (real assistant reply received), never at send time, so a
  // failed turn (bad key, missing model, provider down) earns nothing. The
  // server (/claws/earn) is authoritative; we bump optimistically then
  // reconcile. Best-effort + fire-and-forget.
  const awardClawForInteraction = useCallback(() => {
    const tok = authTokenRef.current;
    if (!tok) return;
    setClawsBalance((b) => (b == null ? b : b + 1));
    void earnClaws(tok, 1).then((nb) => { if (nb != null) setClawsBalance(nb); });
  }, []);

  const refreshEntitlements = useCallback(async () => {
    if (!authToken) return;
    try {
      const next = await fetchEntitlements(authToken);
      // Diff against the prior owned set to detect a fresh purchase (a paid id
      // we didn't own before). Skip the very first load (prev === null) so we
      // don't toast on sign-in. The functional update gives us the prior set
      // without threading it through deps.
      setOwnedCharacterIds((prev) => {
        if (prev) {
          const added = next.filter(
            (id) => !prev.includes(id) && PAID_CHARACTER_IDS.includes(id),
          );
          if (added.length) setStoreToast({ kind: 'added', ids: added });
        }
        return next;
      });
    } catch (err) {
      console.warn('[store] entitlements fetch failed', err);
    }
  }, [authToken]);

  // Auto-dismiss the store toast. 'ready' lingers a touch longer than 'added'.
  useEffect(() => {
    if (!storeToast) return;
    const t = window.setTimeout(() => setStoreToast(null), storeToast.kind === 'ready' ? 6000 : 8000);
    return () => window.clearTimeout(t);
  }, [storeToast]);

  // Fetch the owned set on sign-in; clear it on sign-out.
  useEffect(() => {
    if (!authToken) { setOwnedCharacterIds(null); return; }
    void refreshEntitlements();
  }, [authToken, refreshEntitlements]);

  // Pak download byte-progress from the main process.
  useEffect(() => {
    const api = window.electronAPI?.characterStore;
    if (!api?.onPakProgress) return;
    return api.onPakProgress(({ characterId, downloaded, total }) => {
      setPakProgress((p) => ({ ...p, [characterId]: total > 0 ? downloaded / total : 0 }));
    });
  }, []);

  // unclaw:// deep link from the Polar checkout-complete page -> refresh
  // entitlements immediately (polling is the fallback while the browser tab
  // is open). Also drains any link that arrived during cold start.
  //
  // Passthrough mode also enters via a deep link: the /unclaw skill runs
  // `open "unclaw://passthrough"`, which cold-starts (or focuses) the app
  // and lands here. `unclaw://passthrough?off` exits back to normal chat.
  useEffect(() => {
    const onLink = (url: string) => {
      if (/store|purchased|checkout/.test(url)) void refreshEntitlements();
      if (/^unclaw:\/\/passthrough/.test(url)) {
        setPassthrough(!/[?&]off\b/.test(url));
        window.electronAPI?.focusWindow?.();
      }
    };
    const off = window.electronAPI?.onDeepLink?.(onLink);
    void window.electronAPI?.getPendingDeepLink?.().then((u) => { if (u) onLink(u); });
    return () => { off?.(); };
  }, [refreshEntitlements]);

  // Poll entitlements for a couple of minutes after a checkout opens, so the
  // purchase lands even if the deep link is missed.
  const startCheckoutPoll = useCallback(() => {
    if (checkoutPollRef.current != null) return;
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
      void refreshEntitlements();
      if (ticks >= 40) { // ~2 min at 3s
        window.clearInterval(id);
        checkoutPollRef.current = null;
      }
    }, 3000);
    checkoutPollRef.current = id;
  }, [refreshEntitlements]);

  useEffect(() => () => {
    if (checkoutPollRef.current != null) window.clearInterval(checkoutPollRef.current);
  }, []);

  // The all-access bundle stays on Polar (real money); individual characters
  // are unlocked by spending claws. The picker calls onBuy(sku) for both — sku
  // is the bundle SKU for the bundle, else a character id.
  const handleBuy = useCallback(async (sku: string) => {
    if (!authToken) return;
    if (sku === BUNDLE_SKU) {
      try {
        const { url } = await createCheckout(authToken, sku);
        await window.electronAPI?.authOpenExternal?.(url);
        startCheckoutPoll();
      } catch (err) {
        console.warn('[store] checkout failed', err);
      }
      return;
    }
    // Individual character → spend claws. The worker deducts + grants the
    // entitlement; we then refresh owned (which triggers the auto-download).
    const res = await spendOnCharacter(authToken, sku);
    if (res.balance != null) setClawsBalance(res.balance);
    if (res.ok) {
      const name = agentById[sku]?.name ?? sku;
      setStoreToast({ kind: 'added', ids: [sku] });
      void refreshEntitlements();
      console.log(`[claws] unlocked ${name}, balance ${res.balance}`);
    } else if (res.reason === 'insufficient') {
      setClawsNotice(`Not enough claws. ${agentById[sku]?.name ?? 'This character'} costs ${CHARACTER_CLAW_COST}. Earn more by chatting.`);
    } else if (res.reason === 'already_owned') {
      void refreshEntitlements();
    }
  }, [authToken, startCheckoutPoll, refreshEntitlements, agentById]);

  // Install a paid character's cloned voice (supertonic + kokoro), gated by the
  // same entitlement as the pak. Idempotent + best-effort: skips the gated fetch
  // when both files are already on disk, and a failure just leaves the avatar on
  // the generic fallback voice until the next attempt. Without this, a purchased
  // character streams the wrong (default F1) voice.
  const ensureCharacterVoices = useCallback(async (agentId: string) => {
    if (!authToken) return;
    const api = window.electronAPI?.characterStore;
    if (!api?.hasVoices || !api?.downloadVoices) return;
    try {
      const present = await api.hasVoices({ characterId: agentId });
      if (present?.ok && present.complete) return; // already on disk
      const files = await fetchVoiceUrls(authToken, agentId);
      if (!files.length) return;
      const res = await api.downloadVoices({ characterId: agentId, files });
      if (!res?.ok) console.warn('[store] voice install failed', agentId, res?.error);
    } catch (err) {
      console.warn('[store] voice install error', agentId, err);
    }
  }, [authToken]);

  const handleDownloadPak = useCallback(async (agentId: string) => {
    if (!authToken) return;
    const api = window.electronAPI?.characterStore;
    if (!api?.downloadPak) return;
    try {
      setPakProgress((p) => ({ ...p, [agentId]: 0 }));
      const url = await fetchDownloadUrl(authToken, agentId);
      const res = await api.downloadPak({ characterId: agentId, url });
      if (res?.ok) {
        // Mid-session mount: when the pak was staged into the UE sandbox
        // container, ask UE to mount it now so the character is usable without
        // a relaunch. (On the next launch run_soul boot-mounts it regardless,
        // so this is best-effort.) Then re-scan so installedCharacters
        // refreshes and the card flips from "download" to pickable.
        if (res.mountPath) {
          pixelStreaming?.emitUIInteraction({ EventType: 'mountCharacterPak', pakPath: res.mountPath });
        }
        pixelStreaming?.emitUIInteraction({ EventType: 'getInstalledCharacters' });
        // Optimistically mark it installed so the card flips to "ready" right
        // away (UE's installedCharacters reply confirms it a beat later), and
        // fire the "ready" toast.
        setInstalledCharacterIds((prev) => (prev && !prev.includes(agentId) ? [...prev, agentId] : prev));
        void refreshLocalInstalled(); // pak is now on disk
        void ensureCharacterVoices(agentId); // gated cloned voice, so it doesn't speak in F1
        setStoreToast({ kind: 'ready', ids: [agentId] });
      } else {
        // Leave the card on "download" so the user can retry by clicking it,
        // and drop the auto-download guard so a later entitlement refresh can
        // re-attempt a transient failure.
        console.warn('[store] pak download failed', res?.error);
        provisionedRef.current.delete(agentId);
      }
    } catch (err) {
      console.warn('[store] pak download error', err);
      provisionedRef.current.delete(agentId);
    } finally {
      setPakProgress((p) => { const n = { ...p }; delete n[agentId]; return n; });
    }
  }, [authToken, pixelStreaming, ensureCharacterVoices]);

  // Eager character provisioning — the deliberate startup step that makes sure
  // every character the user OWNS is fully present locally before they'd reach
  // for it, instead of lazily downloading mid-session where a half-ready
  // character could break a switch. Runs the moment entitlements resolve (right
  // after sign-in / app start) and again whenever ownership grows (a purchase).
  //
  // Per owned paid character, idempotently (a per-id guard, cleared on failure
  // so a flaky network retries on the next entitlement refresh):
  //   - pak present (staged on disk OR baked into the build — Windows chunked
  //     builds ship paid chunks; UE reports those via installedCharacterIds) ->
  //     just ensure the cloned voice is on disk, so it never falls back to F1.
  //   - pak missing -> download it (handleDownloadPak also installs the cloned
  //     voice and mounts the pak mid-session so it's usable now).
  // The base character streams throughout; the + menu shows per-character
  // download progress and won't let you switch to one that isn't ready yet.
  const provisionedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authToken || !ownedCharacterIds) return;
    for (const id of ownedCharacterIds) {
      if (!PAID_CHARACTER_IDS.includes(id)) continue;
      if (provisionedRef.current.has(id)) continue;   // already handled this session
      if (pakProgress[id] != null) continue;          // a download is in flight
      provisionedRef.current.add(id);
      // Present = staged on disk OR baked into the build (UE reports baked paid
      // chunks via installedCharacterIds — the case on Windows chunked builds).
      // Same rule the + menu's readiness check uses. A truly-absent pak
      // downloads; a staged pak whose version DRIFTED from the manifest (a newer
      // pak was cooked) re-downloads; an up-to-date or baked-in one just gets
      // its voice ensured. Baked-in paks are never in staleInstalledIds (that
      // set is staged-only), so they refresh via the UE update, not here.
      const present = localInstalledIds.includes(id) || (installedCharacterIds?.includes(id) ?? false);
      const needsPak = !present || staleInstalledIds.includes(id);
      if (needsPak) {
        void handleDownloadPak(id);                   // pak + mount + voice
      } else {
        void ensureCharacterVoices(id);               // pak current, ensure voice
      }
    }
  }, [authToken, ownedCharacterIds, installedCharacterIds, localInstalledIds, staleInstalledIds, pakProgress, handleDownloadPak, ensureCharacterVoices]);

  // Owned paid characters still being fetched at startup (pak missing, or a
  // drifted staged version being refreshed). Drives the non-blocking "preparing
  // your characters" status so provisioning reads as a deliberate init step,
  // not a silent mid-session background fetch.
  const provisioningIds = useMemo(
    () => (ownedCharacterIds ?? []).filter(
      (id) => PAID_CHARACTER_IDS.includes(id)
        && ((!localInstalledIds.includes(id) && !(installedCharacterIds?.includes(id) ?? false))
            || staleInstalledIds.includes(id)),  // missing, or refreshing a drifted pak
    ),
    [ownedCharacterIds, localInstalledIds, installedCharacterIds, staleInstalledIds],
  );

  // Track whether the AI is currently producing audible output. Voice
  // mode uses this to gate VAD and to detect barge-in.
  const isAISpeakingRef = useRef(false);

  // Forward declaration for cross-references between voice and chat.
  const notifyAIFinishedRef = useRef<() => void>(() => {});

  // Streaming Moonshine transcriber. One instance for the whole app;
  // both push-to-talk (spacebar) and continuous voice mode (button)
  // drive the same low-level transcriber. They're mutually exclusive
  //, only one mode can be active at a time, enforced by the start
  // calls below.
  const streaming = useStreamingTranscriber();

  // Ref to the InputBar's imperative handle, used to drop the final
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
  // can clear it from anywhere, useEffect cleanup, escalation done, etc.
  const escalationIntervalRef = useRef<number | null>(null);

  // Streaming Kokoro chat state. AbortController cancels an in-flight
  // /chat_stream_audio fetch on barge-in / new turn; the timeout set
  // tracks every scheduled chunk dispatch so we can yank them all when
  // the user interrupts before they've played. Both get drained at the
  // top of every handleSendMessage call.
  const streamAbortRef = useRef<AbortController | null>(null);
  const pendingChunkTimeoutsRef = useRef<Set<number>>(new Set());

  // Cancel any in-flight stream + drop pending chunk dispatches. Called
  // on barge-in and at the top of each new send so an old reply can't
  // leak descriptors into a fresh turn.
  const cancelActiveStream = useCallback(() => {
    if (streamAbortRef.current) {
      try { streamAbortRef.current.abort(); } catch { /* already aborted */ }
      streamAbortRef.current = null;
    }
    pendingChunkTimeoutsRef.current.forEach((tid) => {
      window.clearTimeout(tid);
    });
    pendingChunkTimeoutsRef.current.clear();
  }, []);

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
    let addedTurn: Turn | null = null;
    if (result.response) {
      // memory.add returns the created Turn (with its generated ts)
      // so callers can correlate side-data (e.g. tools-used labels)
      // with the assistant turn that just landed. Web citations from
      // an escalation web_search ride along on `result.web_sources`
      //, attach them to this turn so the chat pane can render
      // attribution chips. Sources never go back to the LLM (memory's
      // getHistory strips them).
      const rawSources = (result as { web_sources?: unknown }).web_sources;
      const sources = Array.isArray(rawSources)
        ? (rawSources as Array<{ uri?: unknown; title?: unknown }>)
            .filter(s => typeof s?.uri === 'string' && (s.uri as string).length > 0)
            .map(s => ({
              uri: s.uri as string,
              title: typeof s.title === 'string' && s.title ? (s.title as string) : (s.uri as string),
            }))
        : undefined;
      addedTurn = memory.add('assistant', result.response, sources);
      // Cache the latest response so a barge-in can pass it as
      // "what I was just saying" context to the LLM.
      lastResponseRef.current = result.response;
    }

    const action = result.action;
    const actionName = action?.name;
    const isAnimAction = actionName === 'give_a_kiss'
      || actionName === 'do_dance'
      || actionName === 'say_hello'
      || actionName === 'react_as_star_wars_fan'
      || actionName === 'celebrate';

    if (pixelStreaming) {
      pixelStreaming.emitUIInteraction({
        EventType: 'respond_with_mood_server',
        JobId: result.id,
        Mood: result.mood,
        Response: toBase64(result.response),
        Behavior: result.behavior ?? '',
        Timestamp: new Date().toISOString(),
      });

      // Escalation results are enqueued by soul with broadcast=False
      // (the historic poll-emit-broadcast double-play guard), so the
      // renderer is the authority on when UE fetches + plays each
      // chunk. After the mood/text descriptor is in UE's hands, fire
      // POST /broadcast/{id} to push the /ws "job" event UE needs to
      // pull /result/{id} and play audio. Without this, the final
      // agentic answer appeared as text but the avatar stayed silent
      // (bug observed 2026-05-27: "what is the weather" escalates,
      // transition reply is voiced, real answer is text-only).
      //
      // For non-escalation `/chat` results soul already broadcast at
      // synthesis time, the second broadcast is a no-op JobId dedupe
      // on UE's side, so safe to fire unconditionally.
      if (result.id) {
        void fetch(`${getSoulBaseUrl()}/broadcast/${result.id}`, {
          method: 'POST',
        }).catch((err) => {
          console.warn('[chat] /broadcast ping failed', err);
        });
      }

      if (isAnimAction && action) {
        dispatchActionToUE(pixelStreaming, action, result.response);
      }
      if (pixelStreaming) {
        dispatchBodyToUE(pixelStreaming, result.body);
      }
    }

    if (action && isReminderAction(action.name)) {
      setRefreshKey(k => k + 1);
    }
    // Escalation results carry an `escalation_id` (soul sets it on the
    // final dict). The agentic loop may have written reminders via the
    // bridged MCP tools, in which case the reminder action never lands
    // in `action` (the final answer's `action` is None for plain-text
    // replies). Bump refreshKey unconditionally on any escalation
    // result so the reminders panel, stocks/news/weather widgets, etc.
    // re-fetch their state once the loop wraps up. Bug observed
    // 2026-05-27: claude-code agentic created a reminder for "check in
    // with Scholar" via mcp__unclaw__create_event_reminder, the row was
    // written to soul's store but the UI never refreshed.
    if ((result as { escalation_id?: string }).escalation_id) {
      setRefreshKey(k => k + 1);
    }

    isAISpeakingRef.current = true;
    const speakSec = (result as { duration?: number }).duration ?? 4;
    window.setTimeout(() => {
      isAISpeakingRef.current = false;
      notifyAIFinishedRef.current();
    }, Math.round(speakSec * 1000));
    return addedTurn;
  }, [pixelStreaming, memory]);

  /** Dispatch ONE streaming chunk to UE. Mirrors the descriptor shape
   *  dispatchChatResult sends but skips memory + the speak-finished
   *  timer, those happen once per stream (memory on first chunk, timer
   *  on the final-chunk total_duration). Action animations are also
   *  scoped to chunk 0 since soul only attaches `action` there.
   *
   *  Also fires POST /broadcast/{id} so the soul portal HTML's /ws
   *  subscriber updates the curves + audio waveform display in
   *  lockstep with playback. Soul stages chunks with broadcast=False
   *  to keep UE from auto-fetching at synthesis rate; the renderer is
   *  the authority on when each chunk plays. */
  const dispatchChatChunk = useCallback((chunk: SoulChatChunk) => {
    if (!pixelStreaming) return;
    pixelStreaming.emitUIInteraction({
      EventType: 'respond_with_mood_server',
      JobId: chunk.id,
      Mood: chunk.mood,
      // The mirror text descriptor uses the FULL response on every
      // chunk (soul fills it in identically). Renderer-side memory is
      // updated once outside this helper.
      Response: toBase64(chunk.response),
      Behavior: chunk.behavior ?? '',
      Timestamp: new Date().toISOString(),
    });
    // Fire the portal's WS broadcast so its curves/waveform display
    // tracks playback. Best-effort, failure is logged, never thrown,
    // so a flaky portal subscriber never breaks the chat path.
    if (chunk.id) {
      void fetch(`${getSoulBaseUrl()}/broadcast/${chunk.id}`, {
        method: 'POST',
      }).catch((err) => {
        console.warn('[chat] /broadcast ping failed', err);
      });
    }
    if (chunk.chunk_idx === 0 && chunk.action) {
      const action = chunk.action;
      const isAnim = action.name === 'give_a_kiss'
        || action.name === 'do_dance'
        || action.name === 'say_hello'
        || action.name === 'react_as_star_wars_fan'
        || action.name === 'celebrate';
      if (isAnim) {
        dispatchActionToUE(pixelStreaming, action, chunk.response);
      }
      if (isReminderAction(action.name)) {
        setRefreshKey(k => k + 1);
      }
    }
    if (chunk.chunk_idx === 0 && pixelStreaming) {
      dispatchBodyToUE(pixelStreaming, chunk.body);
    }
  }, [pixelStreaming]);

  /** Start a 1.2s poll loop against /escalation/{id}/next. Each polled
   *  result is dispatched through the same UE pipeline a primary /chat
   *  result uses. Stops when the server says no more work AND the queue
   *  is drained. The polling rate is conservative: gpt-5-mini + browser
   *  tools have multi-second loops and there's nothing to gain by
   *  hammering the endpoint faster. */
  const startEscalationPolling = useCallback((jobId: string) => {
    // Clear any previous interval, defensive, e.g. if two escalations
    // overlapped (shouldn't happen but isSending isn't bulletproof).
    if (escalationIntervalRef.current !== null) {
      window.clearInterval(escalationIntervalRef.current);
      escalationIntervalRef.current = null;
    }
    setEscalating(true);
    statusIdRef.current += 1;
    setStatusHistory([{ id: statusIdRef.current, text: 'thinking' }]);
    // Seed the timeline with a "thinking" tool event so the user
    // sees the model's first beat of activity in the chat stack.
    toolEventIdRef.current += 1;
    setToolEvents((prev) => [...prev, {
      id: toolEventIdRef.current,
      ts: Date.now(),
      label: 'thinking',
    }]);
    lastToolLabelRef.current = 'thinking';

    const stop = () => {
      if (escalationIntervalRef.current !== null) {
        window.clearInterval(escalationIntervalRef.current);
        escalationIntervalRef.current = null;
      }
      setEscalating(false);
      setStatusHistory([]);
      // Tool events are KEPT, they're now part of the conversation
      // history at the timestamps they happened, interleaved with
      // user/assistant turns by the chat pane.
    };

    const pushStatus = (text: string) => {
      // Dedupe consecutive identical labels, a tool emitting the
      // same status twice in a row shouldn't render twice.
      if (lastToolLabelRef.current === text) {
        // Still update the floating-pill stack since it has its own
        // "newest only" behavior.
        setStatusHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1].text === text) return prev;
          statusIdRef.current += 1;
          const next = [...prev, { id: statusIdRef.current, text }];
          return next.slice(-2);
        });
        return;
      }
      lastToolLabelRef.current = text;
      // Append to the unified timeline so the chat pane can render
      // the tool as its own row at this moment in the conversation.
      toolEventIdRef.current += 1;
      setToolEvents((prev) => [...prev, {
        id: toolEventIdRef.current,
        ts: Date.now(),
        label: text,
      }]);
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
          const addedTurn = dispatchChatResult(step.result);
          // Snapshot pending tools onto the FINAL assistant turn that
          // closes this escalation. Narration turns mid-flight don't
          // get the snapshot, they're just the model's progress
          // updates, not the resolved answer. The "final" trigger:
          // server says no more results queued (`!step.more`).
          // Tool events are already in the timeline at their original
          // timestamps; nothing to migrate when the final lands.
          // NOTE: don't reset lastToolLabelRef here, the soul polling
          // queue can drain a trailing duplicate status AFTER the
          // final result (different items on different ticks). With
          // the ref reset, that duplicate bypasses the dedup and
          // shows up as a second identical tool row. The next
          // escalation's startEscalationPolling seeds the ref to
          // 'thinking' anyway, so there's no need to clear it now.
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

  // Tidy up the polling interval when App unmounts, orphaned intervals
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

  // File-picker attach (Plus button on the input bar). InputBar
  // normalizes via canvas before calling us, same shape as paste.
  // Supports multiple files at once.
  const handleAttachImages = useCallback(
    (imgs: Array<{ base64: string; width: number; height: number }>) => {
      if (imgs.length === 0) return;
      setAttachedImages((prev) => [
        ...prev,
        ...imgs.map((img) => {
          screenshotIdRef.current += 1;
          return {
            id: screenshotIdRef.current,
            base64: img.base64,
            width: img.width,
            height: img.height,
          };
        }),
      ]);
    },
    [],
  );

  // /express slash command, fires a Text2Face-only probe with the
  // emotion as the mood prompt. Bypasses LLM, TTS, and LipSync; UE
  // just plays the resulting face animation. We emit the same
  // respond_with_mood_server UE event the regular chat path uses
  // (UE polls /result/{id} for the arkit_raw) but with an empty
  // Response field since there's no speech to attribute to anyone,
  // and we DON'T add anything to chat memory because /express is a
  // probe, not a conversation turn.
  const handleExpress = useCallback(async (emotion: string) => {
    if (!pixelStreaming) return;
    try {
      const result = await expressFace(emotion);
      pixelStreaming.emitUIInteraction({
        EventType: 'respond_with_mood_server',
        JobId: result.id,
        Mood: result.mood,
        Response: toBase64(''),
        Behavior: result.behavior ?? '',
        Timestamp: new Date().toISOString(),
      });
      // Gate /idle while the face plays, same pattern as the chat
      // result path.
      isAISpeakingRef.current = true;
      const speakSec = result.duration ?? 3;
      window.setTimeout(() => {
        isAISpeakingRef.current = false;
        notifyAIFinishedRef.current();
      }, Math.round(speakSec * 1000));
    } catch (err) {
      console.warn('[express] failed', err);
    }
  }, [pixelStreaming]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (isSending) return;

    // Allow image-only sends: the user can stage one or more
    // screenshots and hit Enter with no text. Soul fills in a generic
    // "What is shown in this screenshot?" prompt on its end.
    const trimmed = message.trim();
    const pendingImages = attachedImages;
    if (!trimmed && pendingImages.length === 0) return;

    // NOTE: the per-message claw is awarded on SUCCESS only, down in the chat
    // result handlers (awardClawForInteraction). Awarding here at send time
    // credited a claw even when the turn failed (bad key, missing model), which
    // let a user farm claws with an invalid key. See the success paths below.

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
    // Same idea for the streaming Kokoro path: kill any in-flight
    // stream + drop any chunk dispatches still queued for the future.
    cancelActiveStream();
    setEscalating(false);
    setStatusHistory([]);
    // Reset the dedupe ref. Tool events that already landed in the
    // timeline stay there at their original timestamps; cancelling
    // an escalation mid-flight just means the answer never arrives,
    // not that the visible activity should be erased.
    lastToolLabelRef.current = '';
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

    // Record the user turn, with any staged screenshots so the chat
    // pane renders them in-bubble. Image-only sends (no text) still
    // create a turn now; `add` allows an empty-content turn when it
    // carries images.
    const pendingImageB64 = pendingImages.map((img) => img.base64);
    if (trimmed || pendingImageB64.length > 0) {
      memory.add(
        'user',
        trimmed,
        undefined,
        pendingImageB64.length > 0 ? pendingImageB64 : undefined,
      );
    }
    const history = memory.getHistory();

    // Snapshot the screenshot stack at send time and immediately
    // clear so the user can start staging the next batch without
    // waiting for this round to finish.
    if (pendingImages.length > 0) setAttachedImages([]);

    // When the user interrupts mid-response, give the LLM the text it
    // was saying so it can adapt, don't repeat info, treat the user's
    // input as a follow-up/correction. Composed AFTER the persona
    // prompt so the persona voice still leads.
    const systemExt = interruptedText
      ? `${persona.prompt}\n\n[INTERRUPTION CONTEXT] You were just speaking when the user interrupted you. The text you were in the middle of saying was: "${interruptedText.slice(0, 600)}". The user may have only heard part of it. Respond to what they're saying NOW. Don't simply repeat what you already said. If their new message is a follow-up question, a correction, or a tangent, address it directly and naturally.`
      : persona.prompt;

    // Streaming Kokoro path: when the user picked Kokoro local AND
    // there are no images attached (escalation handles vision; soul's
    // streaming endpoint doesn't), drive a chunked /chat_stream_audio.
    // Each chunk is scheduled to dispatch to UE based on cumulative
    // audio duration so playback is gapless even when chunks arrive
    // in bursts (and well before the full reply has been synthesized).
    let useStreaming = false;
    // Silence inserted between streamed sentence chunks. The UE face plugin now
    // holds the speaking pose across chunks (start/endUtterance + IsSpeaking), so
    // supertonic dispatches nearly back-to-back for continuous playback; Kokoro
    // keeps its longer sentence breath.
    let interChunkGapMs = 800;
    try {
      const keys = await fetchApiKeys();
      // Stream (per-sentence chunked TTS) for in-process kokoro-onnx (recommended
      // mode) and supertonic. Both ride soul's /chat_stream_audio and the UE
      // utterance latch, so the avatar starts speaking on the first sentence
      // instead of waiting for the whole reply. Custom Kokoro endpoints,
      // ElevenLabs, and image-bearing turns (escalation) stay on /chat.
      const localStreamingTts =
        (keys.tts_provider === 'kokoro' && keys.kokoro_mode === 'recommended') ||
        keys.tts_provider === 'supertonic';
      if (localStreamingTts) {
        useStreaming = pendingImages.length === 0;
        interChunkGapMs = keys.tts_provider === 'supertonic' ? 60 : 800;
      }
    } catch { /* fall through to non-streaming */ }

    if (useStreaming) {
      const ac = new AbortController();
      streamAbortRef.current = ac;
      let firstChunkArrivedAt = 0;
      let memoryAdded = false;
      let totalDuration = 0;
      let totalChunks = 0;
      let escalationFallback: SoulChatChunk | null = null;
      // Tells the UE face plugin "chunks are coming — stay in the speaking pose
      // and don't blank between them" until we send the matching endUtterance.
      // Only emitted once a real chunk actually arrives (an escalation-only
      // turn never opens an utterance). One-shot providers never enter this.
      let utteranceBegun = false;
      // endUtterance must reach UE AFTER the final chunk's PlayWithAudio (the data
      // channel is ordered), so the plugin winds down on real queue-drain instead
      // of a timer that can fire mid-reply and dip the face to idle. We close the
      // utterance from the final chunk's dispatch callback; the speakMs timer and
      // catch/finally are idempotent backstops. endUtteranceOnce guards re-entry.
      let utteranceEnded = false;
      let finalChunkIdx = -1;
      let lastSeenChunkIdx = -1;
      const endUtteranceOnce = () => {
        if (utteranceBegun && !utteranceEnded) {
          utteranceEnded = true;
          pixelStreaming?.emitUIInteraction({ EventType: 'endUtterance' });
        }
      };
      try {
        for await (const chunk of streamChatViaSoul(trimmed, {
          systemExtension: systemExt,
          voices: persona.voices,
          history,
          signal: ac.signal,
        })) {
          if (chunk._escalation_request) {
            escalationFallback = chunk;
            continue;
          }
          if (chunk.is_final) {
            totalDuration = chunk.total_duration ?? totalDuration;
            totalChunks = chunk.n_chunks ?? totalChunks;
            // Index of the last content chunk, so its dispatch callback can close
            // the utterance the instant it ships (falls back to the highest idx
            // actually seen if n_chunks is absent).
            finalChunkIdx = (chunk.n_chunks ?? (lastSeenChunkIdx + 1)) - 1;
            continue;
          }
          // First non-final chunk anchors the timeline. Add memory
          // once with the FULL response text (soul ships it on every
          // chunk; we only stamp the assistant turn into our local
          // memory the first time so the chat pane doesn't get N
          // duplicated entries).
          const now = performance.now();
          lastSeenChunkIdx = Math.max(lastSeenChunkIdx, chunk.chunk_idx);
          if (firstChunkArrivedAt === 0) {
            firstChunkArrivedAt = now;
            // Open the utterance the moment the first chunk lands, before it
            // dispatches, so the plugin is already holding when chunk 0 plays.
            if (!utteranceBegun) {
              pixelStreaming?.emitUIInteraction({ EventType: 'startUtterance' });
              utteranceBegun = true;
            }
          }
          if (!memoryAdded && chunk.response) {
            memory.add('assistant', chunk.response);
            lastResponseRef.current = chunk.response;
            memoryAdded = true;
          }
          // Schedule. Negative deltas (chunk arrived after its play
          // time) dispatch immediately, happens when synth is slower
          // than the audio it produced, i.e. the buffer is empty.
          // A small breath between chunks so sentence boundaries get natural
          // prosodic spacing instead of butting up against each other. Both
          // streamed engines split on sentence boundaries, so the gap lands on
          // a natural pause; supertonic uses a much shorter seam (see above).
          const playAt = firstChunkArrivedAt
            + ((chunk.start_offset_s ?? 0) * 1000)
            + (chunk.chunk_idx * interChunkGapMs);
          const delay = Math.max(0, playAt - now);
          const tid = window.setTimeout(() => {
            pendingChunkTimeoutsRef.current.delete(tid);
            dispatchChatChunk(chunk);
            // Final chunk just shipped — close the utterance right behind it. The
            // ordered data channel guarantees UE sees endUtterance after this
            // chunk's PlayWithAudio, so it winds down on real drain, never mid-reply.
            if (chunk.chunk_idx === finalChunkIdx) endUtteranceOnce();
          }, delay);
          pendingChunkTimeoutsRef.current.add(tid);
        }
        // Stream done. If LLM picked escalation we fall back to
        // chatViaSoul (the streaming pipeline doesn't host the
        // escalation orchestrator yet).
        if (escalationFallback) {
          const fallback = await chatViaSoul(trimmed, {
            systemExtension: systemExt,
            voices: persona.voices,
            history,
            images: pendingImages.map((img) => img.base64),
          });
          dispatchChatResult(fallback);
          if (fallback.escalation?.id) {
            startEscalationPolling(fallback.escalation.id);
          }
        } else {
          // Set the AI-speaking timer using the cumulative duration
          // reported on the final chunk PLUS the inter-chunk gaps the
          // scheduler inserted (n_chunks - 1 gaps). Must use the SAME
          // interChunkGapMs the scheduler used above, or the speaking
          // timer drifts from actual playback. Once it elapses the notify
          // hook fires and the voice agent can resume.
          const gapsMs = Math.max(0, totalChunks - 1) * interChunkGapMs;
          const speakMs = (totalDuration > 0 ? totalDuration * 1000 : 4000) + gapsMs;
          const timerId = window.setTimeout(() => {
            pendingChunkTimeoutsRef.current.delete(timerId);
            // Backstop only: the final chunk's dispatch normally closes the
            // utterance already. This covers a missing is_final / dropped final
            // chunk so the plugin never holds the speaking pose. Idempotent.
            endUtteranceOnce();
            isAISpeakingRef.current = false;
            notifyAIFinishedRef.current();
          }, Math.round(speakMs));
          pendingChunkTimeoutsRef.current.add(timerId);
        }
        // Successful interaction: a real reply streamed in (memoryAdded), or the
        // escalation fallback produced one. Inside the try so a throw above
        // (bad key / provider error) skips the award.
        if (memoryAdded || escalationFallback) awardClawForInteraction();
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          console.error('[chat] soul /chat_stream_audio failed:', err);
          setPipelineError(friendlyPipelineError(err));
        }
        // Balance any open utterance so the plugin doesn't hold the speaking
        // pose (the plugin also self-heals after MaxHoldSeconds, but be tidy).
        endUtteranceOnce();
        isAISpeakingRef.current = false;
      } finally {
        if (streamAbortRef.current === ac) streamAbortRef.current = null;
        setIsSending(false);
      }
      return;
    }

    try {
      const result = await chatViaSoul(trimmed, {
        systemExtension: systemExt,
        voices: persona.voices,
        history,
        images: pendingImages.map((img) => img.base64),
      });

      dispatchChatResult(result);
      // Successful turn: credit the claw. chatViaSoul throws on a non-2xx
      // (bad key, missing model, provider error), so a failed turn never
      // reaches here and earns nothing.
      awardClawForInteraction();

      // 20b chose to escalate (or soul auto-routed to escalation
      // because we attached image(s)). The transition reply has
      // already been voiced via dispatchChatResult, now start
      // polling for narrations and the final response.
      if (result.escalation && result.escalation.id) {
        startEscalationPolling(result.escalation.id);
      }
    } catch (err) {
      console.error('[chat] soul /chat failed:', err);
      if ((err as { name?: string })?.name !== 'AbortError') {
        setPipelineError(friendlyPipelineError(err));
      }
      isAISpeakingRef.current = false;
    } finally {
      setIsSending(false);
    }
  }, [isSending, persona, memory, attachedImages, dispatchChatResult, dispatchChatChunk, startEscalationPolling, cancelActiveStream, awardClawForInteraction]);

  // Slash-command animation dispatcher, hands a ready-to-go UE
  // descriptor to the dock so it can fire `/dance`, `/kiss`, `/hello`
  // without round-tripping through the LLM.
  const dispatchAnimation = useCallback((
    name: 'give_a_kiss' | 'do_dance' | 'say_hello' | 'react_as_star_wars_fan' | 'celebrate',
  ) => {
    if (!pixelStreaming) return;
    const eventType =
      name === 'do_dance' ? 'doDance' :
      name === 'react_as_star_wars_fan' ? 'doSWIdle' :
      name;
    pixelStreaming.emitUIInteraction({
      EventType: eventType,
      SendData: true,
      Response: '',
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming]);

  // Voice failures (mic permission, worklet, etc.) otherwise reject straight to
  // the console where no user ever sees them. Surface them as a dismissible
  // notice above the input bar; mic-permission ones offer a jump to Settings.
  const [voiceNotice, setVoiceNotice] = useState<
    { text: string; kind: 'mic' | 'generic' } | null
  >(null);
  const voiceNoticeTimer = useRef<number | null>(null);
  const showVoiceNotice = useCallback(
    (text: string, kind: 'mic' | 'generic') => {
      setVoiceNotice({ text, kind });
      if (voiceNoticeTimer.current) {
        window.clearTimeout(voiceNoticeTimer.current);
        voiceNoticeTimer.current = null;
      }
      // Mic notices are STICKY like the "set up your keys / model" warnings ,
      // they need a user action (grant access), so they stay until dismissed or
      // until voice actually starts (cleared by the effect below). Generic
      // hiccups self-clear.
      if (kind !== 'mic') {
        voiceNoticeTimer.current = window.setTimeout(() => setVoiceNotice(null), 6000);
      }
    },
    [],
  );

  const voice = useVoiceAgent({
    onTranscript: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Mirror the PTT visual: drop the final transcription into the
      // textarea so the user briefly sees what was heard, then send.
      // The InputBar's send path will clear the textarea on its way
      // out (sets message to '' inside handleSend); for the voice
      // path we clear explicitly after dispatch so the next utterance
      // starts from an empty surface.
      inputBarRef.current?.setText(trimmed);
      void handleSendMessage(trimmed);
      // Race window between setText and the chat-firing reset is fine
      //, the user message lands in the chat pane immediately, so the
      // textarea content is just a momentary mirror anyway.
      window.setTimeout(() => {
        inputBarRef.current?.setText('');
        // Continuous mode keeps `voice.isListening` true between utterances, so
        // the transcriber still holds the just-finalized `committed` text until
        // the next startFeed. Reset it here or the setText effect above would
        // immediately re-populate the bar with the utterance we just sent.
        streaming.reset();
      }, 0);
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
      // Stage 1: tentative interruption, we've heard ~256 ms of
      // confident user speech while the AI is talking. Mute audio
      // immediately so the user has silence to talk into; cache
      // what was being said so the next chat (if it actually
      // fires) can pass it to the LLM as "you were interrupted
      // saying X" context.
      const v = document.querySelector('video');
      if (v) v.muted = true;
      isAISpeakingRef.current = false;
      pendingInterruptedRef.current = lastResponseRef.current || null;

      // Stage 2: false-alarm guard, if no transcription comes
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
          // Don't flip isAISpeakingRef back to true, the audio
          // was already in flight and its natural duration timer
          // (set in dispatchChatResult) will clear it normally.
        }
      }, 1500);
    },
    onError: (msg) => {
      console.warn('[voice]', msg);
      const denied = /permission denied|notallowed|not-?allowed/i.test(msg);
      if (denied) {
        showVoiceNotice(
          'Microphone access is off, so voice mode can’t hear you.',
          'mic',
        );
      } else {
        showVoiceNotice('Voice mode hit a snag. Tap the mic to try again.', 'generic');
      }
    },
  });

  // Toggle voice mode. Before STARTING, proactively confirm the OS mic grant so
  // we trigger the macOS prompt (or a clear notice) instead of a silent
  // getUserMedia NotAllowedError. Stopping is always allowed.
  const handleVoiceToggle = useCallback(async () => {
    if (!voice.isListening) {
      try {
        const ok = await window.electronAPI?.mic?.request?.();
        if (ok === false) {
          showVoiceNotice(
            'Microphone access is off, so voice mode can’t hear you.',
            'mic',
          );
          return;
        }
      } catch {
        /* non-electron / older preload: fall through to voice.toggle */
      }
    }
    void voice.toggle();
  }, [voice, showVoiceNotice]);

  // Voice started successfully → mic access is clearly fine, so retire any
  // lingering mic warning.
  useEffect(() => {
    if (voice.isListening) {
      setVoiceNotice((n) => (n?.kind === 'mic' ? null : n));
    }
  }, [voice.isListening]);

  // Listening reactions (backchannel): while the user speaks, ping soul so
  // the avatar visibly attends (brow flick on start, slow nods while they
  // keep talking, an acknowledgment nod when they stop). Soul gates all the
  // hard cases server-side (captured mode, cooldowns, avatar-speaking), so
  // this effect just mirrors the VAD state. The `sustained` interval only
  // runs while speech is actually held.
  const listeningSpokeAtRef = useRef<number>(0);
  useEffect(() => {
    if (!voice.isUserSpeaking) return;
    // Barge-in has its own choreography (mute + interrupt); skip reactions.
    if (isAISpeakingRef.current) return;
    listeningSpokeAtRef.current = Date.now();
    sendListeningEvent('start');
    const iv = window.setInterval(() => sendListeningEvent('sustained'), 2500);
    return () => {
      window.clearInterval(iv);
      // Acknowledge only real utterances, not VAD blips.
      if (Date.now() - listeningSpokeAtRef.current > 1200) {
        sendListeningEvent('end');
      }
    };
  }, [voice.isUserSpeaking]);

  useEffect(() => {
    notifyAIFinishedRef.current = voice.notifyAIFinished;
  }, [voice.notifyAIFinished]);

  useEffect(() => {
    if (isSending) {
      const v = document.querySelector('video');
      if (v) v.muted = false;
    }
  }, [isSending]);

  // Top-level badge poll. Independent of the panels, the rail
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

  // Resume auth session on app start. Independent of stream state , 
  // the SignInScreen renders over the loading screen anyway, so the
  // user can authenticate while the UnClaw Engine is still warming up.
  useEffect(() => {
    // A signed-in account is now required. Drop any stale guest-mode
    // flag from an older build so prior "Continue without an account"
    // sessions land on the SignInScreen instead of silently bypassing it.
    try { localStorage.removeItem(GUEST_MODE_KEY); } catch { /* ignore */ }
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
    // Wipe UE's applied config (outfit / colors / lighting) on the way out so
    // the next user's stream starts clean — the stream stays connected under
    // the SignInScreen, so this lands before anyone signs back in. Then re-run
    // the reconcile driver (same as reset session / reset account) so the
    // blanked stage gets the base character re-driven for the next sign-in,
    // rather than leaving a stale resolved flag on a now-empty stage.
    try {
      pixelStreaming?.emitUIInteraction({ EventType: 'reset', Timestamp: new Date().toISOString() });
    } catch { /* ignore */ }
    setTimeout(() => setUeSessionEpoch((e) => e + 1), 150);
    await signOut(authToken ?? null);
    setAuthToken(null);
    setAuthUser(null);
    setProfile(undefined);
    setWizardMode(null);
    // Allow a fresh sync if the user signs back in this session.
    profileSyncedRef.current = false;
  }, [authToken, pixelStreaming]);

  // Account reset, wipes every local + cloud surface and drops the
  // app back to the SignInScreen (or first-run wizard for guests).
  // Bound to the "Reset all data" entry in the profile popover so the
  // user can re-test onboarding end-to-end without manually clearing
  // safeStorage / D1 / soul state.
  const handleResetAccount = useCallback(async () => {
    try {
      await resetEverything(authToken ?? null);
      // Drop the account's cloud chat too (chat lives in its own store, so
      // resetEverything — which clears the settings blob — doesn't cover it).
      if (authToken) await deleteCloudChat(authToken);
    } catch (err) {
      console.warn('[reset] some steps failed', err);
    }
    // Unclaim the machine so the next sign-in starts from a clean owner. Clear
    // BOTH the durable main-process marker and the localStorage mirror.
    try { await window.electronAPI?.clearLocalOwner?.(); } catch { /* ignore */ }
    try { localStorage.removeItem(LOCAL_ACCOUNT_KEY); } catch { /* ignore */ }
    clearLocalChatHistory();
    resetStack();
    setSelectedInstanceId(BASE_INSTANCE_ID);
    // Wipe UE's applied config so the reset is reflected in the live stream,
    // then re-run the reconcile driver so the blanked stage gets the base
    // character (Grace) re-driven in for the next sign-in / first run.
    try {
      pixelStreaming?.emitUIInteraction({ EventType: 'reset', Timestamp: new Date().toISOString() });
    } catch { /* ignore */ }
    setTimeout(() => setUeSessionEpoch((e) => e + 1), 150);
    // Drop everything in-memory so the next render starts from a
    // first-run shape: SignInScreen up (no token), profile unresolved
    // (will fall through to the wizard once auth is back).
    setAuthToken(null);
    setAuthUser(null);
    setProfile(undefined);
    setWizardMode(null);
    profileSyncedRef.current = false;
  }, [authToken, resetStack, pixelStreaming]);

  // Apply ONE instance's saved outfit to whatever character is currently live
  // in UE. Called at switch time (scope 'scene': the key light + backdrop are
  // persistent-level actors, they apply while UE is still swapping classes),
  // after a `characterReady` signal (scope 'outfit'), and with scope 'full'
  // on the paths where the character is already live (same-class fast path,
  // connect reconcile on-target). No-op when the instance has no saved
  // wardrobe -> the character keeps its authored UE defaults.
  //
  // The chain itself (sparse sends, ordering, pipelined fire + single ack
  // probe, the full descriptor contract) lives in
  // src/wardrobe/dressCharacter.ts. This wrapper owns the React-side
  // concerns: single-flight + cancellation. A run claims a fresh epoch unless
  // the caller passes one (the scene run at switch time and the outfit run at
  // characterReady share an epoch, so the outfit run doesn't cancel a scene
  // probe/re-fire still in flight). emitAgentSwitch / reset / disconnect bump
  // the epoch, so a superseded run stops at its next send instead of dressing
  // a character it no longer owns.
  //
  // `agentIdForWardrobe` is the instance being dressed, passed explicitly
  // rather than read off the active instance: this runs right after a swap,
  // when "active" may still be the character we just left.
  const applyInstanceWardrobe = useCallback(async (
    w: WardrobeSettings | null | undefined,
    agentIdForWardrobe?: string | null,
    opts?: { scope?: DressScope; epoch?: number },
  ) => {
    if (!pixelStreaming) return;
    // An instance with NO saved wardrobe still dresses: buildDressPayloads sends
    // -1 for every slot (keep-authored-default), which resets the character on a
    // switch instead of letting the previous character's outfit bleed through.
    const epoch = opts?.epoch ?? ++dressEpochRef.current;
    const isAlive = () => dressEpochRef.current === epoch;
    await dressCharacter({
      wardrobe: w ?? {},
      agentId: agentIdForWardrobe,
      scope: opts?.scope ?? 'full',
      emit: (payload) => {
        pixelStreaming.emitUIInteraction({
          ...payload,
          Timestamp: new Date().toISOString(),
        });
      },
      waitForAck,
      isAlive,
    });
  }, [pixelStreaming, waitForAck]);
  applyInstanceWardrobeRef.current = applyInstanceWardrobe;

  // GLOBAL environment apply. The backdrop (changeBGColor + changeBGMaterial)
  // AND the key light (changeLightAngle + changeLightColor) are persistent-level
  // actors, not character-owned, so they're set once globally and re-asserted on
  // every switch (via the characterReady listener) + immediately whenever the
  // user changes them — the room + grade stay put across agents. Light fields
  // are emitted only when the user has actually configured them, so an unset
  // environment leaves UE's authored studio light alone (same guard the dress
  // chain used to use).
  // Last bgmode (backdrop material) UE was told, so applyEnvironment can skip
  // re-sending an unchanged material (which would reset the backdrop color).
  // Reset to undefined on disconnect so a reconnect re-asserts it once.
  const lastAppliedBgmodeRef = useRef<number | null | undefined>(undefined);
  const applyEnvironment = useCallback((opts?: { forceMaterial?: boolean }) => {
    if (!pixelStreaming) return;
    const e = environment;
    // Backdrop. ORDER MATTERS: changeBGMaterial swaps/re-instantiates the
    // backdrop material, which resets its color parameter to the material's
    // default (a frame later, even if we set the color right after) — so the
    // material MUST be applied BEFORE the color, or it wipes the color we just
    // set (the "bg color reverts on save" bug: applyEnvironment ran the color
    // then the material, and the material reset it).
    //
    // On a normal color-only re-apply we SKIP the material (send it only when
    // bgmode actually changed) precisely so it can't wipe the color. But on a
    // SESSION RESET, UE has dropped the backdrop back to its engine default, so
    // the material genuinely must be re-asserted first — callers on that path
    // pass forceMaterial. The order (material → color) is identical either way;
    // forceMaterial only decides WHETHER the material is re-sent, never after.
    const force = opts?.forceMaterial === true;
    let materialEmitted = false;
    if (e.bgmode != null && (force || e.bgmode !== lastAppliedBgmodeRef.current)) {
      pixelStreaming.emitUIInteraction({
        EventType: 'changeBGMaterial',
        bgmode: e.bgmode,
        Timestamp: new Date().toISOString(),
      });
      lastAppliedBgmodeRef.current = e.bgmode;
      materialEmitted = true;
    }
    const bgRgb = e.bgColorHex
      ? hexToRgb01(e.bgColorHex)
      : (BG_COLORS[e.bgColorIndex ?? 0] ?? BG_COLORS[0]);
    const ps = pixelStreaming;
    const emitColor = () => ps.emitUIInteraction({
      EventType: 'changeBGColor',
      'bgcolor.r': round3(bgRgb.r),
      'bgcolor.g': round3(bgRgb.g),
      'bgcolor.b': round3(bgRgb.b),
      value: round3(e.bgGlow ?? BG_GLOW_DEFAULT),
      Timestamp: new Date().toISOString(),
    });
    emitColor();
    // changeBGMaterial re-instantiates the backdrop material and resets its
    // color a FRAME LATER (async) — so the color we send right after gets wiped
    // by that late reset. This is why the saved color lands on SAVE (where the
    // material isn't re-sent, bgmode unchanged) but reverts on LOAD / reconnect
    // (where it is). When the material was (re)emitted, re-assert the color a
    // couple of beats later so it survives the material's async reset.
    if (materialEmitted) {
      window.setTimeout(emitColor, 200);
      window.setTimeout(emitColor, 600);
    }
    // Key light.
    if (e.lightingAngle != null) {
      pixelStreaming.emitUIInteraction({
        EventType: 'changeLightAngle',
        lightAngle: String(e.lightingAngle),
        Timestamp: new Date().toISOString(),
      });
    }
    if (e.accentColorHex != null || e.accentColorIndex != null || e.lightIntensity != null) {
      const lc = e.accentColorHex
        ? hexToRgb01(e.accentColorHex)
        : (ACCENT_COLORS[e.accentColorIndex ?? 0] ?? ACCENT_COLORS[0]);
      pixelStreaming.emitUIInteraction({
        EventType: 'changeLightColor',
        'lightColor.r': round3(lc.r),
        'lightColor.g': round3(lc.g),
        'lightColor.b': round3(lc.b),
        lightIntensity: round3(e.lightIntensity ?? LIGHT_INTENSITY_DEFAULT),
        Timestamp: new Date().toISOString(),
      });
    }
  }, [pixelStreaming, environment]);
  const applyEnvironmentRef = useRef(applyEnvironment);
  applyEnvironmentRef.current = applyEnvironment;
  // Set by the reconcile driver when it initiates a fresh spawn (cold boot /
  // reset / reconnect), so the NEXT characterReady re-asserts the global
  // environment. A plain user character switch does NOT set it — the backdrop
  // + light are persistent-level actors that survive a swap, so re-sending
  // them on every switch would be pure redundancy.
  const reapplyEnvOnNextReadyRef = useRef(false);
  // Re-apply the moment any environment setting changes (and once the stream is up).
  useEffect(() => {
    if (pixelStreaming) applyEnvironment();
  }, [environment, pixelStreaming, applyEnvironment]);

  // ===== Camera ==========================================================
  // We drive the camera explicitly (updateCameraFromLocation) instead of
  // letting it move as a side-effect of wardrobeModeOn/Off. The desired framing
  // is a function of (which character, are we customizing, the chosen mode):
  // each character has its own resting height. Customization always pulls back
  // to show the whole figure; otherwise the user's toggle (default / waist /
  // full) picks the shot. locB.x/y/z go on the wire as NUMBERS (UE reads them
  // with Get Number Field). Optionally pass an explicit agentId (e.g. from
  // characterReady, before activeAgentId state has caught up to the new spawn).
  const [cameraMode, setCameraMode] = useState<CameraMode>('default');
  // While customizing, face-region panes (hair / eyebrow / eyelash) want the
  // close resting shot instead of the full-figure pull-back, so the user can
  // actually see the grooms they're editing. CustomWardrobe reports this per
  // pane via onCloseUpChange. Defaults true because customization always opens
  // on the hair pane.
  const [customizeCloseUp, setCustomizeCloseUp] = useState(true);
  const applyCamera = useCallback((agentIdOverride?: string | null) => {
    if (!pixelStreaming) return;
    const aid = agentIdOverride ?? activeAgentId;
    const [x, y, z] = customizationActive
      ? (customizeCloseUp ? cameraDefaultFor(aid) : cameraCustomize(aid))
      : cameraForMode(aid, cameraMode);
    pixelStreaming.emitUIInteraction({
      EventType: 'updateCameraFromLocation',
      'locB.x': round3(x),
      'locB.y': round3(y),
      'locB.z': round3(z),
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming, activeAgentId, customizationActive, customizeCloseUp, cameraMode]);
  const applyCameraRef = useRef(applyCamera);
  applyCameraRef.current = applyCamera;
  // Re-frame whenever the active character, the customize mode, or the chosen
  // camera mode changes (and once the stream is up). characterReady also nudges
  // this (below) so a fresh cold-boot spawn — which the connect-time emit races
  // ahead of — still lands.
  useEffect(() => {
    if (pixelStreaming) applyCamera();
  }, [activeAgentId, customizationActive, cameraMode, pixelStreaming, applyCamera]);


  // Mood-accent bleed. The GLOBAL key-light color the user picks
  // also seeps into the UI via two CSS vars (`--mood-accent`
  // for solid spots, `--mood-tint-faint` for the hairline-top gradient).
  // Very subtle: only the chrome edges and a single decorative period
  // in the Greeting pick this up. The system `--accent` (focus, save,
  // error) stays ember red regardless so meaning never shifts with mood.
  // Fires whenever the global light color changes; falls back to the
  // ember-red default if no light is configured.
  useEffect(() => {
    const c = environment.accentColorHex
      ? { hex: environment.accentColorHex, ...hexToRgb01(environment.accentColorHex) }
      : (ACCENT_COLORS[environment.accentColorIndex ?? 0] ?? ACCENT_COLORS[0]);
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    const root = document.documentElement.style;
    root.setProperty('--mood-accent', c.hex);
    // Low-alpha tint used by the hairline-top utility class. Sits at
    // ~22% so it reads as "ambient light catching the lip of the glass"
    // rather than as a colored decoration. Mixed with a small white
    // bias so very dark chosen lights (none in the current palette,
    // but defensive for future palette additions) still register as
    // a highlight rather than disappearing.
    root.setProperty('--mood-tint-faint',
      `rgba(${r}, ${g}, ${b}, 0.22)`);
    root.setProperty('--mood-tint-soft',
      `rgba(${r}, ${g}, ${b}, 0.14)`);
  }, [environment.accentColorHex, environment.accentColorIndex]);

  // Live mirrors so the characterReady listener (subscribed once per stream)
  // reads the current roster + the instance we're switching INTO without
  // re-subscribing on every change. `wardrobeTargetRef` follows the selected
  // real instance; it's already settled by the time UE's post-swap signal
  // lands (the swap round-trip is far slower than React's commit).
  const agentStackRef = useRef(agentStack);
  agentStackRef.current = agentStack;
  const wardrobeTargetRef = useRef<string>(BASE_INSTANCE_ID);
  useEffect(() => {
    if (selectedInstanceId !== ADD_SLOT) wardrobeTargetRef.current = selectedInstanceId;
  }, [selectedInstanceId]);

  // SWAPS: UE emits `{EventType:"characterReady", agentId}` the instant a
  // swapped-in character finishes spawning (OnCharacterChanged). That's our cue
  // to dress it — apply the target instance's saved outfit so it arrives already
  // wearing the right clothes + colors. No-op when the instance was never
  // customized (keeps the character's authored defaults).
  // Flips once the connection is resolved — either UE answered our connect-time
  // fetchCurrentAgent query, or a swap's characterReady arrived. Gates the
  // connect retry below; re-armed on disconnect.
  const initialResolvedRef = useRef(false);

  // The character UE currently has on-screen (agentId, lowercased), as confirmed
  // by `characterReady` or the connect-time reconcile. null until UE answers.
  // The onboarding wizard waits until this is the base agent (Grace) before
  // firing its first pre-recorded line, so the welcome audio never plays into the
  // black/transitioning stage before Grace exists — and because we re-resolve on
  // every (re)connect, a refresh mid-onboarding replays the line. Reset on
  // disconnect so a reconnect re-gates.
  const [ueActiveAgentId, setUeActiveAgentId] = useState<string | null>(null);

  // SWAPS: UE emits characterReady when a swapped-in character spawns; dress it
  // with the target instance's saved outfit. No-op when never customized.
  useEffect(() => {
    if (!pixelStreaming) return;
    const onResponse = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { EventType?: unknown; agentId?: unknown };
      if (msg.EventType !== 'characterReady') return;
      initialResolvedRef.current = true;
      const inst = agentStackRef.current.find((i) => i.id === wardrobeTargetRef.current);
      // Record which character UE actually spawned. Fall back to the instance we
      // switched into when the signal omits agentId.
      const spawned =
        (typeof msg.agentId === 'string' && msg.agentId)
          ? msg.agentId.toLowerCase()
          : (inst?.agentId?.toLowerCase() ?? null);
      // Swap succeeded: clear the agentSwitchFailed retry + dispatch state.
      lastSwitchTargetRef.current = null;
      switchRetryRef.current = 0;
      switchDispatchedRef.current = null;
      ueActiveAgentRef.current = spawned;
      setUeActiveAgentId(spawned);
      // Re-frame the camera for the character that just spawned. Every switch
      // lands here (each character is a different height), and passing `spawned`
      // explicitly avoids racing the activeAgentId state update. Fires on cold
      // boot too (this is the reliable point after UE is actually ready).
      applyCameraRef.current?.(spawned);
      // Re-assert the GLOBAL environment (backdrop + key light) ONLY when this
      // spawn is part of a session (re)establishment (cold boot / reset /
      // reconnect) — where UE came up at its default. A user-initiated
      // character switch keeps the persistent backdrop, so we don't re-send it.
      if (reapplyEnvOnNextReadyRef.current) {
        reapplyEnvOnNextReadyRef.current = false;
        // Session (re)establishment: UE reset the backdrop to its default, so
        // force the material to re-assert BEFORE the color (material → color).
        applyEnvironmentRef.current?.({ forceMaterial: true });
      }
      // Stale/racing-signal guard: only dress when the character UE actually
      // spawned (msg.agentId) matches the instance we're targeting.
      if (inst && typeof msg.agentId === 'string' && msg.agentId && inst.agentId !== msg.agentId) {
        return;
      }
      // If this ready signal completes the swap we initiated, the scene half
      // (light + backdrop) already fired at switch time: finish with the
      // outfit half under the SAME epoch. Any other arrival (a swap driven
      // from outside switchUeToAgent, a stale pending entry) dresses in full
      // under a fresh epoch.
      const pending = pendingSwitchRef.current;
      const continuesSwitch =
        pending != null &&
        inst != null &&
        pending.agentId === inst.agentId.toLowerCase() &&
        dressEpochRef.current === pending.epoch;
      if (continuesSwitch) pendingSwitchRef.current = null;
      // Dress the per-character OUTFIT (clothing/colors/blends) now that the body
      // exists. Light + backdrop are GLOBAL and were re-asserted by
      // applyEnvironmentRef above, so they're not part of this per-instance
      // chain. A continued switch reuses its epoch; any other arrival (a swap
      // driven from outside switchUeToAgent, or a stale pending entry) dresses
      // under a fresh epoch.
      void applyInstanceWardrobe(
        inst?.wardrobe, inst?.agentId,
        continuesSwitch ? { scope: 'outfit', epoch: pending.epoch } : undefined,
      );
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-character-ready', onResponse);
    return () => ps.removeResponseEventListener?.('unclaw-character-ready');
  }, [pixelStreaming, applyInstanceWardrobe]);

  // PER-SLOT CLOTHING COLOUR. The merged agentSwitch carries the wardrobe
  // INDICES; UE async-loads each garment mesh and reports updateTopSuccess /
  // updateBottomSuccess / updateShoesSuccess once that mesh lands. A garment's
  // colour (a dynamic material instance) can only take AFTER its mesh exists, so
  // we send changeClothingColor off these signals — the moment each slot is
  // ready, coloured from the selected instance's saved pair. No-op when the slot
  // has no saved colour (keeps the mesh default). hair/eyelash/eyebrow are
  // grooms with no clothing colour. Live edits during customization colour
  // directly (the character is already on-screen), so they don't need this.
  useEffect(() => {
    if (!pixelStreaming) return;
    const CAT_FOR: Record<string, 'top' | 'bottom' | 'shoes'> = {
      updateTopSuccess: 'top', updateBottomSuccess: 'bottom', updateShoesSuccess: 'shoes',
    };
    const onUpdate = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      const et = (parsed as { EventType?: unknown })?.EventType;
      if (typeof et !== 'string') return;
      const cat = CAT_FOR[et];
      if (!cat) return;
      const inst = agentStackRef.current.find((i) => i.id === wardrobeTargetRef.current);
      const pair = inst?.wardrobe?.clothingColors?.[cat];
      if (!pair) return; // no saved colour for this slot -> leave the mesh default
      const c1 = pair.c1Hex ? hexToRgb01(pair.c1Hex) : (CLOTHING_COLORS[pair.c1] ?? CLOTHING_COLORS[0]);
      const c2 = pair.c2Hex ? hexToRgb01(pair.c2Hex) : (CLOTHING_COLORS[pair.c2] ?? CLOTHING_COLORS[0]);
      pixelStreaming.emitUIInteraction({
        EventType: 'changeClothingColor',
        wardrobeCategory: cat,
        'color1.r': c1.r.toFixed(3), 'color1.g': c1.g.toFixed(3), 'color1.b': c1.b.toFixed(3),
        'color2.r': c2.r.toFixed(3), 'color2.g': c2.g.toFixed(3), 'color2.b': c2.b.toFixed(3),
        Timestamp: new Date().toISOString(),
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-update-success', onUpdate);
    return () => ps.removeResponseEventListener?.('unclaw-update-success');
  }, [pixelStreaming]);

  // SWAP FAILURE: the UE subsystem now broadcasts `agentSwitchFailed` when a
  // swap's cast fails or resolves to blank (previously it stalled silently and
  // the frontend waited forever on a characterReady that never came). Replay
  // the last requested switch — the C++ generation counter dedupes duplicate
  // in-flight loads, so a replay is safe — up to a bounded number of times,
  // then fall back to the reconcile driver so the UI always converges on
  // whatever UE actually settled on.
  useEffect(() => {
    if (!pixelStreaming) return;
    const onFailed = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      if ((parsed as { EventType?: unknown }).EventType !== 'agentSwitchFailed') return;
      // On the Add picker the stage is intentionally blank; UE rejecting the
      // 'blank' agentSwitch is EXPECTED. Don't retry or reconcile — that would
      // drag the last agent back onto the hidden stage. Cancel handles restore.
      if (onAddSlotRef.current) return;
      // A same-id blank interstitial (grace → blank → grace) is mid-flight; the
      // 'blank' rejection is expected and the scheduled respawn will bring the
      // character back. Don't retry/reconcile off it.
      if (sameIdBlankRef.current != null) return;
      const target = lastSwitchTargetRef.current;
      // If UE confirmed this swap DISPATCHED (agentSwitchSuccess) and it still
      // failed, the id was valid but the incoming class isn't a BP_CharacterBase
      // / resolved blank: replaying the identical id would just dispatch-then-
      // fail again. Reconcile to UE's truth instead of retrying.
      const dispatched = switchDispatchedRef.current;
      switchDispatchedRef.current = null;
      const dispatchFailed =
        dispatched != null &&
        target != null &&
        dispatched === target.agentId.toLowerCase();
      if (!target || dispatchFailed || switchRetryRef.current >= SWITCH_MAX_RETRIES) {
        // Nothing safe to replay, dispatch-then-cast-failed, or out of retries:
        // reconcile to whatever UE actually settled on.
        lastSwitchTargetRef.current = null;
        switchRetryRef.current = 0;
        setUeSessionEpoch((e) => e + 1);
        return;
      }
      switchRetryRef.current += 1;
      // Small backoff so a replay doesn't land inside the same load window.
      setTimeout(() => {
        switchUeToAgentRef.current?.(target.agentId, target.dir, target.wardrobe);
      }, 400);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-agent-switch-failed', onFailed);
    return () => ps.removeResponseEventListener?.('unclaw-agent-switch-failed');
  }, [pixelStreaming]);

  // SWAP DISPATCHED: UE emits `agentSwitchSuccess` right after the `Swap to
  // Character` node runs in the `agentSwitch` event — the swap left the gate
  // with a valid, latched id. This is the early positive signal (characterReady
  // still follows once the body spawns + binds). We record the dispatched id so
  // a subsequent agentSwitchFailed is treated as a genuine cast failure (don't
  // replay the same id) rather than a never-dispatched swap, and reset the retry
  // counter since the swap is genuinely progressing.
  useEffect(() => {
    if (!pixelStreaming) return;
    const onDispatched = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      if ((parsed as { EventType?: unknown }).EventType !== 'agentSwitchSuccess') return;
      switchDispatchedRef.current = lastSwitchTargetRef.current?.agentId.toLowerCase() ?? null;
      switchRetryRef.current = 0;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-agent-switch-success', onDispatched);
    return () => ps.removeResponseEventListener?.('unclaw-agent-switch-success');
  }, [pixelStreaming]);

  // RECONCILE on connect: UE answers our fetchCurrentAgent query with the
  // character it's currently showing (same shape as characterReady). Decide:
  //   - blank / a DIFFERENT character -> agentSwitch(target); its characterReady
  //       dresses it (first-load + cross-character reloads ride this path).
  //   - ALREADY the target character  -> do NOT switch (this is the fix: a
  //       frontend reload while UE is already on that character would otherwise
  //       loop switching to itself). Instead re-init this instance's clothes +
  //       colors directly, since UE may be wearing another Grace instance's
  //       outfit / engine defaults.
  useEffect(() => {
    if (!pixelStreaming) return;
    const onResponse = (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { EventType?: unknown; agentId?: unknown };
      if (msg.EventType !== 'fetchCurrentAgent') return;
      // A late reply that lands while the Add picker is open must not drive a
      // character onto the intentionally-blank stage.
      if (onAddSlotRef.current) return;
      if (initialResolvedRef.current) return; // only the connect-time query acts
      initialResolvedRef.current = true;
      const inst = agentStackRef.current.find((i) => i.id === wardrobeTargetRef.current)
        ?? agentStackRef.current[0];
      if (!inst) return;
      // UE sends an FName ToString; normalize casing on both sides so the
      // already-on-target check can't miss on a casing drift.
      const ueAgent = (typeof msg.agentId === 'string' ? msg.agentId : '').toLowerCase();
      const onBlank = !ueAgent || ueAgent === 'none' || ueAgent === 'blank';
      if (!onBlank && ueAgent === inst.agentId.toLowerCase()) {
        // UE is already showing this character — don't re-switch (would loop on
        // reload). Just re-apply THIS instance's outfit, since UE may be wearing
        // another instance's look or the engine defaults.
        const live = ueAgent || inst.agentId.toLowerCase();
        ueActiveAgentRef.current = live;  // already on-screen; no characterReady will fire
        setUeActiveAgentId(live);
        void applyInstanceWardrobe(inst.wardrobe, inst.agentId);
        // Re-assert the GLOBAL environment (backdrop color + key light) too.
        // No characterReady fires on this path, so without this the saved
        // backdrop color silently reverts to UE's default on any reconcile
        // that lands on an already-live character (warm reconnect, soul
        // restart, reset) — read as "the bg color doesn't save". This is a
        // reset path (UE dropped the backdrop to default), so force the
        // material to re-assert BEFORE the color (material → color).
        applyEnvironmentRef.current?.({ forceMaterial: true });
        // Same reasoning for the camera: no characterReady fires here, so
        // re-frame for the already-live character (warm reconnect / reset).
        applyCameraRef.current?.(live);
      } else {
        // Blank or a different character: switch through the same path the
        // carousel uses, so the scene half (light + backdrop) applies while
        // the character loads and characterReady finishes the outfit. This is
        // a session-(re)establishment spawn (cold boot / reset / reconnect),
        // so flag the resulting characterReady to re-assert the environment.
        reapplyEnvOnNextReadyRef.current = true;
        switchUeToAgent(inst.agentId, 1, inst.wardrobe);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps = pixelStreaming as any;
    ps.addResponseEventListener?.('unclaw-fetch-current-agent', onResponse);
    return () => ps.removeResponseEventListener?.('unclaw-fetch-current-agent');
  }, [pixelStreaming, applyInstanceWardrobe, switchUeToAgent]);

  // Connect-time driver: ask UE which character it's on, and KEEP asking until
  // it answers. On a cold launch the stream connects several seconds before UE's
  // character subsystem is ready to answer descriptors, so the early queries go
  // unanswered — we must poll through the whole boot, not give up after a few
  // tries (that left the user stranded on the blank stage until a manual switch).
  // The reconcile listener above flips initialResolvedRef + acts on the reply.
  // Re-armed on disconnect so a reconnect re-reconciles.
  useEffect(() => {
    if (connectionState !== 'connected') {
      initialResolvedRef.current = false;
      // Stream gone: whatever dressing chain / idle-revert was in flight
      // belongs to a session that no longer exists.
      dressEpochRef.current += 1;
      cancelScheduledIdleRevert();
      ueActiveAgentRef.current = null;
      setUeActiveAgentId(null);
      // Fresh session will need the backdrop material re-asserted.
      lastAppliedBgmodeRef.current = undefined;
      return;
    }
    // On the Add picker the stage is intentionally blank. Don't drive a
    // character in (a reconnect here should stay blank behind the picker);
    // Cancel leaves ADD_SLOT first, which re-bumps the epoch and re-runs this
    // driver with a real target.
    if (onAddSlotRef.current) return;
    // Re-arm on every (re)connect AND every ueSessionEpoch bump (reset
    // session / reset account). A reset drops UE back to the blank stage
    // without dropping the stream, so we must clear the resolved flag and
    // re-drive from scratch, exactly like a fresh connect.
    initialResolvedRef.current = false;
    dressEpochRef.current += 1;
    cancelScheduledIdleRevert();
    ueActiveAgentRef.current = null;
    setUeActiveAgentId(null);
    // A reset/reconnect clears UE's backdrop material back to default, so the
    // material must be re-asserted by the next applyEnvironment. Clear the
    // skip-cache (otherwise applyEnvironment thinks UE still has it and the
    // backdrop stays default after a reset).
    lastAppliedBgmodeRef.current = undefined;
    let attempts = 0;
    const ask = () => {
      if (initialResolvedRef.current) return;
      attempts += 1;
      pixelStreaming?.emitUIInteraction({ EventType: 'fetchCurrentAgent' });
    };
    ask(); // fire immediately on connect / reset
    const MAX = 90; // poll ~90s — well past UE's cold-boot window — before bailing
    const id = setInterval(() => {
      if (initialResolvedRef.current || attempts >= MAX) { clearInterval(id); return; }
      ask();
    }, 1000);
    return () => clearInterval(id);
  }, [connectionState, pixelStreaming, ueSessionEpoch]);

  // Soft session reset, tells Unreal to drop back to neutral pose +
  // clear any in-progress speech, then immediately re-applies the
  // user's saved wardrobe so the character returns to THEIR look,
  // not the engine default. Doesn't touch auth, profile, keys, or
  // chat memory.
  const handleResetSession = useCallback(() => {
    if (!pixelStreaming) return;
    pixelStreaming.emitUIInteraction({
      EventType: 'reset',
      Timestamp: new Date().toISOString(),
    });
    // UE drops back to the blank stage on reset. Re-run the connect-time
    // reconcile driver so the frontend re-drives the character onto the
    // fresh session and dresses it from its saved wardrobe, just like a
    // cold connect. Bump on a short delay so UE has processed the reset
    // before we query its current character (avoids reconciling against
    // the pre-reset state).
    setTimeout(() => setUeSessionEpoch((e) => e + 1), 150);
  }, [pixelStreaming]);

  // Fetch the user profile, but only once the stream is connected.
  // Null -> open the onboarding wizard in firstRun mode. Any non-null
  // profile lets us silently skip onboarding and feed the saved name
  // into the greeting / system prompts. Server-side rendering of the
  // profile into chat prompts happens automatically in soul, so we
  // don't have to thread profile values into the systemExtension here.
  const profileSyncedRef = useRef(false);
  useEffect(() => {
    // Profile sync runs once we have BOTH a connected stream AND a signed-in
    // account. Reconcile the ACCOUNT'S cloud profile against the machine's
    // local state, scoping local data to the account so a new login can't
    // inherit a previous account's (or guest's) profile/keys.
    if (connectionState !== 'connected') return;
    if (!authToken || !authUser) return;
    if (profileSyncedRef.current) return;
    profileSyncedRef.current = true;

    const accountId = authUser.id;
    let cancelled = false;
    void (async () => {
      try {
        // Prefer the durable main-process marker (survives a localStorage wipe
        // that would otherwise look like an owner change and nuke the user's
        // BYOK keys); fall back to the legacy localStorage marker so existing
        // installs migrate cleanly on their first post-update sign-in.
        const localOwner = await (async () => {
          try {
            const durable = await window.electronAPI?.getLocalOwner?.();
            if (durable) return durable;
          } catch { /* fall through to localStorage */ }
          try { return localStorage.getItem(LOCAL_ACCOUNT_KEY); } catch { return null; }
        })();
        const { profile: p, ownerChanged, cloudUnavailable } = await reconcileForAccount(accountId, authToken, localOwner);
        if (cancelled) return;
        // Cloud couldn't be read (expired token / network / Cloudflare edge).
        // `p` is the local read-cache shown for continuity, but we must change
        // NOTHING in the cloud and treat NOTHING local as authoritative — that
        // promotion is the bug that clobbers the real cloud profile with stale
        // local. Let it retry on the next connect/sign-in cycle.
        if (cloudUnavailable) {
          if (p?.roster && Array.isArray(p.roster) && p.roster.length > 0) {
            suppressRosterPushRef.current = true;
            hydrateStack(p.roster);
          }
          setProfile(p && p.name ? { ...p, name: firstName(p.name) } : p);
          profileSyncedRef.current = false; // allow a retry once cloud is reachable
          return;
        }

        if (ownerChanged) {
          // The machine is changing hands to this account (different prior
          // account, a guest session, or a fresh device). The previous owner's
          // API keys + local chat history are machine-local secrets that must
          // not leak — clear them. API keys are never synced, so this account
          // has no keys on this machine yet; nudge the user to enter them
          // UNLESS the wizard is about to open (p === null), which collects
          // keys itself. (UE's live config is wiped on the way OUT — sign-out /
          // reset — not here, so a fresh login doesn't flash a reset.)
          let hadKeys = false;
          try { hadKeys = !!(await window.electronAPI?.apiKeysGet?.()); } catch { /* ignore */ }
          try { await window.electronAPI?.apiKeysClear?.(); } catch { /* ignore */ }
          clearLocalChatHistory();
          setSelectedInstanceId(BASE_INSTANCE_ID);
          if (hadKeys || p !== null) setApiKeysNotice(true);
        }

        // Restore the roster to match the signed-in account. The roster now
        // lives in the cloud blob (everything but API keys follows the
        // account), so cloud wins: hydrate it when present. Otherwise, if the
        // machine just changed hands, wipe the prior owner's roster back to
        // base Grace. Either way, suppress the resulting change from echoing
        // straight back up — we just read it from the cloud.
        if (p?.roster && Array.isArray(p.roster) && p.roster.length > 0) {
          suppressRosterPushRef.current = true;
          hydrateStack(p.roster);
        } else if (ownerChanged) {
          suppressRosterPushRef.current = true;
          resetStack();
        }

        // Record ownership in BOTH the durable main-process store (authoritative)
        // and localStorage (legacy mirror) so the marker can't desync from the
        // keys it guards.
        try { await window.electronAPI?.setLocalOwner?.(accountId); } catch { /* ignore */ }
        try { localStorage.setItem(LOCAL_ACCOUNT_KEY, accountId); } catch { /* ignore */ }

        // Seed the cloud with this account's local roster when the cloud
        // profile predates roster-sync (an account onboarded before the roster
        // was folded into the blob). Best-effort, version-less; cheap no-op
        // for fresh accounts (just base Grace).
        if (p && !p.roster && authToken) {
          void saveSettingsEverywhere({ ...p, roster: stackRef.current }, authToken);
        }

        // Restore chat history for the signed-in account (cloud wins, like the
        // roster). On owner change the prior owner's local chat was already
        // wiped above; either way bump the reload nonce so the mounted
        // conversation re-reads localStorage, and suppress the resulting change
        // from echoing back up to the cloud.
        const cloudChat = await fetchCloudChat(authToken);
        if (cancelled) return;
        if (cloudChat && Object.keys(cloudChat).length > 0) {
          suppressChatPushRef.current = true;
          restoreLocalChat(cloudChat);
          setChatReloadNonce((n) => n + 1);
        } else if (ownerChanged) {
          suppressChatPushRef.current = true;
          setChatReloadNonce((n) => n + 1);
        }

        // Just record the resolved profile; the onboarding-visibility effect
        // below decides whether to open/close the wizard. Normalize the
        // user's name to first name only (Gmail sign-in hands us the full
        // name) so the greeting + Grace's voice (via synced profile) address
        // them by first name everywhere.
        setProfile(p && p.name ? { ...p, name: firstName(p.name) } : p);
      } catch (err) {
        if (cancelled) return;
        console.warn('[profile] reconcile failed', err);
        setProfile(null); // fail-soft → onboarding effect opens the wizard
      }
    })();
    return () => { cancelled = true; };
  }, [connectionState, authToken, authUser, resetStack, hydrateStack]);

  // Onboarding visibility. Login now lives INSIDE the wizard, so the wizard
  // opens whenever the user isn't fully set up — not signed in OR signed in
  // without a profile — and closes once they are. Manual 'edit' opens (pencil
  // / /onboard) are left untouched. This replaces the old SignInScreen gate.
  useEffect(() => {
    if (authToken === undefined) return;            // auth still resolving
    if (!authToken) {
      // Not signed in → first-run wizard (welcome + login steps).
      setWizardMode((m) => (m === null ? 'first' : m));
      return;
    }
    if (profile === undefined) return;              // reconcile still resolving
    if (profile === null) {
      setWizardMode((m) => (m === null ? 'first' : m));
    } else {
      // Fully set up → close the first-run wizard (don't disturb 'edit').
      setWizardMode((m) => (m === 'first' ? null : m));
    }
  }, [authToken, profile]);

  // A signed-in session unlocks the post-login UI (chat dock, chat pane,
  // widgets). Onboarding (incl. login) runs over the stream before this.
  const hasSession = !!authToken;
  // Onboarding is "done" once a profile is saved (and we're not sitting in the
  // blocking first-run wizard). The ambient widgets stay disabled until then —
  // they're useless without the user's profile (timezone, city, interests) and
  // shouldn't distract during first-run setup. Reopening onboarding to edit
  // keeps them enabled (profile already exists).
  const onboardingComplete = !!profile && wizardMode !== 'first';

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

  // Toggle a sheet open/closed. The wardrobe rail icon is special , 
  // it doesn't open a sheet; it flips the full-screen customization
  // mode on, which hides the rest of the UI. Every other key uses
  // the normal sheet flow.
  const handleToggleWidget = useCallback((key: SheetKey) => {
    // Widgets (ambient panels + wardrobe) are locked until onboarding is done,
    // so slash commands / keyboard / the rail can't open them early.
    if (!onboardingComplete) return;
    if (key === 'wardrobe') {
      // Force the chat pane closed so the customization overlay
      // spans the whole workspace, not the pre-shrunk window.
      setActiveWidget(null);
      setChatPaneOpen(false);
      // Opens on the hair pane, which is a close-up pane; reset so entry frames
      // close instead of inheriting the last session's pane framing for a frame.
      setCustomizeCloseUp(true);
      setCustomizationActive(prev => !prev);
      return;
    }
    setActiveWidget(prev => (prev === key ? null : key));
  }, [onboardingComplete]);

  const handleCloseSheet = useCallback(() => setActiveWidget(null), []);
  // Cancel is try-on behavior: everything reverts. Dropping the preview falls
  // the effect back to whatever the instance last saved.
  const handleExitCustomization = useCallback(() => {
    setCustomizationActive(false);
    setEffectPreview(null);
  }, []);

  const isConnected = connectionState === 'connected';

  // Passthrough bridge. While in passthrough mode + connected, subscribe
  // to soul's /passthrough/ws and render every pushed speak through the
  // no-LLM /speak endpoint (with THIS renderer's onboarding voice + BYOK
  // keys), dispatching each finished job to UE exactly like a chat turn.
  // Re-dials on a soul respawn (subscribeSoulPorts bumps portEpoch, which
  // is folded into connectionState upstream, so the effect re-runs on
  // reconnect). persona.voices is read per-speak inside the bridge so an
  // agent switch mid-session voices the new character.
  const personaVoicesRef = useRef(persona.voices);
  personaVoicesRef.current = persona.voices;
  // Refs so live talkativeness/mute changes take effect without restarting
  // the bridge (which would drop + redial the WS).
  const passthroughPrefsRef = useRef(passthroughPrefs);
  passthroughPrefsRef.current = passthroughPrefs;
  // Ready = signed in (authToken) AND onboarded (profile). The shim gates on
  // this so the agent isn't told "spoken" while the app is on the sign-in /
  // setup screen (where /speak can't render , no keys). Reported over the WS.
  const passthroughReady = !!authToken && !!profile;
  const passthroughBridgeRef = useRef<{ stop: () => void; reportReady: (r: boolean) => void } | null>(null);
  useEffect(() => {
    if (!passthrough || !isConnected || !pixelStreaming) return undefined;
    const bridge = startPassthroughBridge({
      onRendered: (result) => { dispatchChatResult(result); },
      getVoices: () => personaVoicesRef.current,
      getPrefs: () => passthroughPrefsRef.current,
      getReady: () => (!!authTokenRef.current && !!profileRef.current),
    });
    passthroughBridgeRef.current = bridge;
    return () => { bridge.stop(); passthroughBridgeRef.current = null; };
  }, [passthrough, isConnected, pixelStreaming, dispatchChatResult]);
  // Re-report readiness if the user signs in / finishes onboarding while a
  // passthrough session is already open (bridge stays connected).
  useEffect(() => {
    passthroughBridgeRef.current?.reportReady(passthroughReady);
  }, [passthroughReady]);

  // Body-idle resync. A renderer refresh/crash tears down the stream
  // session and the fresh one starts on the default body-idle loop,
  // while soul still holds the real rotation state ("we lose the
  // context of where we were"). On every (re)connect, ask soul where
  // the rotation is and re-dispatch it. GET /body/idle never advances
  // the rotation, so reconnect storms are harmless.
  useEffect(() => {
    if (!isConnected || !pixelStreaming) return undefined;
    let cancelled = false;
    void (async () => {
      const body = await fetchCurrentBodyIdle();
      if (!cancelled && body) {
        dispatchBodyToUE(pixelStreaming, body);
      }
    })();
    return () => { cancelled = true; };
  }, [isConnected, pixelStreaming]);

  // Idle micro-expression driver. Fires POST /idle on a jittered
  // timer (~30-50s mean) to keep Grace alive when the user isn't
  // talking. UnClaw is the canonical idle driver, soul refuses /idle
  // without an explicit llm_model in the body, which `fireIdle` pulls
  // from the user's apiKeys (the SAME model + key chat uses).
  //
  // Gates (matching soul's own short-circuits + a couple renderer-side
  // gates that soul can't observe):
  //   * stream not connected        , pointless, no UE to render to
  //   * isSending                   , chat in flight
  //   * isAISpeakingRef             , Grace is still mid-reply
  //   * voice listening             , user is talking; idle would
  //                                     compete for audio focus
  //   * wizardMode                  , onboarding overlay is up
  //
  // Soul itself also refuses to fire when no /ws clients are
  // connected, when a chat is in flight, when audio is still playing
  // (`_speaking_until_ts`), or when escalation is running, so any
  // race we miss client-side gets caught server-side too.
  useEffect(() => {
    if (!isConnected) return undefined;
    if (wizardMode) return undefined;
    let cancelled = false;
    let timerId: number | null = null;
    // Re-checks soul's /settings every tick. The portal's slider /
    // pause button mutate that registry, and this is how UnClaw obeys
    // them without a separate poll loop. Lag is bounded by the current
    // tick interval (worst case ~one period after a change).
    const PAUSE_REPOLL_MS = 8_000;        // recheck while paused/disabled
    const DEFAULT_PERIOD_S = 37;          // mirror of soul's default
    const tick = async () => {
      if (cancelled) return;
      // Pull idle config from soul each tick. Network failures fall
      // back to the default period so a flaky soul doesn't freeze idle.
      let periodS = DEFAULT_PERIOD_S;
      let paused = false;
      try {
        const r = await fetch(`${getSoulBaseUrl()}/settings`);
        if (r.ok) {
          const s = await r.json();
          if (typeof s.idle_period_s === 'number') periodS = s.idle_period_s;
          if (typeof s.idle_paused === 'boolean')  paused = s.idle_paused;
        }
      } catch { /* soft-fail to defaults */ }
      const enabled = !paused && periodS > 0;
      const ok = enabled
        && !isSending
        && !isAISpeakingRef.current
        && !voice.isListening
        && !escalating;
      if (ok) {
        try {
          const idleRes = await fireIdle();
          // Body idle rotation rides the idle response (captured mode).
          if (idleRes?.body && pixelStreaming) {
            dispatchBodyToUE(pixelStreaming, idleRes.body);
          }
        } catch { /* fireIdle soft-fails */ }
      }
      if (cancelled) return;
      // When idle is disabled (paused or period=0) we still cycle, on a
      // shorter cadence, so a "resume" on the portal propagates fast.
      // When enabled, jitter [0.67x .. 1.34x] off the configured mean
      // (matches soul's old portal-side jitter formula and avoids a
      // metronome feel).
      const wait = enabled
        ? periodS * 1000 * (0.67 + Math.random() * 0.67)
        : PAUSE_REPOLL_MS;
      timerId = window.setTimeout(tick, Math.max(3_000, wait));
    };
    // First fire after a small initial delay so a cold app boot
    // isn't immediately punctuated by an idle expression.
    timerId = window.setTimeout(tick, 8_000);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isConnected, wizardMode, isSending, voice.isListening, escalating]);

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
  //   * Successive activations APPEND naturally, baseline gets
  //     promoted on each finalize so the next press starts from the
  //     end of what was just dictated.
  //   * Window focus is required: an out-of-focus app won't grab
  //     spacebar (the listener wouldn't fire then anyway, but we
  //     belt-and-suspender it with document.hasFocus()).
  //   * Disabled while the continuous-voice button is on, it owns
  //     the mic and runs its own activation loop.
  useEffect(() => {
    if (!isConnected || !hasSession) return undefined;

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
      // version, AND mirroring it into the textarea, if we just call
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
          // Hold continues, swallow further auto-repeat spaces.
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
  }, [isConnected, hasSession, streaming, voice.isListening]);

  // Drive the textarea live as streaming partials arrive. The textarea
  // (`message`) holds ONLY the committed portion; the unconfirmed tail is drawn
  // separately as a dim ghost by the InputBar mirror (via the `tentative` prop
  // above), so committed never renders twice — the bug that got the tail pulled
  // the first time. This effect stays committed-only on purpose.
  useEffect(() => {
    if (!streaming.isActive) return;
    const baseline = voiceBaselineRef.current;
    // trimStart on the committed string, defensive: tokenizer
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

  // Save handler, fires finalizeClothing to UE, persists to soul,
  // mirrors into local profile state so the next entry into
  // customization sees the new values as `initial`, then exits the
  // mode (which separately fires wardrobeModeOff via the lifecycle
  // effect).
  const handleSaveWardrobe = useCallback((settings: WardrobeSettings) => {
    emitWardrobeDescriptor({ EventType: 'finalizeClothing' });
    // The ENVIRONMENT (backdrop + key light + post effect) is GLOBAL, not
    // per-instance: split those fields out to the global environment store and
    // strip them from the instance wardrobe so a character swap never changes
    // the room or grade. Both overlays inherit the current globals through their
    // `initial` (spread below), so these keys round-trip unchanged unless the
    // user touched them — writing them back is idempotent. `hairStrands` is
    // dropped entirely (the strands control was removed).
    const {
      bgColorHex, bgColorIndex, bgGlow,
      lightingAngle, lightIntensity, accentColorHex, accentColorIndex,
      effectId, effectStrength,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      hairStrands: _dropStrands,
      ...instanceSettings
    } = settings;
    setEnvironment({
      bgColorHex, bgColorIndex, bgGlow,
      lightingAngle, lightIntensity, accentColorHex, accentColorIndex,
      effectId, effectStrength,
    });
    // Persist the rest to the INSTANCE being customized (the live one).
    // wardrobeTargetRef tracks the selected real instance, so this is
    // stale-free and lands on the right roster slot.
    setInstanceWardrobe(wardrobeTargetRef.current, instanceSettings);
    setCustomizationActive(false);
    // The effect is persisted now, so the preview has nothing left to add;
    // dropping it hands the grade back to the saved value with no flicker.
    setEffectPreview(null);
  }, [emitWardrobeDescriptor, setInstanceWardrobe, setEnvironment]);

  // wardrobeModeOn / wardrobeModeOff are now owned entirely by
  // CustomizationOverlay, which toggles them per active view (off in the hair
  // detail, on elsewhere) and drops to off on unmount/close. App no longer
  // fires them, so the two don't race across AnimatePresence's delayed unmount.

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
      // wardrobe is intentionally NOT a sheet, see CustomizationOverlay.
      default:
        return null;
    }
  }, [activeWidget, refreshKey]);

  return (
    <div className={`relative flex-1 min-h-0 overflow-hidden${uiHidden ? ' unclaw-ui-hidden' : ''}`}>
      {/* Workspace, everything that should physically shrink when the
          chat pane opens. The `right` value animates from 0 →
          chatPaneWidth so StreamView, the input bar, and every
          right-anchored floating element move inward together. The
          Titlebar + SignInScreen + ChatPane sit OUTSIDE this wrapper
          so they keep their full-window framing. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          right: chatPaneOpen ? chatPaneWidth : 0,
          transition: 'right 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
      <StreamView
        videoParentRef={videoParentRef}
        connectionState={connectionState}
      />

      {/* Post effects, graded over the stream. Mounted for the whole session,
          not just while customizing: the effect is part of how she looks. The
          in-flight preview wins over the saved value so dragging the strength
          slider is instant. */}
      <StreamEffects
        effectId={effectPreview?.effectId ?? environment.effectId}
        strength={effectPreview?.effectStrength ?? environment.effectStrength}
      />

      {/* Customization mode, full-screen overlay anchored to the
          workspace wrapper, so it shares Grace's framing. Every other
          chrome element below fades out while it's mounted. Rendered
          OUTSIDE the `isConnected && hasSession` gate so it doesn't
          unmount when the stream blips and the cleanup effect can
          properly fire wardrobeModeOff. */}
      <AnimatePresence>
        {customizationActive && (
          // One unified customization surface for every character. It resolves
          // its own wardrobe from the active agent id: custom-pipeline builds
          // get the full catalog (34 hair / 18 brows / 6 lashes + body); the
          // base six get their restricted set (own hair, shared clothing, no
          // brows/lashes, no body). See wardrobeForAgent in catalog.ts.
          <CustomWardrobe
            key="custom-wardrobe"
            agentId={activeAgentId}
            initial={{
              ...(currentInstance?.wardrobe ?? {}),
              // Environment (backdrop + light + effect) is GLOBAL: overlay the
              // current globals so the pane opens on them, not on any stale
              // per-instance copy left in the wardrobe blob.
              ...environment,
            }}
            onEmit={emitWardrobeDescriptor}
            onSave={handleSaveWardrobe}
            onCancel={handleExitCustomization}
            onEffect={setEffectPreview}
            onCloseUpChange={setCustomizeCloseUp}
            bgMode={environment.bgmode}
            onBgMode={(m) => setEnvironment({ bgmode: m })}
          />
        )}
      </AnimatePresence>

      {/* Add-a-character picker, shown over the blank stage when the switcher
          cycles onto the Add slot (UE cleared to an empty scene). */}
      <AnimatePresence>
        {addPickerOpen && isConnected && (
          <AddCharacterPicker
            key="add-picker"
            entries={storeEntries}
            bundle={storeBundle}
            roster={agentStack}
            agentById={agentById}
            baseInstanceId={BASE_INSTANCE_ID}
            onPick={handlePickAgent}
            onBuy={(sku) => { void handleBuy(sku); }}
            onDownload={(id) => { void handleDownloadPak(id); }}
            onRename={renameInstance}
            onRemove={handleRemoveInstance}
            onCancel={handleCancelAdd}
          />
        )}
      </AnimatePresence>

      {/* Settings modal, separate from CustomizationOverlay so the two
          can't collide if the user opens settings during a wardrobe
          session. AnimatePresence is INSIDE SettingsPanel since the
          panel needs to animate its own backdrop fade. */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Greeting + ambient widgets. Gated only on a connected stream
          (NOT on a session) so the time + welcome + cycling quote greet
          the user even before they sign in / finish onboarding. The
          ambient widgets nested inside stay gated on `onboardingComplete`
          since they need the profile (timezone / city / interests).
          When customization mode is on, hide all of it so the character
          stands alone in the fitting room. */}
      {isConnected && !customizationActive && !addPickerOpen && (
        <>
      <Greeting
        userName={
          // Wizard open → prefer the live-typing name so the Greeting
          // tracks the input. Once the field is non-empty it wins
          // over the saved profile (the user is actively editing).
          // Wizard closed → fall back to the saved profile, then to
          // the generic "friend" placeholder.
          (wizardMode && wizardLiveName.trim())
            ? wizardLiveName.trim()
            : (profile?.name || 'friend')
        }
      />

      {/* Ambient widgets are disabled until onboarding completes — they need
          the user's profile (timezone/city/interests) and shouldn't clutter
          first-run setup. */}
      {onboardingComplete && (
        <>
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
        </>
      )}

      {/* Status pills, attached screenshots, and the InputBar all
          moved out of this conditional, they now live in the
          App-level "dock layer" container below, which slides between
          the workspace bottom and the chat-pane bottom as a single
          unit (so the user can keep typing while reading history,
          without losing textarea focus or in-flight voice state). */}

        </>
      )}
      </div>{/* /workspace wrapper */}

      {/* Onboarding wizard. Lives OUTSIDE the hasSession-gated workspace
          fragment so it can mount pre-auth: first run boots straight into
          the stream + this wizard (Welcome -> Get started -> the login/
          signup step lives inside the wizard itself via AuthPanel). Also
          opened on demand via the pencil icon / /onboard slash command.
          The welcome line plays on first-run mount; the aha-moment
          greeting plays after a successful save. Both flow through
          dispatchChatResult so UE plays them via the same reply path. */}
      <AnimatePresence>
        {isConnected && !customizationActive && !addPickerOpen && wizardMode && (
          <Wizard
            key="onboarding-wizard"
            firstRun={wizardMode === 'first'}
            characterReady={ueActiveAgentId === BASE_AGENT}
            initial={profile}
            hasSession={hasSession}
            authUser={authUser}
            onSignedIn={handleSignedIn}
            personaPrompt={persona.prompt}
            onSave={(p) => saveSettingsEverywhere({ ...p, roster: agentStack }, authToken ?? null)}
            onChatResult={dispatchChatResult}
            onComplete={(saved) => {
              setProfile(saved);
              setWizardMode(null);
              // The wizard may have updated the chat model (and thus
              // vision capability), re-read apiKeys so the input bar
              // gates its image-attach button against the new pick.
              void refreshActiveLlmModel();
            }}
            onCancel={() => {
              setWizardMode(null);
              void refreshActiveLlmModel();
            }}
            onIdentityNameChange={setWizardLiveName}
          />
        )}
      </AnimatePresence>

      {/* Dock layer, single sliding container for the InputBar, the
          escalation status pills, and the attached-screenshot strip.
          When the chat pane is closed, the layer spans the full window
          (left:0, right:0) so the bar sits at the workspace bottom.
          When the pane opens, the layer slides over to the pane region
          via its `left` value, taking all three children with it as
          one unit. The InputBar is mounted exactly once across both
          states, so typing/voice/textarea-focus state survives toggles.
          Z-index 38 sits above the chat pane (35) so the bar reads
          on top of the gray pane surface, and below the titlebar (50). */}
      {isConnected && hasSession && !customizationActive && !addPickerOpen && (
        <div
          style={{
            position: 'absolute',
            left: chatPaneOpen ? Math.max(0, winWidth - chatPaneWidth) : 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 38,
            pointerEvents: 'none',
            transition: 'left 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Escalation status, stacked text-only labels streaming the
              current activity ("thinking", "navigating", etc.) just
              above the input bar. Newest at bottom in full opacity;
              prior at half opacity; oldest exits upward. */}
          <div
            style={{
              position: 'absolute',
              left: 32,
              // Sits above the screenshot-thumbnail anchor (122) so
              // the two never overlap; floats higher when the chip
              // row is present.
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
              {!chatPaneOpen && escalating && statusHistory.map((s, i) => {
                const isNewest = i === statusHistory.length - 1;
                return (
                  <motion.div
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {/* Accent-tinted ripple loader leads the live activity label. */}
                    {isNewest && <PulseGrid size={16} style={{ marginBottom: 1 }} />}
                    <span
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
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Pending screenshot stack, chips above the bar, animate
              in from below, hover reveals × per chip, full row rides
              along on send. */}
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

          {/* InputBar, single-mount, slides with the parent dock
              layer between workspace bottom and chat-pane bottom.
              Hidden during the wizard since the wizard occupies this
              same anchor. Gated on profile so it doesn't flash before
              the first profile fetch resolves. */}
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
              {/* Camera framing toggle, floats just above the input bar.
                  Only while a stream is up and not in customization (which owns
                  its own full-figure framing). */}
              {isConnected && !customizationActive && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, pointerEvents: 'auto' }}>
                  <CameraModeToggle mode={cameraMode} onChange={setCameraMode} />
                </div>
              )}
              <div style={{ pointerEvents: 'auto' }}>
                <InputBar
                  ref={inputBarRef}
                  personaName={characterName}
                  isSending={isSending}
                  passthrough={passthrough}
                  onExitPassthrough={() => setPassthrough(false)}
                  passthroughVerbosity={passthroughPrefs.verbosity}
                  passthroughMuted={passthroughPrefs.muted}
                  onSetPassthroughVerbosity={setPassthroughVerbosity}
                  onTogglePassthroughMuted={togglePassthroughMuted}
                  disabled={!isConnected}
                  hasAttachments={attachedImages.length > 0}
                  onSendMessage={handleSendMessage}
                  onOpenSheet={handleToggleWidget}
                  onDispatchAnimation={dispatchAnimation}
                  onClearMemory={handleClearMemory}
                  onOpenOnboarding={() => setWizardMode('edit')}
                  onExpress={handleExpress}
                  voice={{
                    active: voice.isListening,
                    // Only block STARTING voice while she's replying. It must
                    // always be possible to STOP it: in continuous mode every
                    // turn sets isSending, which used to grey the button out
                    // (0.4 opacity, not-allowed) and pulse it while the mic was
                    // still hot, so you couldn't switch voice mode off until she
                    // finished. That was the erratic behaviour.
                    disabled: isSending && !voice.isListening,
                    vadLevel: voice.vadLevel,
                    isUserSpeaking: voice.isUserSpeaking,
                    isTranscribing: voice.isTranscribing,
                    toggle: () => { void handleVoiceToggle(); },
                    start: () => { void voice.start(); },
                    stop: () => { void voice.stop(); },
                  }}
                  // Voice-active visual state during BOTH PTT and continuous
                  // mode. PTT flips streaming.isActive on start(); continuous
                  // mode flips it when VoiceController calls startFeed() at
                  // speech onset. OR'ing `voice.isListening` covers the brief
                  // gap between mic toggle and the WS handshake.
                  //
                  // The bar shows ONLY committed transcript while you speak.
                  // The committed text already lands in the textarea via the
                  // setText effect above; we used to ALSO pass `display`
                  // (committed + tentative) as a gray overlay, which re-rendered
                  // every committed word a second time. Unconfirmed words are no
                  // longer drawn at all.
                  voiceActive={streaming.isActive || voice.isListening}
                  // The unstable transcriber tail, shown as a dim ghost after
                  // the committed text (which rides `message` via setText). The
                  // InputBar mirror renders committed once + this once, so no
                  // double-draw. Cleared to '' when not streaming so it never
                  // lingers after finalize.
                  tentative={streaming.isActive ? streaming.tentative : ''}
                  agents={personaAgents}
                  selectedAgentId={selectedInstanceId}
                  onSelectAgent={(id) => selectInstance(id, 1)}
                  onAddAgent={() => selectInstance(ADD_SLOT, 1)}
                  personaDisabled={!isConnected}
                  onPasteImage={handlePasteImage}
                  onAttachImages={handleAttachImages}
                  canAttachImages={canAttachImages}
                  chatPaneOpen={chatPaneOpen}
                  onToggleChatPane={() => setChatPaneOpen((o) => !o)}
                />
              </div>

              {/* Pipeline error: the chat / voice request failed (bad key, no
                  model picked, provider down). Anchored to the input-bar
                  wrapper so it sits right above the bar and left-aligned with
                  it, at any bar height. End users can't see devtools, so this
                  is the only place they learn the turn failed. On-brand error
                  vocabulary: soft-cinder tint + full border + icon. */}
              <AnimatePresence>
                {pipelineError && (
                  <motion.div
                    key="pipeline-error"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    role="alert"
                    onClick={() => setPipelineError(null)}
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 10px)',
                      left: 0,
                      zIndex: 60,
                      maxWidth: 460,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 9,
                      padding: '11px 14px',
                      borderRadius: 12,
                      background: 'rgba(200, 122, 122, 0.14)',
                      border: '1px solid rgba(200, 122, 122, 0.40)',
                      backdropFilter: 'var(--glass-blur)',
                      WebkitBackdropFilter: 'var(--glass-blur)',
                      boxShadow: '0 12px 30px -12px rgba(0,0,0,0.62)',
                      color: 'var(--text-primary)',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                    }}
                  >
                    <AlertTriangle
                      size={15}
                      strokeWidth={2.2}
                      style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger, #c87a7a)' }}
                    />
                    <span>{pipelineError}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      )}

      {/* Titlebar, full window width, OUTSIDE the workspace wrapper so
          the window chrome stays edge-to-edge even with the chat pane
          open. Z-index 50 keeps it above both workspace and pane.
          In customization mode we drop into "minimal", the profile
          cluster + wordmark hide, but pin / minimize / close stay so
          the window remains manageable. */}
      <Titlebar
        minimalMode={customizationActive}
        // Customization mode no longer borrows the Titlebar's leftSlot
        // for its back button. The back button + "Customization" label
        // now live as a single cluster inside CustomizationOverlay,
        // positioned below the macOS traffic lights so both belong to
        // the same left-side beat. Titlebar in minimalMode just hides
        // its profile cluster and shows the platform window controls.
        showReconnecting={showReconnecting}
        user={authUser}
        onSignOut={() => { void handleSignOut(); }}
        onResetAccount={() => { void handleResetAccount(); }}
        onResetSession={handleResetSession}
        onOpenSettings={() => setSettingsOpen(true)}
        clawsBalance={hasSession ? clawsBalance : undefined}
        companionAuth={hasSession && authUser ? { token: authToken ?? null, userId: authUser.id } : null}
      />

      {/* New-account notice: this machine's previous API keys were cleared
          (keys are local secrets, never synced to an account). Nudge the user
          to re-enter them in Settings. Dismissible. */}
      {/* Voice / mic warning — same top-banner treatment as the "re-enter your
          keys" notice. Mic denials are accent-tinted and sticky with an Open
          Settings action; generic voice hiccups are neutral and self-clear. */}
      {voiceNotice && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 46,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 59,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 440,
            padding: '9px 12px 9px 14px',
            borderRadius: 12,
            background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.66))',
            border: `1px solid ${voiceNotice.kind === 'mic' ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'rgba(255,255,255,0.12)'}`,
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            boxShadow: '0 10px 28px -12px rgba(0,0,0,0.6)',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            lineHeight: 1.35,
          }}
        >
          <span style={{ flex: 1 }}>{voiceNotice.text}</span>
          {voiceNotice.kind === 'mic' && (
            <button
              type="button"
              onClick={() => { void window.electronAPI?.mic?.openSettings?.(); }}
              style={{
                flex: '0 0 auto',
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Open Settings
            </button>
          )}
          <button
            type="button"
            onClick={() => setVoiceNotice(null)}
            aria-label="Dismiss"
            style={{
              flex: '0 0 auto',
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-ghost)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {apiKeysNotice && hasSession && (
        <div
          style={{
            position: 'absolute',
            top: 46,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 58,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 440,
            padding: '9px 12px 9px 14px',
            borderRadius: 12,
            background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.66))',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            boxShadow: '0 10px 28px -12px rgba(0,0,0,0.6)',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            lineHeight: 1.35,
          }}
        >
          <span style={{ flex: 1 }}>
            Signed in to a different account on this device. Your saved API keys were
            cleared, re-enter them in Settings.
          </span>
          <button
            type="button"
            onClick={() => { setApiKeysNotice(false); setSettingsOpen(true); }}
            style={{
              flex: '0 0 auto',
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.08)',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setApiKeysNotice(false)}
            aria-label="Dismiss"
            style={{
              flex: '0 0 auto',
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-ghost)',
              cursor: 'pointer',
            }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Store toast. 'added' fires when a purchase lands (entitlement appears
          via the checkout deep link or the post-checkout poll) — the download
          then auto-starts. 'ready' fires when the bought character finishes
          downloading + mounting. Warm accent edge + check mark, auto-dismisses. */}
      <AnimatePresence>
        {storeToast && hasSession && (
          <motion.div
            key="store-toast"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'absolute',
              top: 46,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 59,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: 460,
              padding: '11px 14px',
              borderRadius: 12,
              // Same tinted-surface treatment as the pipeline-error toast
              // (full border + matching tint), just keyed to the ember
              // accent since this is a positive confirmation. No side-stripe.
              background: 'rgba(196, 68, 68, 0.13)',
              border: '1px solid rgba(196, 68, 68, 0.38)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              boxShadow: '0 12px 30px -12px rgba(0,0,0,0.62)',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              lineHeight: 1.35,
            }}
          >
            <Check
              size={15}
              strokeWidth={2.4}
              aria-hidden
              style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent, #c44444)' }}
            />
            <span style={{ flex: 1 }}>
              {(() => {
                const names = storeToast.ids.map((id) => agentById[id]?.name ?? id);
                if (storeToast.kind === 'ready') {
                  return <><b>{names[0]}</b> is ready, pick it from the + menu to start chatting.</>;
                }
                if (names.length === 1) {
                  return <><b>{names[0]}</b> was added to your account, downloading now…</>;
                }
                return <><b>{names.length} characters</b> were added to your account, downloading now…</>;
              })()}
            </span>
            <button
              type="button"
              onClick={() => setStoreToast(null)}
              aria-label="Dismiss"
              style={{
                flex: '0 0 auto',
                width: 22,
                height: 22,
                padding: 0,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-ghost)',
                cursor: 'pointer',
              }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </motion.div>
        )}

        {/* Non-blocking provisioning status. Shown while owned characters are
            still being fetched at startup so it reads as a deliberate init
            step. The base character streams behind it; the + menu blocks
            switching to anything not yet ready, so nothing breaks. Auto-hides
            the instant every owned pak is on disk (the common warm relaunch
            case never sees it). Sits just under the store toast slot. */}
        {provisioningIds.length > 0 && hasSession && (
          <motion.div
            key="provisioning-status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'absolute',
              top: 46,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 58,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: 460,
              padding: '11px 14px',
              borderRadius: 12,
              background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.72))',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.10))',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              boxShadow: '0 12px 30px -12px rgba(0,0,0,0.62)',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              lineHeight: 1.35,
            }}
          >
            <motion.div
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              style={{
                flexShrink: 0,
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: '2px solid var(--text-ghost, rgba(255,255,255,0.28))',
                borderTopColor: 'var(--accent, #c44444)',
              }}
            />
            <span style={{ flex: 1 }}>
              {(() => {
                const names = provisioningIds.map((id) => agentById[id]?.name ?? id);
                const lead = names.length === 1
                  ? <><b>{names[0]}</b> is</>
                  : <><b>{names.length} characters</b> are</>;
                return <>Getting {lead} ready…</>;
              })()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Not enough claws" notice — shown when a character spend can't be
          covered by the current balance. Auto-dismisses. */}
      <AnimatePresence>
        {clawsNotice && hasSession && (
          <motion.div
            key="claws-notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'absolute',
              top: 46,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 59,
              maxWidth: 440,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: '11px 14px',
              borderRadius: 12,
              // Same cinder treatment as the pipeline-error toast: this is a
              // soft-failure ("can't cover the spend"), full border + tint,
              // no side-stripe.
              background: 'rgba(200, 122, 122, 0.14)',
              border: '1px solid rgba(200, 122, 122, 0.40)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              boxShadow: '0 12px 30px -12px rgba(0,0,0,0.62)',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              lineHeight: 1.4,
            }}
          >
            <AlertTriangle
              size={15}
              strokeWidth={2.2}
              style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger, #c87a7a)' }}
            />
            <span>{clawsNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat history side pane, slides in from the right; the
          workspace wrapper above shrinks in unison so the stream is
          physically pushed in, not overlaid. Only mounted once
          a session exists (authed or guest); conversation history
          comes from the per-persona localStorage memory. Hidden
          while customization mode is active. */}
      {isConnected && hasSession && !customizationActive && !addPickerOpen && (
        <ChatPane
          open={chatPaneOpen}
          turns={memory.turns}
          personaName={characterName}
          width={chatPaneWidth}
          toolEvents={toolEvents}
          escalating={escalating}
          onResizeStart={handlePaneResizeStart}
        />
      )}

      {/* Chat pane header, rendered as a SIBLING of <ChatPane>, NOT
          inside it, so its z-index isn't trapped inside the pane's
          z-35 stacking context. At z-60 it stacks above the Titlebar
          (z-50), and the WebkitAppRegion: 'no-drag' on the wrapper
          keeps the close button reachable through the titlebar's
          drag region overlay. The wrapper's `right: 140` leaves
          room for the existing titlebar window controls (AS / pin /
          minimize / close-window). */}
      {isConnected && hasSession && chatPaneOpen && !customizationActive && !addPickerOpen && (
        <div
          style={{
            position: 'absolute',
            top: 18,
            right: 140,
            // Left edge of the pane region + 16 = where the header sits.
            left: Math.max(0, winWidth - chatPaneWidth) + 16,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <ChatPaneHeader
            personaName={characterName}
            onClose={() => setChatPaneOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Screenshot thumbnail, pending attachment preview shown above the
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
