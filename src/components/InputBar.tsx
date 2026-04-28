import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, Square } from 'lucide-react';

const PROMPTS = [
  'Ask me anything...',
  'How was your day?',
  'Tell me a story',
  'What are you thinking about?',
  'Tell me about your dreams',
  'Dance for me',
  'What fascinates you?',
  'Give me a kiss',
  'Tell me about space',
  'What makes you happy?',
];

interface InputBarProps {
  onSendMessage: (message: string) => void;
  /** Disables the textarea and the send button. The mic stays usable. */
  disabled?: boolean;
  /**
   * Disables the mic button specifically. Default false — even when
   * `disabled` is true (e.g. PS not connected yet) the user can still
   * toggle voice mode and see indicator state.
   */
  micDisabled?: boolean;
  /**
   * True while voice mode is active (mic open). When set, the mic button
   * shows the "listening" state instead of the start-recording state.
   */
  voiceActive?: boolean;
  /**
   * Called when the mic button is clicked. The host (App.tsx) toggles
   * the underlying continuous voice agent.
   */
  onToggleVoice?: () => void;
}

export function InputBar({
  onSendMessage,
  disabled = false,
  micDisabled = false,
  voiceActive = false,
  onToggleVoice,
}: InputBarProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // Local fallback when no host-driven voice toggle is wired.
  const [localRecording, setLocalRecording] = useState(false);
  const isRecording = onToggleVoice ? voiceActive : localRecording;

  const [currentPrompt, setCurrentPrompt] = useState('');
  const [promptVisible, setPromptVisible] = useState(true);
  const promptIdx = useRef(Math.floor(Math.random() * PROMPTS.length));
  const paused = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const cyclePlaceholder = useCallback(() => {
    if (paused.current) return;
    const fullText = PROMPTS[promptIdx.current % PROMPTS.length];
    let charIdx = 0;
    setPromptVisible(true);
    setCurrentPrompt('');

    const typeChar = () => {
      if (paused.current) return;
      charIdx++;
      if (charIdx <= fullText.length) {
        setCurrentPrompt(fullText.slice(0, charIdx));
        timerRef.current = setTimeout(typeChar, 40 + Math.random() * 20);
      } else {
        timerRef.current = setTimeout(() => {
          if (paused.current) return;
          setPromptVisible(false);
          timerRef.current = setTimeout(() => {
            promptIdx.current++;
            cyclePlaceholder();
          }, 600);
        }, 4500);
      }
    };
    timerRef.current = setTimeout(typeChar, 300);
  }, []);

  useEffect(() => {
    cyclePlaceholder();
    return () => clearTimeout(timerRef.current);
  }, [cyclePlaceholder]);

  useEffect(() => {
    if (message) {
      paused.current = true;
      clearTimeout(timerRef.current);
      setPromptVisible(false);
    } else if (paused.current) {
      paused.current = false;
      promptIdx.current++;
      cyclePlaceholder();
    }
  }, [message, cyclePlaceholder]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '22px';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [message]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || disabled) return;
    onSendMessage(text);
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Tab' && currentPrompt && !message) { e.preventDefault(); setMessage(currentPrompt); }
  };

  const hasText = message.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'relative',
        borderRadius: '18px',
        background: isFocused ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: `1px solid ${isFocused ? 'var(--glass-border-focus)' : 'var(--glass-border)'}`,
        transition: 'background 0.25s var(--ease-out-quart), border-color 0.3s var(--ease-out-quart)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '10px',
          padding: '13px 13px 13px 22px',
          minHeight: '52px',
        }}
      >
        <div style={{ flex: 1, position: 'relative', minWidth: 0, alignSelf: 'center' }}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled}
            rows={1}
            aria-label="Message input"
            style={{
              display: 'block', width: '100%', background: 'transparent',
              border: 'none', outline: 'none', resize: 'none', overflow: 'hidden',
              fontSize: '14px', lineHeight: '22px',
              color: 'rgba(255,255,255,0.92)', caretColor: 'var(--accent)',
              opacity: disabled ? 0.3 : 1,
              fontFamily: 'inherit', fontWeight: 400, letterSpacing: '0.01em',
              padding: 0, margin: 0,
            }}
          />
          {!message && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '22px',
                display: 'flex', alignItems: 'center',
                pointerEvents: 'none', userSelect: 'none',
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                fontSize: '14px', lineHeight: '22px', fontWeight: 400,
                letterSpacing: '0.01em', color: 'rgba(255,255,255,0.25)',
                opacity: promptVisible ? 1 : 0,
                transition: 'opacity 0.4s var(--ease-out-quart)',
              }}>
                {currentPrompt}
              </span>
            </div>
          )}
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {hasText ? (
            <motion.button
              key="send"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleSend}
              disabled={disabled}
              aria-label="Send message"
              className="glass-btn"
              style={{
                flexShrink: 0, width: '36px', height: '36px',
                borderRadius: '11px',
                background: 'rgba(255, 255, 255, 0.12)',
                color: 'var(--text-primary)',
              }}
            >
              <Send size={14} strokeWidth={2} style={{ transform: 'translateX(0.5px) translateY(-0.5px)' }} />
            </motion.button>
          ) : (
            <motion.button
              key="mic"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                if (onToggleVoice) onToggleVoice();
                else setLocalRecording(r => !r);
              }}
              disabled={micDisabled}
              aria-label={isRecording ? 'Stop voice mode' : 'Start voice mode'}
              className="glass-btn"
              style={{
                flexShrink: 0, width: '36px', height: '36px',
                borderRadius: '11px',
                background: isRecording ? 'rgba(200,122,122,0.12)' : 'rgba(255,255,255,0.06)',
                opacity: micDisabled ? 0.25 : 1,
                animation: isRecording ? 'breathe 2.5s ease-in-out infinite' : 'none',
                position: 'relative', overflow: 'visible',
              }}
            >
              {isRecording ? (
                <motion.div
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Square size={11} fill="var(--danger)" color="var(--danger)" />
                </motion.div>
              ) : (
                <Mic
                  size={15}
                  strokeWidth={1.8}
                  style={{
                    color: isFocused ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.28)',
                    transition: 'color 0.2s ease',
                  }}
                />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
