// Passthrough-mode bridge.
//
// In passthrough mode UnClaw runs no inference of its own. A user's
// external coding agent (Claude Code first, any MCP/CLI agent later)
// decides WHAT the avatar says by calling soul's POST /passthrough/speak
// (via the `speak` shim, which only needs soul's http port from
// ports.json). Soul can't synthesize on its own here , TTS provider /
// voice / BYOK keys live in the renderer , so it pushes the text to us
// over the /passthrough/ws channel. This module holds that subscription
// and, for each pushed `speak`, renders it through soul's /speak
// (no-LLM) with our onboarding voice + keys, then hands the finished job
// to the caller's dispatch (emitUIInteraction to UE), identical to a
// normal chat turn.
//
// Reconnect: soul may respawn mid-session (the supervisor restarts it on
// crash). The socket auto-reconnects with capped backoff until stop()
// is called, and callers should re-invoke start() when soul's ports
// change (subscribeSoulPorts) so we dial the new port.

import { getSoulWsUrl } from './soulBase';
import { speakViaSoul, type SoulChatResult } from './soulChat';
import { VERBOSITY_QUEUE_CAP, type PassthroughPrefs } from '../hooks/usePassthroughPrefs';

/** One speak request pushed from soul over /passthrough/ws. */
interface PassthroughSpeakMsg {
  type: 'speak';
  text: string;
  mood?: string | null;
  action?: string | null;
}

export interface PassthroughBridgeOptions {
  /** Resolve per-character voice ids for the active TTS provider (same
   *  shape chatViaSoul takes). Read fresh per speak so an agent switch
   *  mid-session voices the new character. */
  getVoices?: () => { elevenlabs?: string; supertonic?: string; kokoro?: string; qwen3?: string } | undefined;
  /** Lipsync model for the active character. */
  getLipsyncModel?: () => 'v6' | 'v6mini' | 'v4' | undefined;
  /** Drive UE with the rendered job (reuse App's dispatchChatResult). */
  onRendered: (result: SoulChatResult) => void;
  /** Live passthrough prefs (talkativeness + mute). Read per incoming
   *  speak so a toggle takes effect immediately: muted drops incoming
   *  lines; verbosity caps the play-queue (drop-oldest). */
  getPrefs?: () => PassthroughPrefs;
  /** Whether the app is ready to render a spoken turn: signed in AND
   *  onboarding complete (TTS provider / voice / keys). Reported to soul on
   *  connect so the `speak` shim can gate on it (a passthrough session can be
   *  connected while still on the sign-in / setup screen). */
  getReady?: () => boolean;
  /** Optional: connection state changes, for a status pill. */
  onStatus?: (state: 'connecting' | 'open' | 'closed') => void;
}

/** Handle returned by startPassthroughBridge. */
export interface PassthroughBridgeHandle {
  stop: () => void;
  /** Re-report readiness (e.g. after the user signs in mid-session). */
  reportReady: (ready: boolean) => void;
}

const RECONNECT_MIN_MS = 800;
const RECONNECT_MAX_MS = 8000;

/** Open the passthrough channel and render every pushed speak. Returns a
 *  handle: stop() closes the socket + halts reconnection; reportReady() pushes
 *  fresh readiness to soul. Safe to call again after stop() — call stop() first. */
export function startPassthroughBridge(opts: PassthroughBridgeOptions): PassthroughBridgeHandle {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = RECONNECT_MIN_MS;
  let reconnectTimer: number | null = null;
  // Play queue. Speaks render + play sequentially (the avatar can't talk
  // over itself). A single consumer (`pump`) drains it. Talkativeness caps
  // the depth (drop-oldest) so the avatar stays current with the agent
  // instead of lagging; mute drops incoming lines outright.
  const queue: PassthroughSpeakMsg[] = [];
  let draining = false;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnect();
    reconnectTimer = window.setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  };

  const enqueueSpeak = (msg: PassthroughSpeakMsg) => {
    const text = (msg.text || '').trim();
    if (!text) return;
    const prefs = opts.getPrefs?.();
    // Muted: drop silently. Soul already short-circuits speak when muted,
    // this is the belt-and-suspenders guard for a line that raced the toggle.
    if (prefs?.muted) return;
    queue.push({ ...msg, text });
    // Cap the backlog by verbosity, dropping the OLDEST pending lines so
    // the avatar speaks the most recent things rather than falling behind.
    const cap = prefs ? VERBOSITY_QUEUE_CAP[prefs.verbosity] : VERBOSITY_QUEUE_CAP.balanced;
    while (queue.length > cap) queue.shift();
    void pump();
  };

  const pump = async () => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && !stopped) {
        // Re-check mute at play time too, so muting mid-backlog goes quiet.
        if (opts.getPrefs?.().muted) { queue.length = 0; break; }
        const msg = queue.shift()!;
        try {
          const result = await speakViaSoul(msg.text, {
            mood: msg.mood || undefined,
            actionName: msg.action || undefined,
            voices: opts.getVoices?.(),
            lipsyncModel: opts.getLipsyncModel?.(),
          });
          if (stopped) break;
          opts.onRendered(result);
          // Hold for the avatar's speaking window before the next line, so
          // a rapid burst plays cleanly instead of clipping.
          const durMs = Math.round(((result.duration as number) ?? 0) * 1000);
          if (durMs > 0) await new Promise((r) => window.setTimeout(r, durMs));
        } catch (err) {
          console.warn('[passthrough] speak render failed', err);
        }
      }
    } finally {
      draining = false;
    }
  };

  const reportReady = (ready: boolean) => {
    try { ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ready', ready })); }
    catch { /* socket closing */ }
  };

  const connect = () => {
    if (stopped) return;
    opts.onStatus?.('connecting');
    let sock: WebSocket;
    try {
      sock = new WebSocket(getSoulWsUrl('/passthrough/ws'));
    } catch (err) {
      console.warn('[passthrough] ws construct failed', err);
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      backoff = RECONNECT_MIN_MS;
      opts.onStatus?.('open');
      console.log('[passthrough] channel open');
      // Report readiness so the shim knows if speech will actually render.
      reportReady(opts.getReady?.() ?? false);
    };
    sock.onmessage = (ev) => {
      let msg: PassthroughSpeakMsg;
      try {
        msg = JSON.parse(ev.data as string) as PassthroughSpeakMsg;
      } catch {
        return;
      }
      if (msg?.type === 'speak') enqueueSpeak(msg);
    };
    sock.onerror = () => {
      // onclose fires next; reconnect is handled there.
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      opts.onStatus?.('closed');
      scheduleReconnect();
    };
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      if (ws) {
        try { ws.close(); } catch { /* already closed */ }
        ws = null;
      }
    },
    reportReady,
  };
}
