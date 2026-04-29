import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Plus, AudioWaveform } from 'lucide-react';

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
  /** Disables the voice button specifically (e.g. while a chat is in flight). */
  micDisabled?: boolean;
  /** True while continuous voice mode is active (mic open, VAD running). */
  voiceActive?: boolean;
  /** Toggle continuous voice mode. */
  onToggleVoice?: () => void;
  /** Smoothed VAD probability [0, 1]. Drives the bars inside the voice button. */
  vadLevel?: number;
  /** True while user is currently speaking (used to color the bars). */
  isUserSpeaking?: boolean;
  /** True while a transcription request is in flight (drives the wave anim). */
  isTranscribing?: boolean;
}

export function InputBar({
  onSendMessage,
  disabled = false,
  micDisabled = false,
  voiceActive = false,
  onToggleVoice,
  vadLevel = 0,
  isUserSpeaking = false,
  isTranscribing = false,
}: InputBarProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [plusHover, setPlusHover] = useState(false);

  const [currentPrompt, setCurrentPrompt] = useState('');
  const [promptVisible, setPromptVisible] = useState(true);
  const promptIdx = useRef(Math.floor(Math.random() * PROMPTS.length));
  const paused = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
        borderRadius: '24px',
        background: isFocused ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: `1px solid ${isFocused ? 'var(--glass-border-focus)' : 'var(--glass-border)'}`,
        transition: 'background 0.25s var(--ease-out-quart), border-color 0.3s var(--ease-out-quart)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 8px 8px 8px',
          minHeight: '52px',
        }}
      >
        {/* + button (left). No functionality wired yet — the hover
            tooltip and visual presence match the target design;
            click handlers come later when file-attach lands. */}
        <PlusButton
          hovered={plusHover}
          onHoverChange={setPlusHover}
        />

        <div
          style={{
            flex: 1,
            position: 'relative',
            minWidth: 0,
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
          }}
        >
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
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
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

        {/* Right cluster: send (when text) OR voice button (when empty).
            They swap through AnimatePresence so the layout doesn't
            shift sideways. */}
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
            <VoiceButton
              key="voice"
              active={voiceActive}
              disabled={micDisabled}
              vadLevel={vadLevel}
              isUserSpeaking={isUserSpeaking}
              isTranscribing={isTranscribing}
              onClick={() => onToggleVoice?.()}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------
// + button with hover tooltip
// ---------------------------------------------------------------------

function PlusButton({
  hovered,
  onHoverChange,
}: {
  hovered: boolean;
  onHoverChange: (h: boolean) => void;
}) {
  return (
    <div
      style={{ position: 'relative', flexShrink: 0 }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        type="button"
        aria-label="Add files and more"
        className="glass-btn"
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.55)',
          transition: 'background 0.2s var(--ease-out-quart), color 0.2s var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
        }}
      >
        <Plus size={16} strokeWidth={2.2} />
      </motion.button>

      <AnimatePresence>
        {hovered && (
          <motion.div
            key="plus-tooltip"
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 8px',
              background: 'rgba(20, 20, 20, 0.94)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.92)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              zIndex: 5,
            }}
          >
            <span>Add files and more</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '14px',
                height: '14px',
                padding: '0 4px',
                background: 'rgba(255,255,255,0.10)',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              /
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------
// Voice button — circular toggle that doubles as the live voice viz.
// When inactive: plain wave glyph. When active: bars react to vadLevel
// (or wave through a phase-offset keyframe during transcription).
// ---------------------------------------------------------------------

const NUM_BARS = 4;
const BAR_GAP = 2;
const BAR_W = 2;
const BAR_MIN = 2;
const BAR_MAX = 12;
const BAR_FALLOFF = 0.18;
// Symmetric per-bar delays so the wave reads as edge → center → edge.
const WAVE_DELAYS = [0, 90, 90, 0];
const WAVE_DURATION_MS = 900;

function VoiceButton({
  active,
  disabled,
  vadLevel,
  isUserSpeaking,
  isTranscribing,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  vadLevel: number;
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  onClick: () => void;
}) {
  // Active = voice mode is on. Inside the active state we still show
  // three sub-states (idle, speaking, transcribing) via bar color.
  const showBars = active;

  // Ring color cues current sub-state on the active button.
  const ringColor = isTranscribing
    ? 'var(--accent)'
    : isUserSpeaking
      ? 'var(--live)'
      : 'rgba(255,255,255,0.35)';

  const barColor = isTranscribing
    ? 'rgba(40, 20, 20, 0.85)'    // dark red on the white face
    : isUserSpeaking
      ? 'rgba(20, 50, 28, 0.85)'  // dark green
      : 'rgba(20, 20, 20, 0.55)'; // plain dark grey

  return (
    <motion.button
      key="voice"
      type="button"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.7, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={active ? 'Stop voice mode' : 'Start voice mode'}
      style={{
        flexShrink: 0,
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: active ? '#ffffff' : 'rgba(255,255,255,0.92)',
        border: `1px solid ${active ? ringColor : 'rgba(255,255,255,0.0)'}`,
        boxShadow: active
          ? `0 0 0 2px color-mix(in srgb, ${ringColor} 35%, transparent), 0 2px 8px rgba(0,0,0,0.25)`
          : '0 2px 8px rgba(0,0,0,0.20)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition: 'background 0.25s var(--ease-out-quart), box-shadow 0.25s var(--ease-out-quart), border-color 0.25s var(--ease-out-quart)',
      }}
    >
      {showBars ? (
        <MiniBars
          vadLevel={vadLevel}
          isTranscribing={isTranscribing}
          color={barColor}
        />
      ) : (
        <AudioWaveform
          size={16}
          strokeWidth={2.2}
          color="rgba(20, 20, 20, 0.85)"
        />
      )}
    </motion.button>
  );
}

function MiniBars({
  vadLevel,
  isTranscribing,
  color,
}: {
  vadLevel: number;
  isTranscribing: boolean;
  color: string;
}) {
  const totalW = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP;
  const center = (NUM_BARS - 1) / 2;
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${BAR_GAP}px`,
        height: `${BAR_MAX}px`,
        width: `${totalW}px`,
      }}
    >
      {Array.from({ length: NUM_BARS }).map((_, i) => {
        const distance = Math.abs(i - center) / center;
        const local = Math.max(0, Math.min(1, vadLevel - distance * BAR_FALLOFF));
        const liveHeight = BAR_MIN + local * (BAR_MAX - BAR_MIN);
        const transcribeHeight = BAR_MAX;
        return (
          <div
            key={i}
            style={{
              width: `${BAR_W}px`,
              height: `${isTranscribing ? transcribeHeight : liveHeight}px`,
              borderRadius: '1px',
              background: color,
              transformOrigin: 'center',
              animation: isTranscribing
                ? `voice-bar-wave ${WAVE_DURATION_MS}ms ease-in-out ${WAVE_DELAYS[i]}ms infinite`
                : undefined,
              transition: isTranscribing
                ? 'background 250ms var(--ease-out-quart)'
                : 'height 80ms var(--ease-out-quart), background 250ms var(--ease-out-quart)',
            }}
          />
        );
      })}
    </div>
  );
}
