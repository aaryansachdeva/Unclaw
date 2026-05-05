// Bottom input row. Frosted-slate pill with three zones, left → right:
//
//   [ + ] | [ Ask anything... ] | [ 🎙️ ]
//
// The widget icons are NOT in here anymore — they live in WidgetRail
// on the right edge of the window. The slash-menu still anchors above
// this bar, and `/news`, `/weather`, `/stocks`, `/reminders`, `/dance`,
// `/kiss`, `/hello`, `/clear` all work from the input.

import {
  forwardRef,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import {
  Plus, ArrowRight, ChevronLeft, ChevronRight, Pencil, RotateCcw,
  PanelRightOpen, PanelRightClose, Eraser,
} from 'lucide-react';

import { SheetKey } from '../hooks/useSheet';
import { SlashItem, useSlashCommands } from '../hooks/useSlashCommands';
import { SlashMenu } from './SlashMenu';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

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

export interface InputVoiceState {
  active: boolean;
  disabled: boolean;
  vadLevel: number;
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  toggle: () => void;
}

interface InputBarProps {
  personaName: string;
  isSending: boolean;
  disabled: boolean;
  /** True when the user has at least one attachment staged (e.g. a
   *  screenshot). Lets send fire with empty text — the attachment
   *  itself becomes the message. */
  hasAttachments?: boolean;
  onSendMessage: (message: string) => void;
  /** Open/close a sheet (slash command target). */
  onOpenSheet: (key: SheetKey) => void;
  /** Slash-command animation dispatcher. */
  onDispatchAnimation: (
    name: 'give_a_kiss' | 'do_dance' | 'say_hello' | 'react_as_star_wars_fan',
  ) => void;
  /** Slash command for /clear. */
  onClearMemory: () => void;
  /** Reopen the onboarding wizard. Backs the pencil button next to the
   *  persona switcher and the /onboard slash command. */
  onOpenOnboarding: () => void;
  /** Wipe the saved profile and restart the wizard from scratch. Backs
   *  the temporary reset button next to the pencil. */
  onResetProfile: () => void;
  /** Fire a Text2Face-only probe with an emotion prompt. Backs the
   *  /express <emotion> slash command. */
  onExpress: (emotion: string) => void;
  voice: InputVoiceState;
  /** When true, the input bar shows its voice-active visual state
   *  (accent border + halo) and disables manual editing of the
   *  textarea. The textarea content is driven imperatively by
   *  App.tsx (`setText`) on every streaming partial — so words land
   *  directly in the same surface the user types into, no separate
   *  view. */
  voiceActive?: boolean;
  /** Unconfirmed model output — what voice has heard but the
   *  LocalAgreement-2 algorithm hasn't promoted to committed yet.
   *  Renders as a light-gray overlay sitting on top of the
   *  textarea, positioned right after the textarea's actual content
   *  via an invisible spacer that mirrors `message`. Gives the user
   *  immediate visual feedback while words are still firming up,
   *  without polluting the textarea's editable content. */
  voiceTentative?: string;
  /** Persona switcher — chevron-prev / chevron-next, inline in row 2. */
  onPrevPersona: () => void;
  onNextPersona: () => void;
  /** Disable the persona switcher when stream isn't connected. */
  personaDisabled?: boolean;
  /** Called when the user pastes an image into the textarea. Each
   *  pasted image is normalized to PNG, base64-encoded (no data-URL
   *  prefix), and reported with its natural dimensions so it can be
   *  attached alongside Ctrl+Shift+G screenshots. */
  onPasteImage?: (img: { base64: string; width: number; height: number }) => void;
  /** Whether the chat-history side pane is currently open. Drives the
   *  expand button's icon (PanelRightOpen ↔ PanelRightClose). */
  chatPaneOpen?: boolean;
  /** Toggle the chat-history side pane. Pane lives in App.tsx; the
   *  input bar just exposes the affordance. */
  onToggleChatPane?: () => void;
}

/** Imperative API for the parent — used by App.tsx to drive the
 *  textarea content during voice push-to-talk. The textarea is the
 *  one canonical surface; voice mode just streams characters into it
 *  past whatever the user already typed. */
export interface InputBarHandle {
  /** Read the textarea's current content. Used to snapshot the
   *  "baseline" text immediately before voice activates so partial
   *  voice updates can rebuild "baseline + voice-portion" without
   *  ever clobbering the user's typed content. */
  getText(): string;
  /** Replace the textarea content. Triggers auto-grow + placeholder
   *  pause via the existing `message` effects. */
  setText(text: string): void;
  /** Move keyboard focus to the textarea. */
  focus(): void;
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar({
  personaName,
  isSending,
  disabled,
  hasAttachments = false,
  onSendMessage,
  onOpenSheet,
  onDispatchAnimation,
  onClearMemory,
  onOpenOnboarding,
  onResetProfile,
  onExpress,
  voice,
  voiceActive = false,
  voiceTentative = '',
  onPrevPersona,
  onNextPersona,
  personaDisabled = false,
  onPasteImage,
  chatPaneOpen = false,
  onToggleChatPane,
}, forwardedRef) {
  const reduce = useReducedMotion() ?? false;
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [pulse, setPulse] = useState<'none' | 'submit' | 'sweep'>('none');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasSendingRef = useRef(false);
  // Mirror of `message` in a ref — `getText()` needs to expose the
  // latest value synchronously, and React state setters don't.
  const messageRef = useRef('');
  messageRef.current = message;

  // Imperative API — App.tsx drives textarea content during voice.
  // Voice activation flow:
  //   1. App calls getText() to snapshot the baseline (and to
  //      compute the stripped baseline for long-press-in-textarea
  //      activations — App does the strip itself synchronously to
  //      avoid the React-state-update race that would otherwise
  //      let trailing spaces survive into the next utterance).
  //   2. App calls setText() with whatever the textarea should show
  //      (committed text only — tentative renders inline via the
  //      mirror overlay above, driven by the voiceTentative prop).
  //   3. focus() returns keyboard focus to the textarea so the user
  //      can edit immediately after a voice session.
  useImperativeHandle(forwardedRef, () => ({
    getText: () => messageRef.current,
    setText: (text: string) => {
      setMessage(text);
    },
    focus: () => {
      textareaRef.current?.focus();
      const el = textareaRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    },
  }), []);

  // Cycling placeholder (typewriter).
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [promptVisible, setPromptVisible] = useState(true);
  const promptIdx = useRef(Math.floor(Math.random() * PROMPTS.length));
  const paused = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  // Pause cycling while the user is typing OR while AI is producing.
  useEffect(() => {
    const shouldPause = !!message || isSending;
    if (shouldPause) {
      paused.current = true;
      clearTimeout(timerRef.current);
      setPromptVisible(false);
    } else if (paused.current) {
      paused.current = false;
      promptIdx.current++;
      cyclePlaceholder();
    }
  }, [message, isSending, cyclePlaceholder]);

  // Auto-grow the textarea up to ~10 lines. Tall enough to handle
  // dictated multi-sentence prompts comfortably, capped so the bar
  // never eats the whole window. Beyond the cap we let the textarea
  // scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '22px';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [message]);

  // Fire the AI-response sweep when isSending flips off.
  useEffect(() => {
    if (wasSendingRef.current && !isSending) {
      setPulse('sweep');
      const id = window.setTimeout(() => setPulse('none'), 240);
      wasSendingRef.current = isSending;
      return () => window.clearTimeout(id);
    }
    wasSendingRef.current = isSending;
    return undefined;
  }, [isSending]);

  // Slash commands. Actions are bundled into one `actions` bag the
  // registry's command implementations call. After any action fires
  // we clear the textarea; the existing useEffect watching slash.query
  // handles the highlight reset on the next slash session.
  const slash = useSlashCommands({
    value: message,
    actions: useMemo(() => ({
      onOpenSheet: (key) => {
        onOpenSheet(key);
        setMessage('');
      },
      onDispatchAnimation: (name) => {
        onDispatchAnimation(name);
        setMessage('');
      },
      onClearMemory: () => {
        onClearMemory();
        setMessage('');
      },
      onOpenOnboarding: () => {
        onOpenOnboarding();
        setMessage('');
      },
      onExpress: (emotion) => {
        onExpress(emotion);
        setMessage('');
      },
    }), [
      onOpenSheet, onDispatchAnimation, onClearMemory,
      onOpenOnboarding, onExpress,
    ]),
  });
  const slashReset = slash.reset;
  useEffect(() => {
    if (slash.active) slashReset();
  }, [slash.active, slash.query, slashReset]);

  const handleSend = useCallback(() => {
    if (slash.active && slash.items.length > 0) {
      slash.select();
      return;
    }
    const text = message.trim();
    // Allow image-only sends: when the user has staged a screenshot
    // (or several) we let Enter fire with no text — the attachment
    // is the message. Otherwise require text. Guard against double-
    // fires while a send is in flight without clearing keystrokes.
    if ((!text && !hasAttachments) || disabled || isSending) return;
    onSendMessage(text);
    setMessage('');
    setPulse('submit');
    window.setTimeout(() => setPulse('none'), 280);
  }, [slash, message, hasAttachments, disabled, isSending, onSendMessage]);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.active) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slash.navigateDown(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slash.navigateUp(); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMessage(''); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (slash.items.length > 0) slash.select();
        return;
      }
      if (e.key === 'Tab' && slash.items.length > 0) {
        e.preventDefault();
        // tabKey() returns:
        //   * a string → autocomplete the textarea to it (args command)
        //   * null     → it already executed (no-args command), clear input
        //   * undefined → nothing actionable (e.g. already in args mode)
        const next = slash.tabKey();
        if (typeof next === 'string') {
          setMessage(next);
        } else if (next === null) {
          setMessage('');
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'Tab' && currentPrompt && !message) {
      e.preventDefault();
      setMessage(currentPrompt);
    }
  }, [slash, currentPrompt, message, handleSend]);

  const handleSlashSelect = useCallback((item: SlashItem) => {
    slash.select(item);
    textareaRef.current?.focus();
  }, [slash]);

  // Paste-to-attach: when the user Ctrl+Vs into the textarea and the
  // clipboard carries an image (copied from a browser, Snipping Tool,
  // Figma, anywhere), short-circuit the default text paste and stage
  // each image as an attachment. Multiple images in one paste all get
  // attached. Non-image clipboard payloads fall through to the
  // browser's default paste so plain text still works.
  //
  // We normalize every image to PNG via a canvas roundtrip so the
  // backend can always assume `image/png` regardless of what format
  // the source app put on the clipboard (JPEG, WEBP, GIF, etc.).
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onPasteImage) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const imageItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          imageItems.push(it);
        }
      }
      if (imageItems.length === 0) return; // text paste — let it through
      e.preventDefault();
      for (const it of imageItems) {
        const blob = it.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          if (typeof dataUrl !== 'string') return;
          const img = new Image();
          img.onload = () => {
            // Re-encode as PNG via canvas so the backend can rely on
            // `data:image/png;base64,...` regardless of source format.
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);
            const pngDataUrl = canvas.toDataURL('image/png');
            const base64 = pngDataUrl.split(',')[1] ?? '';
            if (!base64) return;
            onPasteImage({
              base64,
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
      }
    },
    [onPasteImage],
  );

  const handleSlashHover = useCallback((i: number) => {
    if (i === slash.highlightedIndex) return;
    if (i < slash.highlightedIndex) {
      for (let n = slash.highlightedIndex - i; n > 0; n--) slash.navigateUp();
    } else {
      for (let n = i - slash.highlightedIndex; n > 0; n--) slash.navigateDown();
    }
  }, [slash]);

  const hasText = message.trim().length > 0;
  // Show the send button when there's text OR a staged attachment.
  // Attachment-only sends are valid (image-only chat about a screenshot).
  const canSend = hasText || hasAttachments;

  // Border tint reflects the pulse state; submit + sweep both warm it
  // briefly to the accent so the user sees acknowledgement. Voice
  // active overrides everything else with a saturated accent so
  // the user has unambiguous feedback that they're being heard.
  const surfaceBorder = voiceActive
    ? 'var(--accent)'
    : pulse === 'submit'
      ? 'var(--accent-strong)'
      : pulse === 'sweep'
        ? 'var(--accent-strong)'
        : isFocused
          ? 'var(--glass-border-focus)'
          : 'var(--glass-border)';

  const surfaceBoxShadow = voiceActive
    ? '0 1px 0 rgba(255,255,255,0.10) inset, 0 8px 28px -8px rgba(0,0,0,0.40), 0 0 24px -4px rgba(196, 68, 68, 0.45)'
    : '0 1px 0 rgba(255,255,255,0.10) inset, 0 8px 28px -8px rgba(0,0,0,0.40)';

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.32, ease: EASE_OUT_EXPO }}
      style={{
        position: 'relative',
        width: '100%',
        // 24px (Tailwind `rounded-3xl`) — matches the old project's
        // bar exactly. Less aggressive than a full pill, reads as
        // a soft-edged rectangle rather than capsule.
        borderRadius: 24,
        background: isFocused
          ? 'rgba(255, 255, 255, 0.14)'
          : 'rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(32px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
        border: `1px solid ${surfaceBorder}`,
        boxShadow: surfaceBoxShadow,
        transition:
          'background 0.25s var(--ease-out-quart), border-color 0.25s var(--ease-out-quart), box-shadow 0.25s var(--ease-out-quart)',
        overflow: 'hidden',
      }}
    >
      {/* AI-response gradient sweep. One-shot accent wash crossing
          left → right when the AI's reply lands. */}
      <AnimatePresence>
        {pulse === 'sweep' && (
          <motion.span
            key="sweep"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 22,
              background:
                'linear-gradient(90deg, transparent 0%, var(--accent-glow) 50%, transparent 100%)',
              animation: 'dock-ai-sweep 800ms ease-out forwards',
              pointerEvents: 'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* Two-row layout: textarea on top (full width), agent switcher
          + action cluster on the bottom — modeled after the old
          project's input bar. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 14px 10px 22px',
          gap: 8,
          minHeight: 64,
        }}
      >
        {/* Row 1: textarea (the surface, always). When voiceActive,
            it goes read-only and App.tsx drives content via the
            imperative setText handle — words land directly in the
            same field the user types into, no separate view, no
            swap, no flash. */}
        <div
          style={{
            position: 'relative',
            minHeight: 22,
            display: 'flex',
            alignItems: 'flex-start',
            width: '100%',
          }}
        >
          {/* Visible mirror overlay. Renders the textarea's committed
              text PLUS any voice tentative text inline-merged in
              light gray. Sits BEHIND the textarea (z-index < textarea)
              and shares font/line-height/padding so its wrapping
              matches the textarea's exactly — when the user types or
              voice commits, the textarea's transparent characters
              occupy the same columns as the mirror's visible ones,
              so the cursor caret lands in the right spot. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              fontSize: 14,
              lineHeight: '22px',
              fontWeight: 400,
              letterSpacing: '0.01em',
              fontFamily: 'inherit',
              color: 'var(--text-primary)',
              opacity: disabled ? 0.45 : 1,
              userSelect: 'none',
              zIndex: 1,
            }}
          >
            {message}
            {voiceActive && voiceTentative && (
              <>
                {message && !message.endsWith(' ') ? ' ' : ''}
                <span style={{ color: 'rgba(255, 255, 255, 0.40)' }}>
                  {voiceTentative}
                </span>
              </>
            )}
            {/* Slash-command ghost-text autocomplete. Only shows when
                there's a single best match the user is in the middle
                of typing — sits flush against the typed text so the
                user reads "/e" + light "xpress " as one word. Press
                Tab to accept (autocomplete or execute). */}
            {!voiceActive && slash.completion && (
              <span style={{ color: 'rgba(255, 255, 255, 0.32)' }}>
                {slash.completion}
              </span>
            )}
            {/* Trailing newline so a textarea ending with '\n' (the
                user pressed Shift+Enter on a fresh line) still creates
                a visible blank line in the mirror. */}
            {message.endsWith('\n') ? '​' : ''}
          </div>

          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              if (voiceActive) return;
              setMessage(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled}
            readOnly={voiceActive}
            rows={1}
            aria-label="Message input"
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'block',
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              overflow: 'auto',
              fontSize: 14,
              lineHeight: '22px',
              // Text itself transparent — the mirror above renders
              // visible characters. caretColor keeps the cursor
              // visible so typing/IME/selection still feel native.
              color: 'transparent',
              caretColor: 'var(--accent)',
              opacity: disabled ? 0.45 : 1,
              fontFamily: 'inherit',
              fontWeight: 400,
              letterSpacing: '0.01em',
              padding: 0,
              margin: 0,
            }}
          />
          {!message && !isSending && !voiceActive && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
                userSelect: 'none',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  lineHeight: '22px',
                  fontWeight: 400,
                  letterSpacing: '0.01em',
                  color: 'rgba(255, 255, 255, 0.32)',
                  opacity: promptVisible ? 1 : 0,
                  transition: 'opacity 0.4s var(--ease-out-quart)',
                }}
              >
                {currentPrompt}
              </span>
            </div>
          )}
        </div>

        {/* Row 2: agent switcher (left) + action cluster (right) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Inline agent switcher */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              opacity: personaDisabled ? 0.4 : 1,
              transition: 'opacity 0.25s var(--ease-out-quart)',
            }}
          >
            <InlineChevron
              direction="prev"
              onClick={onPrevPersona}
              disabled={personaDisabled}
            />
            <div
              style={{
                minWidth: 64,
                textAlign: 'center',
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: '0.01em',
                color: 'var(--text-primary)',
              }}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={personaName}
                  initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                  style={{ display: 'inline-block' }}
                >
                  {personaName}
                </motion.span>
              </AnimatePresence>
            </div>
            <InlineChevron
              direction="next"
              onClick={onNextPersona}
              disabled={personaDisabled}
            />
          </div>

          {/* Edit-profile pencil — sits next to the persona switcher.
              Reopens the onboarding wizard with the current values
              prefilled. Same affordance the /onboard slash command
              triggers. */}
          <button
            type="button"
            onClick={onOpenOnboarding}
            aria-label="Edit profile"
            title="Edit profile"
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-ghost)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--glass-bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-ghost)';
            }}
          >
            <Pencil size={12} strokeWidth={2.2} />
          </button>

          {/* TEMPORARY: reset profile + re-run onboarding from scratch.
              Sits next to the pencil so it's a one-click test path
              while we iterate. Will likely move to a settings menu
              once the wizard's stable. */}
          <button
            type="button"
            onClick={onResetProfile}
            aria-label="Reset profile and re-run onboarding"
            title="Reset profile (re-run onboarding)"
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-ghost)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--glass-bg-hover)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-ghost)';
            }}
          >
            <RotateCcw size={12} strokeWidth={2.2} />
          </button>

          {/* Clear conversation history — same handler as the /clear
              slash command. Confirms before wiping. Replaces the
              titlebar gear's old "Clear conversation" row. */}
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm(
                personaName
                  ? `Clear conversation history with ${personaName}?`
                  : 'Clear conversation history?',
              );
              if (ok) onClearMemory();
            }}
            aria-label="Clear conversation history"
            title="Clear conversation"
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-ghost)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--glass-bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-ghost)';
            }}
          >
            <Eraser size={12} strokeWidth={2.2} />
          </button>

          {/* Chat-pane expand toggle. Opens the gray history pane on
              the right side, which physically pushes the stream in.
              Icon flips between open/close based on pane state. */}
          {onToggleChatPane && (
            <button
              type="button"
              onClick={onToggleChatPane}
              aria-label={chatPaneOpen ? 'Close chat history' : 'Open chat history'}
              aria-pressed={chatPaneOpen}
              title={chatPaneOpen ? 'Close chat history' : 'Open chat history'}
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 6,
                background: chatPaneOpen ? 'var(--glass-bg-hover)' : 'transparent',
                border: 'none',
                color: chatPaneOpen ? 'var(--text-primary)' : 'var(--text-ghost)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => {
                if (chatPaneOpen) return;
                e.currentTarget.style.background = 'var(--glass-bg-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                if (chatPaneOpen) return;
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-ghost)';
              }}
            >
              {chatPaneOpen ? (
                <PanelRightClose size={12} strokeWidth={2.2} />
              ) : (
                <PanelRightOpen size={12} strokeWidth={2.2} />
              )}
            </button>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Right action cluster: + button always; send when text,
              voice when empty (same 36x36 slot crossfades). */}
          <PlusButton />
          <div
            style={{
              position: 'relative',
              flexShrink: 0,
              width: 36,
              height: 36,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: canSend ? 0 : 1,
                transform: canSend ? 'scale(0.94)' : 'scale(1)',
                pointerEvents: canSend ? 'none' : 'auto',
                transition:
                  'opacity 0.18s var(--ease-out-quart), transform 0.18s var(--ease-out-quart)',
              }}
            >
              <VoiceButton voice={voice} isSending={isSending} reduce={reduce} />
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleSend}
              disabled={disabled || !canSend || isSending}
              aria-label="Send message"
              aria-hidden={!canSend}
              tabIndex={canSend ? 0 : -1}
              className="glass-btn"
              style={{
                position: 'absolute',
                inset: 0,
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#ffffff',
                color: 'rgba(20, 20, 20, 0.85)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.20)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canSend ? 1 : 0,
                transform: canSend ? 'scale(1)' : 'scale(0.94)',
                pointerEvents: canSend ? 'auto' : 'none',
                transition:
                  'opacity 0.18s var(--ease-out-quart), transform 0.18s var(--ease-out-quart)',
              }}
            >
              <ArrowRight size={16} strokeWidth={2.4} />
            </motion.button>
          </div>
        </div>
      </div>

      <SlashMenu
        api={slash}
        onSelect={handleSlashSelect}
        onHover={handleSlashHover}
      />
    </motion.div>
  );
});

