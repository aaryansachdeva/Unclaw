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
   * Arm a waiter for UE's `{EventType, status: "received"}` echo without
   * sending anything. Resolves true when the ack lands, false on timeout
   * (default 1500 ms). The dressing chain fires its descriptors over the
   * ordered data channel and probes liveness with ONE of these per run
   * instead of blocking on an ack per descriptor (un-acked EventTypes used
   * to burn a full timeout each, stacking seconds of visible delay).
   */
  waitForAck: (eventType: string, timeoutMs?: number) => Promise<boolean>;
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
  // response from UE. Set when waitForAck arms a waiter, cleared by
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
        // PS 5.6 SDK defaults to UE-as-offerer (legacy Epic plugin behavior).
        // Our PixelStreaming2NativeMac plugin (1.0.8+) is browser-as-offerer —
        // UE awaits the browser's offer in OnRemoteOffer and answers via AddTrack.
        // Without this flag, both sides wait silently after `subscribe` and the
        // stream never starts. Symptom: WS connects + subscribe sent, then only
        // pings forever; UE creates the peer + video track but never gets an
        // SDP offer. Hit in 1.0.8 first-Mac-ship test.
        BrowserSendOffer: true,
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
    // `{EventType, status: "received"}` it's an ack a waitForAck waiter
    // call and we resolve the matching pending promise. Late acks
    // (after a timeout) are silently discarded.
    ps.addResponseEventListener('unclaw-ack-router', (raw: string) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return; }  // non-JSON UE response — ignore
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as { EventType?: unknown; status?: unknown };
      if (typeof msg.EventType !== 'string') return;
      // UE acks a completed function in one of two conventions:
      //   1. {EventType:"<sent>", status:"received"}  (clothing/init/color)
      //   2. {EventType:"<sent>Success"}              (bg/light/blends/strands/
      //      camera/animations) — strip the suffix to recover the key the
      //      waiter was armed under.
      // Normalise both to the sent EventType so a waitForAck on the descriptor
      // we emitted resolves regardless of which convention UE used.
      let key: string | null = null;
      if (msg.status === 'received') {
        key = msg.EventType;
      } else if (msg.EventType.endsWith('Success')) {
        key = msg.EventType.slice(0, -'Success'.length);
      }
      if (!key) return;
      const resolver = pendingAcksRef.current.get(key);
      if (resolver) {
        pendingAcksRef.current.delete(key);
        resolver();
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
    // Cap the longest rendered side. Everything downstream scales with pixel
    // area: UE's scene-texture chain, the capture/I420/NV12 conversions, and
    // the HW encoder. Uncapped Retina (dpr 2) testing measured ~6.5 GB resident
    // at launch and ~1 GB of realloc churn per window resize. 1600 (vs 1920)
    // trims ~30% more off every output-sized buffer in the whole pipeline;
    // memory > sharpness call made 2026-07-19.
    const MAX_RENDER_DIM = 1600;
    // Last dims actually sent to UE. Identical re-sends are skipped (layout
    // jitter + the layered connect-time fires produce duplicates); reset on
    // each webRtcConnected so a fresh session always gets one real send even
    // if a pre-connect attempt was dropped with the data channel closed.
    const lastSentRes = { w: 0, h: 0 };
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
        // Cap, then quantize the longest side DOWN to a 128px step (above
        // 1024). Every distinct resolution UE receives costs one realloc
        // cycle of the backbuffer + capture + encoder chain, so snapping to
        // steps makes most window resizes send nothing at all (the dedupe
        // below eats the repeat). Worst-case cost is a <=127px downscale the
        // video element upscales away, invisible at stream viewing sizes.
        // Below 1024 the buffers are small enough that native size is fine.
        let target = longest;
        if (longest > MAX_RENDER_DIM) {
          target = MAX_RENDER_DIM;
        } else if (longest >= 1024) {
          target = Math.floor(longest / 128) * 128;
        }
        if (target < longest) {
          const s = target / longest;
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        w -= w % 2; // even dims: H264 4:2:0 chroma subsampling needs them
        h -= h % 2;
        if (w === lastSentRes.w && h === lastSentRes.h) return;
        lastSentRes.w = w;
        lastSentRes.h = h;
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

    // Decoder diagnostic. Chromium can silently fall back from VideoToolbox
    // to FFmpeg software decode (codec-profile mismatch, GPU process restart),
    // which costs ~200MB of CPU-side frame copies plus real CPU per frame.
    // Log the implementation so a regression is a visible console line.
    // HW names vary by Chromium version: "VideoToolboxVideoDecoder" (current),
    // "VDAVideoDecoder" / "ExternalDecoder" (older). Software is consistently
    // "FFmpegVideoDecoder" (or libvpx/dav1d for codecs we don't send). Match
    // the known-HW set, so an unrecognized new name warns instead of passing.
    const logDecoderImplementation = async () => {
      try {
        const pc: RTCPeerConnection | undefined =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ps as any)._webRtcController?.peerConnectionController?.peerConnection;
        if (!pc) {
          // eslint-disable-next-line no-console
          console.warn('[ps] video decoder: no peer connection yet');
          return;
        }
        let seen = false;
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            seen = true;
            const r = report as {
              decoderImplementation?: string;
              framesDecoded?: number;
              totalDecodeTime?: number;
            };
            const avgMs = r.framesDecoded && r.totalDecodeTime
              ? (r.totalDecodeTime / r.framesDecoded) * 1000
              : undefined;
            const avgStr = avgMs !== undefined ? `, avg decode ${avgMs.toFixed(2)}ms/frame` : '';
            if (r.decoderImplementation === undefined) {
              // Chromium fingerprinting-gates decoderImplementation: it's only
              // exposed to pages granted media capture, which this renderer
              // never requests (the mic lives UE-side). NOT a software signal.
              // Verified 2026-07-19 that decode is hardware regardless: a
              // VTDecoderXPCService spawns alongside the app on connect
              // (out-of-process VideoToolbox). The avg decode time is the
              // permission-free heuristic: HW runs ~1-3ms/frame at our sizes,
              // software typically 5ms+.
              // eslint-disable-next-line no-console
              console.log(
                `[ps] video decoder: hidden by Chromium (no capture permission)${avgStr}` +
                ' — check for a VTDecoderXPCService process to confirm HW'
              );
              return;
            }
            const impl = r.decoderImplementation;
            const hw = /VideoToolbox|VDA|External|MediaCodec|hw/i.test(impl);
            // eslint-disable-next-line no-console
            console[hw ? 'log' : 'warn'](
              `[ps] video decoder: ${impl}${avgStr}${hw ? '' : ' (SOFTWARE decode: expect extra RAM + CPU)'}`
            );
          }
        });
        if (!seen) {
          // eslint-disable-next-line no-console
          console.warn('[ps] video decoder: no inbound video stats yet (stream not decoding?)');
        }
      } catch {
        // Diagnostic only, never let it interfere with the stream.
      }
    };

    // Dev-mode handles for DevTools: fire the viewport-res update when
    // diagnosing a layout-change miss, and query the decoder verdict on
    // demand (`await psDecoderCheck()`). Stripped in production builds by
    // Vite's dead-code elimination on import.meta.env.DEV.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).forceViewportUpdate = forceViewportResolutionUpdate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).psDecoderCheck = logDecoderImplementation;
    }

    ps.addEventListener('webRtcConnecting', () => setConnectionState('connecting'));
    ps.addEventListener('webRtcConnected', () => {
      setConnectionState('connected');
      // New session: forget the dedupe state so the first resolution send of
      // this connection always goes out on the wire.
      lastSentRes.w = 0;
      lastSentRes.h = 0;
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
              // Mac dual-audio: UE plays its own audio out of the Mac
              // speakers via CoreAudio at the same time it sends the
              // WebRTC audio track. Disable the track at the receiver so
              // the renderer is silent and Grace is only heard once
              // (from UE locally). track.enabled=false makes the WebRTC
              // stack render silence regardless of any video/audio
              // element's .muted state.
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
      // One-time decoder diagnostic ~4s after stream start (stats need a few
      // decoded frames before decoderImplementation populates). See
      // logDecoderImplementation for why this exists.
      setTimeout(() => void logDecoderImplementation(), 4000);
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

  // Arm a waiter for UE's `{EventType, status:"received"}` echo WITHOUT
  // sending anything. The dressing chain pipelines its descriptors over the
  // ordered data channel and only needs ONE liveness signal per run, so the
  // old sendAndAwaitAck (send + block per descriptor) became waitForAck
  // (observe only). Resolves true on ack, false on timeout / supersede /
  // unmount; never rejects, callers treat false as "UE stayed silent".
  //
  // Registration must happen BEFORE the send it observes, or a same-tick ack
  // could race past an unarmed waiter.
  const waitForAck = useCallback<UsePixelStreamingReturn['waitForAck']>(
    (eventType, timeoutMs = 1500) => {
      if (!psRef.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        // A previous waiter for this EventType is superseded: the router
        // only routes the LATEST ack per type, and the epoch system already
        // guarantees only one dressing chain is live at a time.
        const existing = pendingAcksRef.current.get(eventType);
        if (existing) existing(new Error('superseded by newer waiter'));

        const timer = setTimeout(() => {
          if (pendingAcksRef.current.get(eventType) === wrappedResolve) {
            pendingAcksRef.current.delete(eventType);
            resolve(false);
          }
        }, timeoutMs);

        const wrappedResolve = (err?: Error) => {
          clearTimeout(timer);
          resolve(!err);
        };

        pendingAcksRef.current.set(eventType, wrappedResolve);
      });
    },
    []
  );

  // Stuck-button guard.
  //
  // The PixelStreaming SDK binds mousedown/mouseup on the video parent
  // only. If the button goes down on the stream and comes up ANYWHERE
  // else , pointer dragged out of the window, or macOS yanking key
  // status from our floating always-on-top window mid-gesture , the
  // matching MouseUp is never sent and UE is left believing the button
  // is still held. From then on camera drags misbehave (UE is already
  // "dragging" and every fresh press is a no-op) while wheel-zoom keeps
  // working, since zoom never consults button state.
  //
  // Fix: watch for the release we would otherwise miss and synthesize a
  // mouseup on the video so the SDK's own handler translates it into a
  // real MouseUp for UE. Cheap (three listeners, no per-frame work) and
  // self-correcting , a spurious extra mouseup is harmless because UE
  // treats it as releasing an already-released button.
  useEffect(() => {
    const parent = videoParentRef.current;
    if (!parent) return undefined;

    // Which button is currently held on the stream, or -1 for none. Tracking the
    // actual button matters: releasing button 0 for what was a right-drag would
    // leave UE still holding the right button, which is the very state this
    // guard exists to prevent.
    let downButton = -1;

    const target = (): HTMLElement => parent.querySelector('video') ?? parent;

    const release = (x?: number, y?: number) => {
      if (downButton < 0) return;
      const button = downButton;
      downButton = -1;
      const el = target();
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button,
        // Clamp into the video so UE resolves a sane in-viewport coord.
        clientX: Math.min(Math.max(x ?? r.left + r.width / 2, r.left), r.right),
        clientY: Math.min(Math.max(y ?? r.top + r.height / 2, r.top), r.bottom),
      }));
    };

    const onDown = (e: MouseEvent) => { downButton = e.button; };
    const onUp = () => { downButton = -1; };
    // Button released outside the stream (or outside the window entirely).
    // Capture-phase, so it runs BEFORE the parent's own mouseup handler ,
    // hence the containment check: a release on the stream is the SDK's to
    // handle and only needs the flag cleared.
    const onWindowUp = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && parent.contains(t)) { downButton = -1; return; }
      release(e.clientX, e.clientY);
    };
    // Window lost focus mid-drag , no mouseup is coming at all.
    const onBlur = () => { release(); };

    parent.addEventListener('mousedown', onDown);
    parent.addEventListener('mouseup', onUp);
    window.addEventListener('mouseup', onWindowUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      parent.removeEventListener('mousedown', onDown);
      parent.removeEventListener('mouseup', onUp);
      window.removeEventListener('mouseup', onWindowUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [connectionState]);

  return {
    videoParentRef,
    connectionState,
    pixelStreaming: psRef.current,
    waitForAck,
  };
}
