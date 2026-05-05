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
}

export function usePixelStreaming({
  signalingUrl,
  retryDelay = 3000,
}: UsePixelStreamingOptions): UsePixelStreamingReturn {
  const videoParentRef = useRef<HTMLDivElement | null>(null);
  const psRef = useRef<PixelStreaming | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!videoParentRef.current) return;

    const config = new Config({
      initialSettings: {
        AutoPlayVideo: true,
        AutoConnect: true,
        StartVideoMuted: false,
        HoveringMouse: true,
        WaitForStreamer: true,
        MatchViewportRes: false,
        ss: signalingUrl,
      },
    });

    const ps = new PixelStreaming(config, {
      videoElementParent: videoParentRef.current,
    });

    psRef.current = ps;

    const scheduleRetry = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (psRef.current) {
          setConnectionState('connecting');
          psRef.current.reconnect();
        }
      }, retryDelay);
    };

    ps.addEventListener('webRtcConnecting', () => setConnectionState('connecting'));
    ps.addEventListener('webRtcConnected', () => {
      setConnectionState('connected');
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
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
      ps.disconnect();
      psRef.current = null;
    };
  }, [signalingUrl, retryDelay]);

  return {
    videoParentRef,
    connectionState,
    pixelStreaming: psRef.current,
  };
}