// ---------------------------------------------------------------------
// Inline chevron used by the agent switcher (row 2 of the input bar)
// ---------------------------------------------------------------------

function InlineChevron({
  direction,
  onClick,
  disabled,
}: {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled: boolean;
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { scale: 1.1 }}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'prev' ? 'Previous agent' : 'Next agent'}
      className="glass-btn"
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        color: 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'rgba(255,255,255,0.14)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      <Icon size={12} strokeWidth={2.4} />
    </motion.button>
  );
}

// ---------------------------------------------------------------------
// + button
// ---------------------------------------------------------------------

function PlusButton() {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.92 }}
      aria-label="Add files and more"
      className="glass-btn"
      style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        transition: 'background 0.2s var(--ease-out-quart), color 0.2s var(--ease-out-quart)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      <Plus size={16} strokeWidth={2.2} />
    </motion.button>
  );
}

// ---------------------------------------------------------------------
// Voice button — circular control. Shows wave glyph at rest; mini-bars
// when voice mode is active; phase-offset wave keyframe when transcribing.
// ---------------------------------------------------------------------

const NUM_BARS = 4;
const BAR_GAP = 2;
const BAR_W = 2;
const BAR_MIN = 2;
const BAR_MAX = 12;
const BAR_FALLOFF = 0.18;
const WAVE_DELAYS = [0, 90, 90, 0];
const WAVE_DURATION_MS = 900;

