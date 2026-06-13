import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Config,
  PixelStreaming,
  Logger,
  LogLevel,
} from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';

// Silence the PS lib's verbose info/debug noise. Warnings + errors only.
// Done at module load (not inside the hook) so it applies before the first
// PixelStreaming instance is constructed and survives hook remounts.
Logger.InitLogging(LogLevel.Warning, true);

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface UsePixelStreamingOptions {
  signalingUrl: string;
  /** Delay between reconnect attempts in ms */
  retryDelay?: number;
}

interface UsePixelStreamingReturn {
  videoParentRef: React.RefObject<HTMLDivElement | null>;
  connectionState: ConnectionState;
  pixelStreaming: PixelStreaming | null;
  /**
   * Send a descriptor to UE and resolve when UE acks it back with
   * `{EventType, status: "received"}`. Rejects on timeout (default 1500 ms).
   * Caller can retry on rejection. Used for descriptors that MUST be
   * acknowledged (the wardrobe init handshake on stream connect — UE is
   * sometimes not ready to process descriptors the instant the stream
   * is technically "connected", so we need confirm-or-retry rather than
   * fire-and-forget).
   */
  sendAndAwaitAck: (
    payload: Record<string, unknown> & { EventType: string },
    opts?: { timeoutMs?: number }
  ) => Promise<void>;
}

