import { useEffect, useRef, useState, useCallback } from 'react';
import { Config, PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface UsePixelStreamingOptions {
  signalingUrl: string;
  autoConnect?: boolean;
}

interface UsePixelStreamingReturn {
  videoParentRef: React.RefObject<HTMLDivElement | null>;
  connectionState: ConnectionState;
  pixelStreaming: PixelStreaming | null;
  connect: () => void;
  disconnect: () => void;
}

export function usePixelStreaming({
  signalingUrl,
  autoConnect = true,
}: UsePixelStreamingOptions): UsePixelStreamingReturn {
  const videoParentRef = useRef<HTMLDivElement | null>(null);
  const psRef = useRef<PixelStreaming | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  // Initialize PixelStreaming once the video parent DOM element is ready
  useEffect(() => {
    if (!videoParentRef.current) return;

    const config = new Config({
      initialSettings: {
        AutoPlayVideo: true,
        AutoConnect: autoConnect,
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

    // Connection lifecycle events
    ps.addEventListener('webRtcConnecting', () => {
      setConnectionState('connecting');
    });

    ps.addEventListener('webRtcConnected', () => {
      setConnectionState('connected');
    });

    ps.addEventListener('webRtcDisconnected', () => {
      setConnectionState('disconnected');
    });

    ps.addEventListener('webRtcFailed', () => {
      setConnectionState('failed');
    });

    return () => {
      ps.disconnect();
      psRef.current = null;
    };
  }, [signalingUrl, autoConnect]);

  const connect = useCallback(() => {
    psRef.current?.connect();
    setConnectionState('connecting');
  }, []);

  const disconnect = useCallback(() => {
    psRef.current?.disconnect();
    setConnectionState('disconnected');
  }, []);

  return {
    videoParentRef,
    connectionState,
    pixelStreaming: psRef.current,
    connect,
    disconnect,
  };
}
