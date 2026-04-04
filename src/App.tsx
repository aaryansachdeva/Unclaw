import { useState, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { StreamView } from './components/StreamView';
import { InputBar } from './components/InputBar';
import { AgentSwitcher } from './components/AgentSwitcher';
import { usePixelStreaming } from './hooks/usePixelStreaming';
import { callAI } from './services/ai';
import { sendDescriptor } from './services/descriptors';
import { AGENTS } from './types';

const SIGNALING_URL = 'ws://localhost:8080';

export function App() {
  const { videoParentRef, connectionState, pixelStreaming } = usePixelStreaming({
    signalingUrl: SIGNALING_URL,
  });

  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);

  const handleAgentSwitch = useCallback((newIndex: number) => {
    setCurrentAgentIndex(newIndex);
    pixelStreaming?.emitUIInteraction({
      EventType: 'agentSwitched',
      AgentId: newIndex,
      Agent: AGENTS[newIndex],
      Timestamp: new Date().toISOString(),
    });
  }, [pixelStreaming]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (isSending) return;
    setIsSending(true);

    try {
      const agent = AGENTS[currentAgentIndex];
      const response = await callAI(message, agent);

      if (response.success && pixelStreaming) {
        sendDescriptor(pixelStreaming, response);
      }
    } finally {
      setIsSending(false);
    }
  }, [currentAgentIndex, pixelStreaming, isSending]);

  const isConnected = connectionState === 'connected';

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <StreamView
        videoParentRef={videoParentRef}
        connectionState={connectionState}
      />
      <Titlebar />

      <div
        className="absolute bottom-0 left-0 right-0 z-30"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '0 14px 14px 14px',
        }}
      >
        <AgentSwitcher
          agents={AGENTS}
          currentIndex={currentAgentIndex}
          onSwitch={handleAgentSwitch}
          disabled={!isConnected}
        />
        <div style={{ width: '100%' }}>
          <InputBar
            onSendMessage={handleSendMessage}
            disabled={!isConnected || isSending}
          />
        </div>
      </div>
    </div>
  );
}