export function usePixelStreaming({
  signalingUrl,
  retryDelay = 3000,
}: UsePixelStreamingOptions): UsePixelStreamingReturn {
  const videoParentRef = useRef<HTMLDivElement | null>(null);
  const psRef = useRef<PixelStreaming | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Per-EventType promise resolvers waiting on a `status: "received"`
  // response from UE. Set when sendAndAwaitAck is called, cleared by
  // the response listener below when the matching EventType arrives.
  // Map (not object) so we can iterate cleanly on cleanup.
  const pendingAcksRef = useRef<Map<string, (err?: Error) => void>>(new Map());

  useEffect(() => {
    if (!videoParentRef.current) return;

    const config = new Config({
      initialSettings: {
        AutoPlayVideo: true,
        AutoConnect: true,
        StartVideoMuted: false,
        HoveringMouse: true,
        WaitForStreamer: true,
        MatchViewportRes: true,
        // Offerer role is PLATFORM-SPECIFIC — get this wrong and the data
        // channel ends up half-wired (browser→UE works, UE→browser responses
        // silently never arrive), which breaks every ack-gated init path
        // (wardrobe / lighting / clothing-color / installedCharacters).
        //
        // macOS — our PixelStreaming2NativeMac plugin (1.0.8+) is
        //   browser-as-offerer: UE awaits the browser's offer in OnRemoteOffer
        //   and answers via AddTrack. Without BrowserSendOffer the two sides
        //   wait silently after `subscribe` and the stream never starts (WS
        //   connects, subscribe sent, then only pings; UE makes the peer +
        //   video track but never gets an SDP offer). Hit in 1.0.8 first-ship.
        // Windows — stock PixelStreaming2 is UE-as-offerer (the default, and
        //   what the working PC reference uses). UE creates the data channel
        //   and the browser binds it via ondatachannel, fully bidirectional.
        //   Forcing BrowserSendOffer here makes the browser create 'cirrus'
        //   and offer, which stock PS2 (built to be the offerer) does NOT wire
        //   for its own send direction → UE→browser responses are dropped.
        BrowserSendOffer: window.electronAPI?.platform === 'darwin',
        ss: signalingUrl,
      },
    });

    const ps = new PixelStreaming(config, {
      videoElementParent: videoParentRef.current,
    });

    psRef.current = ps;

    // Listen for UE → browser response messages. The SDK fires this
    // for EVERY response, regardless of "name" — that's just a handle
    // for removal. We parse the message as JSON; if it has the shape
    // `{EventType, status: "received"}` it's an ack for a sendAndAwaitAck
    // call and we resolve the matching pending promise. Late acks
    // (after a timeout) are silently discarded.
    ps.addResponseEventListener('unclaw-ack-router', (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return; }  // non-JSON UE response — ignore
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { EventType?: unknown; status?: unknown };
      if (typeof msg.EventType !== 'string') return;
      if (msg.status !== 'received') return;
      const resolver = pendingAcksRef.current.get(msg.EventType);
      if (resolver) {
        pendingAcksRef.current.delete(msg.EventType);
        resolver();
        console.log('[ps-ack] ←', msg.EventType);
      }
    });

    const scheduleRetry = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (psRef.current) {
          setConnectionState('connecting');
          psRef.current.reconnect();
        }
      }, retryDelay);
    };

    // Force MatchViewportRes — the SDK's auto-trigger from the
    // `MatchViewportRes: true` setting is unreliable on Electron/Mac
    // paint timing (the video element may not have its final device-
    // pixel size when the SDK first fires the sync). Manually re-fire
    // at `webRtcConnected` and `playStream` (×3, layered) to cover the
    // layout-settle window. Mirrors the proven PC reference pattern in
    // ProjectGraceTests/PS_Next_Claude. Drop the manual fires once the
    // auto-trigger proves reliable across Mac/Electron paint timing.
    // Render at PHYSICAL device pixels, not CSS pixels. The SDK's
    // updateVideoStreamSize() feeds the video element's *logical* size
    // (clientWidth/clientHeight) into onMatchViewportResolutionCallback, so on
    // a Retina display UE renders at half the pane's real pixel count and the
    // browser upscales 2x — a soft avatar. Override the callback to scale by
    // devicePixelRatio (capped + rounded to even dims for H264 4:2:0) before
    // emitting the Resolution command. Wire format is identical to the SDK's
    // own path: emitCommand() -> streamMessageController 'Command' handler,
    // same as onMatchViewportResolutionCallback's default body.
    const MAX_RENDER_DIM = 1920; // cap longest side so the HW encoder + bitrate cap stay sane
    const installDprResolutionOverride = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vp: any,
    ) => {
      if (!vp || vp.__unclawDprOverride) return;
      vp.onMatchViewportResolutionCallback = (cssW: number, cssH: number) => {
        const dpr = window.devicePixelRatio || 1;
        let w = Math.round(cssW * dpr);
        let h = Math.round(cssH * dpr);
        const longest = Math.max(w, h);
        if (longest > MAX_RENDER_DIM) {
          const s = MAX_RENDER_DIM / longest;
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        w -= w % 2; // even dims: H264 4:2:0 chroma subsampling needs them
        h -= h % 2;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ps as any).emitCommand({ 'Resolution.Width': w, 'Resolution.Height': h });
      };
      vp.__unclawDprOverride = true;
    };
    const forceViewportResolutionUpdate = () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const controller = (ps as any)._webRtcController;
        installDprResolutionOverride(controller?.videoPlayer);
        controller?.videoPlayer?.updateVideoStreamSize?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ps] viewport-resolution update failed:', err);
      }
    };

    // Dev-mode handle so the update can be fired from DevTools when
    // diagnosing a layout-change miss. Stripped in production builds
    // by Vite's dead-code elimination on import.meta.env.DEV.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).forceViewportUpdate = forceViewportResolutionUpdate;
    }

    ps.addEventListener('webRtcConnecting', () => setConnectionState('connecting'));
    ps.addEventListener('webRtcConnected', () => {
      setConnectionState('connected');
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // First manual viewport-res nudge ~500 ms after RTC connect (PC
      // reference timing). Stream may not be playing yet so this is just
      // priming the pipe; the `playStream` triple-fire below carries the
      // real load.
      setTimeout(forceViewportResolutionUpdate, 500);
      // Localhost optimization: ask the receiver to render frames as soon
      // as decoded with no jitter buffer. Default Chromium playout delay is
      // 50-200ms (designed to absorb network jitter); on loopback there's no
      // jitter so the buffer is pure latency. Reaching the underlying
      // RTCPeerConnection requires accessing private SDK state, hence the
      // any-cast — the path is stable in PS5.6 and verified in the lib.
      try {
        const pc: RTCPeerConnection | undefined =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ps as any)._webRtcController?.peerConnectionController?.peerConnection;
        if (pc) {
          for (const recv of pc.getReceivers()) {
            if (recv.track?.kind === 'video') {
              // playoutDelayHint is the modern (2022+) standard property.
              // 0 = "render with minimum delay possible".
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (recv as any).playoutDelayHint = 0;
              // jitterBufferTarget (Chrome 92+) is the newer companion knob —
              // explicit target depth in ms. 0 = no buffering. Belt and suspenders
              // with playoutDelayHint; some Chromium builds honor one but not the
              // other. Sofia's debug viewer sets both for the same reason.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (recv as any).jitterBufferTarget = 0;
            } else if (recv.track?.kind === 'audio') {
              // Dual-audio fix (BOTH platforms): UE plays its own audio
              // out of the local speakers (CoreAudio on Mac, WASAPI on
              // Windows) at the same time it sends the WebRTC audio track.
              // Disable the inbound track at the receiver so the renderer
              // is silent and Grace is heard exactly once, from UE locally.
              // track.enabled=false makes the WebRTC stack render silence
              // regardless of any video/audio element's .muted state.
              //
              // This is the single cross-platform strategy: soul's
              // _LocalAudioMuteMonitor (which used to mute UE's WASAPI
              // session on Windows instead) is now disabled by default, so
              // muting here is the ONLY mute — don't re-enable both or you
              // get total silence.
              recv.track.enabled = false;
            }
          }
        }
      } catch (err) {
        // Don't break the connection if the SDK internals shifted —
        // the latency hint is a nice-to-have, not load-bearing.
        // eslint-disable-next-line no-console
        console.warn('[usePixelStreaming] playoutDelayHint apply failed:', err);
      }
    });
    // Triple-fire viewport-res on stream start. Each one re-runs the
    // SDK's videoPlayer.updateVideoStreamSize() which sends a Resize
    // descriptor to UE with the current device-pixel size of the
    // <video> element. Layered timing covers the window where the
    // Electron layout is still settling (image first paint, container
    // reflow, etc.). PC reference uses the same 1/2/3-second pattern.
    ps.addEventListener('playStream', () => {
      setTimeout(forceViewportResolutionUpdate, 1000);
      setTimeout(forceViewportResolutionUpdate, 2000);
      setTimeout(forceViewportResolutionUpdate, 3000);
    });

    // Dynamic-resize: watch the video parent's pixel size and re-fire
    // updateVideoStreamSize on every Electron-window size change. Pairs
    // with the MacInputHandler::SetCommandHandler("Resolution.Width", ...)
    // C++ side that runs r.SetRes WxHw on receipt. Debounced 150 ms so a
    // drag-resize doesn't flood UE with per-frame r.SetRes calls.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        forceViewportResolutionUpdate();
      }, 150);
    });
    ro.observe(videoParentRef.current);
    ps.addEventListener('webRtcDisconnected', () => {
      setConnectionState('connecting');
      scheduleRetry();
    });
    ps.addEventListener('webRtcFailed', () => {
      setConnectionState('connecting');
      scheduleRetry();
    });

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      ps.removeResponseEventListener('unclaw-ack-router');
      // Reject any in-flight ack promises so callers don't hang forever
      // if the component unmounts mid-handshake.
      const pendings = pendingAcksRef.current;
      pendings.forEach(reject => reject(new Error('pixelStreaming unmounted')));
      pendings.clear();
      ps.disconnect();
      psRef.current = null;
    };
  }, [signalingUrl, retryDelay]);

  const sendAndAwaitAck = useCallback<UsePixelStreamingReturn['sendAndAwaitAck']>(
    (payload, opts) => {
      const ps = psRef.current;
      if (!ps) return Promise.reject(new Error('pixelStreaming not ready'));

      const timeoutMs = opts?.timeoutMs ?? 1500;
      const evt = payload.EventType;

      return new Promise<void>((resolve, reject) => {
        // If a previous ack for this EventType is still pending, the
        // newer send supersedes it — drop the old resolver. (UE only
        // tracks the latest state; we don't need both acks.)
        const existing = pendingAcksRef.current.get(evt);
        if (existing) existing(new Error('superseded by newer send'));

        const timer = setTimeout(() => {
          if (pendingAcksRef.current.get(evt) === wrappedResolve) {
            pendingAcksRef.current.delete(evt);
            reject(new Error(`ack timeout: ${evt} (${timeoutMs}ms)`));
          }
        }, timeoutMs);

        const wrappedResolve = (err?: Error) => {
          clearTimeout(timer);
          if (err) reject(err); else resolve();
        };

        pendingAcksRef.current.set(evt, wrappedResolve);

        ps.emitUIInteraction({
          ...payload,
          Timestamp: new Date().toISOString(),
        });
      });
    },
    []
  );

  return {
    videoParentRef,
    connectionState,
    pixelStreaming: psRef.current,
    sendAndAwaitAck,
  };
}