function VoiceButton({
  voice,
  isSending,
  reduce,
}: {
  voice: InputVoiceState;
  isSending: boolean;
  reduce: boolean;
}) {
  const ringColor = voice.isTranscribing
    ? 'var(--accent)'
    : voice.isUserSpeaking
      ? 'var(--live)'
      : 'rgba(255,255,255,0.35)';
  const barColor = voice.isTranscribing
    ? 'rgba(40, 20, 20, 0.85)'
    : voice.isUserSpeaking
      ? 'rgba(20, 50, 28, 0.85)'
      : 'rgba(20, 20, 20, 0.78)';

  // Mode drives the bar visuals:
  //   - 'transcribing' → phase-offset wave keyframe (CSS animation)
  //   - 'live' → bar heights driven by VAD probability
  //   - 'idle' → static decorative pattern (centered EQ shape)
  const mode: BarMode = voice.isTranscribing
    ? 'transcribing'
    : voice.active
      ? 'live'
      : 'idle';

  // Plain button — visibility is owned by the parent wrapper div's
  // opacity transition. Mixing framer-motion's initial/animate/exit
  // here was causing a flicker on every re-render of the parent
  // (wrapper opacity going to 0 + button still trying to scale-in).
  // The breathing animation for `isSending` lives as a CSS animation
  // instead so it's parent-state-independent.
  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={voice.disabled}
      aria-label={voice.active ? 'Stop voice mode' : 'Start voice mode'}
      className="glass-btn"
      style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: voice.active ? '#ffffff' : 'rgba(255,255,255,0.92)',
        border: `1px solid ${voice.active ? ringColor : 'rgba(255,255,255,0)'}`,
        boxShadow: voice.active
          ? `0 0 0 2px color-mix(in srgb, ${ringColor} 35%, transparent), 0 2px 8px rgba(0,0,0,0.25)`
          : '0 2px 8px rgba(0,0,0,0.20)',
        opacity: voice.disabled ? 0.4 : 1,
        cursor: voice.disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        animation: isSending && !reduce
          ? 'voice-breathing 1.6s ease-in-out infinite'
          : undefined,
        transition:
          'background 0.25s var(--ease-out-quart), box-shadow 0.25s var(--ease-out-quart), border-color 0.25s var(--ease-out-quart)',
      }}
    >
      <MiniBars
        mode={mode}
        vadLevel={voice.vadLevel}
        color={barColor}
      />
    </button>
  );
}

type BarMode = 'idle' | 'live' | 'transcribing';

// Static "soundwave" pattern shown at rest. Decorative — reads as
// audio bars even when no signal is driving them. Center bars taller,
// edges shorter; combined with the BAR_FALLOFF math gives a tight
// fan shape.
const IDLE_PATTERN = [0.45, 0.85, 0.85, 0.45];

function MiniBars({
  mode, vadLevel, color,
}: {
  mode: BarMode;
  vadLevel: number;
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
        gap: BAR_GAP,
        height: BAR_MAX,
        width: totalW,
      }}
    >
      {Array.from({ length: NUM_BARS }).map((_, i) => {
        const distance = Math.abs(i - center) / center;
        let height: number;
        if (mode === 'transcribing') {
          // CSS keyframe scales these full-height bars; height stays fixed.
          height = BAR_MAX;
        } else if (mode === 'live') {
          const local = Math.max(0, Math.min(1, vadLevel - distance * BAR_FALLOFF));
          height = BAR_MIN + local * (BAR_MAX - BAR_MIN);
        } else {
          // idle — static decorative pattern.
          const idle = IDLE_PATTERN[i] ?? 0.5;
          height = BAR_MIN + idle * (BAR_MAX - BAR_MIN);
        }
        return (
          <div
            key={i}
            style={{
              width: BAR_W,
              height,
              borderRadius: 1,
              background: color,
              transformOrigin: 'center',
              animation: mode === 'transcribing'
                ? `voice-bar-wave ${WAVE_DURATION_MS}ms ease-in-out ${WAVE_DELAYS[i]}ms infinite`
                : undefined,
              transition: mode === 'transcribing'
                ? 'background 250ms var(--ease-out-quart)'
                : 'height 200ms var(--ease-out-quart), background 250ms var(--ease-out-quart)',
            }}
          />
        );
      })}
    </div>
  );
}
