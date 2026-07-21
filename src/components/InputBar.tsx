// Bottom input row. Frosted-slate pill with three zones, left → right:
//
//   [ + ] | [ Ask anything... ] | [ 🎙️ ]
//
// The widget icons are NOT in here anymore — they live in WidgetRail
// on the right edge of the window. The slash-menu still anchors above
// this bar, and `/news`, `/weather`, `/stocks`, `/reminders`, `/dance`,
// `/kiss`, `/hello`, `/celebrate`, `/clear` all work from the input.

import {
  forwardRef,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import {
  Plus, ArrowRight, ChevronDown,
  PanelRightOpen, PanelRightClose,
  Volume2, VolumeX,
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
  /** Explicit start/stop for push-to-talk (hold-space). The global
   *  keydown/keyup listener in InputBar uses these to cycle the mic
   *  on press + off on release without round-tripping through toggle
   *  (which would no-op the second fire if state.isListening flipped
   *  in between key events). */
  start: () => void;
  stop: () => void;
}

interface InputBarProps {
  personaName: string;
  isSending: boolean;
  disabled: boolean;
  /** Passthrough mode: UnClaw takes spoken turns from a user's external
   *  coding agent. The text field is replaced by a "Passthrough mode
   *  enabled" label + Exit button; the rest of the bar (agent switcher,
   *  widgets, customization) stays live. */
  passthrough?: boolean;
  /** Leave passthrough mode (backs the Exit button in the text field). */
  onExitPassthrough?: () => void;
  /** Talkativeness level shown in the inline passthrough control. */
  passthroughVerbosity?: 'quiet' | 'balanced' | 'chatty';
  /** Whether the avatar is muted (inline mute toggle state). */
  passthroughMuted?: boolean;
  /** Set talkativeness from the inline control. */
  onSetPassthroughVerbosity?: (v: 'quiet' | 'balanced' | 'chatty') => void;
  /** Toggle mute from the inline control. */
  onTogglePassthroughMuted?: () => void;
  /** True when the user has at least one attachment staged (e.g. a
   *  screenshot). Lets send fire with empty text — the attachment
   *  itself becomes the message. */
  hasAttachments?: boolean;
  onSendMessage: (message: string) => void;
  /** Open/close a sheet (slash command target). */
  onOpenSheet: (key: SheetKey) => void;
  /** Slash-command animation dispatcher. */
  onDispatchAnimation: (
    name: 'give_a_kiss' | 'do_dance' | 'say_hello' | 'react_as_star_wars_fan' | 'celebrate',
  ) => void;
  /** Slash command for /clear. */
  onClearMemory: () => void;
  /** Reopen the onboarding wizard. Backs the pencil button next to the
   *  persona switcher and the /onboard slash command. */
  onOpenOnboarding: () => void;
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
  /** The unstable "tentative" tail from the streaming transcriber, shown as a
   *  dim ghost after the committed text while `voiceActive`. Rendered in the
   *  mirror (not the textarea `message`), so committed text is never drawn
   *  twice — the bug that got the tail removed the first time. */
  tentative?: string;
  /** Persona switcher — the roster as a dropdown list, plus a + button to add.
   *  `agents` is every roster instance in carousel order. */
  agents: Array<{ id: string; name: string }>;
  /** Currently selected roster instance id (or the Add slot). */
  selectedAgentId: string;
  /** Switch to a roster instance by id (dropdown pick). */
  onSelectAgent: (id: string) => void;
  /** Open the "add a new agent" picker (the + button). */
  onAddAgent?: () => void;
  /** Disable the persona switcher when stream isn't connected. */
  personaDisabled?: boolean;
  /** Called when the user pastes an image into the textarea. Each
   *  pasted image is normalized to PNG, base64-encoded (no data-URL
   *  prefix), and reported with its natural dimensions so it can be
   *  attached alongside Ctrl+Shift+G screenshots. */
  onPasteImage?: (img: { base64: string; width: number; height: number }) => void;
  /** Called when the user attaches one or more images via the + button
   *  (native file picker). Same per-image shape as `onPasteImage`,
   *  delivered as a batch so multi-select arrives in one update. */
  onAttachImages?: (imgs: Array<{ base64: string; width: number; height: number }>) => void;
  /** Whether the active chat model accepts image input. Drives the
   *  + button's visibility — hidden for text-only models so the user
   *  isn't tempted to stage an attachment the model can't read. Paste
   *  remains wired regardless (back-compat with screenshot stacks
   *  captured before model switch); soul will refuse cleanly. */
  canAttachImages?: boolean;
  /** Whether the chat-history side pane is currently open. Drives the
   *  expand button's icon (PanelRightOpen ↔ PanelRightClose). */
  chatPaneOpen?: boolean;
  /** Toggle the chat-history side pane. Pane lives in App.tsx; the
   *  input bar just exposes the affordance. */
  onToggleChatPane?: () => void;
  /** When true, the input is locked with a "coming soon" placeholder
   *  message in place of the cycling prompts. Used for personas that
   *  aren't ready yet (Mark today). The persona-switcher chevrons stay
   *  enabled so the user can swap back. */
  comingSoon?: boolean;
  /** Copy shown in the placeholder slot while `comingSoon` is true. */
  comingSoonMessage?: string;
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
  passthrough = false,
  onExitPassthrough,
  passthroughVerbosity = 'balanced',
  passthroughMuted = false,
  onSetPassthroughVerbosity,
  onTogglePassthroughMuted,
  hasAttachments = false,
  onSendMessage,
  onOpenSheet,
  onDispatchAnimation,
  onClearMemory,
  onOpenOnboarding,
  onExpress,
  voice,
  voiceActive = false,
  tentative = '',
  agents,
  selectedAgentId,
  onSelectAgent,
  onAddAgent,
  personaDisabled = false,
  onPasteImage,
  onAttachImages,
  canAttachImages = false,
  chatPaneOpen = false,
  onToggleChatPane,
  comingSoon = false,
  comingSoonMessage = 'Coming soon',
}, forwardedRef) {
  // Lock the editing surface (textarea, send, voice) when the active
  // persona isn't ready yet. Persona-switcher chevrons stay live so
  // the user can swap back; only the chat surface goes inert.
  const inputLocked = disabled || comingSoon;
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
  //      (committed text only — unconfirmed/tentative words are never
  //      drawn, so the bar can't show the same word twice).
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

  // Pause cycling while the user is typing, while AI is producing,
  // OR while the active persona is locked behind a coming-soon
  // message. In the comingSoon case the placeholder slot displays a
  // static message (rendered below) instead of the cycling prompts.
  useEffect(() => {
    const shouldPause = !!message || isSending || comingSoon;
    if (shouldPause) {
      paused.current = true;
      clearTimeout(timerRef.current);
      setPromptVisible(false);
    } else if (paused.current) {
      paused.current = false;
      promptIdx.current++;
      cyclePlaceholder();
    }
  }, [message, isSending, comingSoon, cyclePlaceholder]);

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

  // Live handle on the voice state for the PTT listeners below. `voice` is built
  // as an object literal by the parent on every render, so depending on it
  // directly re-ran the effect constantly , and since vadLevel setState fires per
  // VAD frame (~30-60Hz) while the mic is open, the cleanup's
  // `if (pttHeld) voice.stop()` fired a frame after keydown and killed the very
  // utterance you were holding Space to record. Read through a ref instead and
  // register the listeners ONCE, so cleanup only runs on a real unmount.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Hold-Space push-to-talk. Press Space to start the mic, release to
  // stop. Skips when the user is typing in any text field (otherwise
  // every space in chat would toggle voice). Skips while voice is
  // already active from a click toggle so we don't yank continuous-mode
  // mid-utterance. Keydown is gated on !repeat so the OS auto-repeat
  // doesn't fire start() N times while held.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    };
    let pttHeld = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      const v = voiceRef.current;
      if (v.disabled) return;
      // If voice is already active from a click toggle, leave it alone.
      // PTT should layer ON TOP of click-to-toggle, not steal it.
      if (v.active) return;
      pttHeld = true;
      e.preventDefault();
      v.start();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!pttHeld) return;
      pttHeld = false;
      e.preventDefault();
      voiceRef.current.stop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      // Stop on unmount if we were holding (covers user navigating away
      // mid-utterance — don't leave the mic open).
      if (pttHeld) voiceRef.current.stop();
    };
  }, []);

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
    if ((!text && !hasAttachments) || inputLocked || isSending) return;
    onSendMessage(text);
    setMessage('');
    setPulse('submit');
    window.setTimeout(() => setPulse('none'), 280);
  }, [slash, message, hasAttachments, inputLocked, isSending, onSendMessage]);

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

  // Hidden file input + + button click handler. Same canvas-normalize
  // path the paste handler uses — every selected file becomes a clean
  // base64 PNG before it reaches the parent. Supports multi-select.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handlePickFiles = useCallback(() => {
    if (!canAttachImages || !onAttachImages) return;
    fileInputRef.current?.click();
  }, [canAttachImages, onAttachImages]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !onAttachImages) {
        if (e.target) e.target.value = '';
        return;
      }
      const pending = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (pending.length === 0) {
        e.target.value = '';
        return;
      }

      // Resolve each file → {base64, width, height} via canvas. All
      // images normalize to PNG so soul / providers see a uniform
      // content-type regardless of source.
      const results: Array<{ base64: string; width: number; height: number }> = [];
      let remaining = pending.length;
      const finish = () => {
        if (remaining > 0) return;
        if (results.length > 0) onAttachImages(results);
        if (e.target) e.target.value = '';  // allow re-picking same file
      };

      for (const file of pending) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          if (typeof dataUrl !== 'string') {
            remaining -= 1; finish(); return;
          }
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              remaining -= 1; finish(); return;
            }
            ctx.drawImage(img, 0, 0);
            const pngDataUrl = canvas.toDataURL('image/png');
            const base64 = pngDataUrl.split(',')[1] ?? '';
            if (base64) {
              results.push({
                base64,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }
            remaining -= 1;
            finish();
          };
          img.onerror = () => { remaining -= 1; finish(); };
          img.src = dataUrl;
        };
        reader.onerror = () => { remaining -= 1; finish(); };
        reader.readAsDataURL(file);
      }
    },
    [onAttachImages],
  );

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

  // Resting shadow uses the panel-rest token for cohesion with the
  // SettingsPanel and widget panels. The voice-active variant keeps
  // its accent glow but layers it OVER the same resting shadow so the
  // material vocabulary stays consistent (we don't get a flat "panel
  // becomes spotlight" jump on voice activation).
  const surfaceBoxShadow = voiceActive
    ? 'var(--shadow-panel-rest), 0 0 24px -4px rgba(196, 68, 68, 0.45)'
    : 'var(--shadow-panel-rest)';

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.32, ease: EASE_OUT_EXPO }}
      style={{
        position: 'relative',
        width: '100%',
        // 24px soft-edged rectangle (less aggressive than a full pill).
        borderRadius: 'var(--radius-pill-lg)',
        // Frosted slate material per "The Frosted Slate Rule" in
        // DESIGN.md. White-alpha was the pre-doctrine surface; it
        // disappeared against bright skin tones in the streamed
        // character. The base + hover tokens are the same material
        // language the SettingsPanel and widget pills speak.
        background: isFocused
          ? 'var(--glass-bg-hover)'
          : 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: `1px solid ${surfaceBorder}`,
        boxShadow: surfaceBoxShadow,
        transition:
          'background var(--duration-base) var(--ease-out-quart), border-color var(--duration-base) var(--ease-out-quart), box-shadow var(--duration-base) var(--ease-out-quart)',
        overflow: 'hidden',
      }}
    >
      {/* Hairline-top — the same ambient-light highlight the SettingsPanel
          and SoulBootScreen carry. Pulls the bar into the shared material
          vocabulary so the bottom chrome reads as "made of the same
          glass" as everything else that opens above it. */}
      <span className="hairline-top" style={{ left: 18, right: 18 }} aria-hidden />
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
          {passthrough ? (
            /* Passthrough mode: the text field is replaced by a status
               label + an Exit button. The REST of the bar (agent switcher,
               widgets, customization) stays live — only typed input is
               off, since the avatar's words come from the user's agent. */
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: 12,
                minHeight: 22,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <motion.span
                  aria-hidden
                  animate={reduce ? undefined : { opacity: [0.35, 0.9, 0.35] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 8px -1px var(--accent-glow)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    lineHeight: '22px',
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                    color: passthroughMuted ? 'var(--text-ghost)' : 'var(--text-primary)',
                  }}
                >
                  {passthroughMuted ? 'Passthrough mode · muted' : 'Passthrough mode enabled'}
                </span>
              </span>

              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Talkativeness , how often the avatar speaks. Three-stop
                    segmented control; drives both the agent-facing hint
                    (soul echoes it on each speak) and the bridge's hard
                    queue cap. */}
                <span
                  role="group"
                  aria-label="Talkativeness"
                  title="How much the avatar speaks"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 2,
                    borderRadius: 999,
                    background: 'var(--glass-bg-hover)',
                    border: '1px solid var(--stroke-soft, rgba(255,255,255,0.10))',
                    opacity: passthroughMuted ? 0.5 : 1,
                    pointerEvents: passthroughMuted ? 'none' : 'auto',
                    transition: 'opacity 0.15s var(--ease-out-quart)',
                  }}
                >
                  {(['quiet', 'balanced', 'chatty'] as const).map((v) => {
                    const on = passthroughVerbosity === v;
                    const label = v === 'quiet' ? 'Quiet' : v === 'balanced' ? 'Balanced' : 'Chatty';
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => onSetPassthroughVerbosity?.(v)}
                        aria-pressed={on}
                        style={{
                          height: 22,
                          padding: '0 10px',
                          borderRadius: 999,
                          border: 'none',
                          background: on ? 'var(--accent)' : 'transparent',
                          color: on ? '#fff' : 'var(--text-secondary)',
                          fontFamily: 'inherit',
                          fontSize: 11.5,
                          fontWeight: 600,
                          letterSpacing: '0.01em',
                          cursor: 'pointer',
                          transition: 'all 0.15s var(--ease-out-quart)',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </span>

                {/* Mute , silence the avatar without leaving passthrough. */}
                <button
                  type="button"
                  onClick={onTogglePassthroughMuted}
                  aria-pressed={passthroughMuted}
                  title={passthroughMuted ? 'Unmute avatar' : 'Mute avatar'}
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: passthroughMuted ? 'var(--accent-glow)' : 'transparent',
                    border: 'none',
                    color: passthroughMuted ? 'var(--accent)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s var(--ease-out-quart)',
                  }}
                  onMouseEnter={(e) => {
                    if (passthroughMuted) return;
                    e.currentTarget.style.background = 'var(--glass-bg-hover)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    if (passthroughMuted) return;
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {passthroughMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>

                <button
                  type="button"
                  onClick={onExitPassthrough}
                  title="Exit passthrough mode"
                  style={{
                    flexShrink: 0,
                    height: 26,
                    padding: '0 12px',
                    borderRadius: 999,
                    background: 'transparent',
                    border: '1px solid var(--stroke-soft, rgba(255,255,255,0.14))',
                    color: 'var(--text-secondary)',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    cursor: 'pointer',
                    transition: 'all 0.15s var(--ease-out-quart)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--glass-bg-hover)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.borderColor = 'var(--stroke-soft, rgba(255,255,255,0.14))';
                  }}
                >
                  Exit
                </button>
              </span>
            </div>
          ) : (
          <>
          {/* Visible mirror overlay. Renders the textarea's committed text.
              Sits BEHIND the textarea (z-index < textarea) and shares
              font/line-height/padding so its wrapping matches the textarea's
              exactly — when the user types or voice commits, the textarea's
              transparent characters occupy the same columns as the mirror's
              visible ones, so the cursor caret lands in the right spot.

              While speaking, `message` holds the COMMITTED transcript and the
              dim `tentative` span below appends the unstable tail flush after
              it. This is the corrected version of the tail we removed once: the
              old bug fed the span `committed + tentative` while `message` also
              held committed, drawing every committed word twice. Now the span
              carries ONLY `tentative` (App passes `streaming.tentative`), so
              committed renders exactly once (dark) and the unconfirmed tail
              trails it in dim ghost text — the same flush-suffix trick the
              slash-completion ghost uses. LocalAgreement-2 rewrites the tail
              until two inferences agree, so it shimmers slightly as words
              settle into committed; that shimmer IS the live-dictation feel. */}
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
              opacity: inputLocked ? 0.45 : 1,
              userSelect: 'none',
              zIndex: 1,
            }}
          >
            {message}
            {/* Tentative (unconfirmed) voice tail — dim ghost after the
                committed text. A leading space only when we're joining two
                non-empty, non-space-bounded pieces so words don't glue. */}
            {voiceActive && tentative.trim() && (
              <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
                {message.length > 0 && !/\s$/.test(message) ? ' ' : ''}
                {tentative.trim()}
              </span>
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
            disabled={inputLocked}
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
              opacity: inputLocked ? 0.45 : 1,
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
                  // Coming-soon shows static; cycling prompts honor the
                  // typewriter's visibility state so the fade between
                  // prompts still reads.
                  opacity: comingSoon ? 1 : promptVisible ? 1 : 0,
                  transition: 'opacity 0.4s var(--ease-out-quart)',
                }}
              >
                {comingSoon ? comingSoonMessage : currentPrompt}
              </span>
            </div>
          )}
          </>
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
          {/* Agent switcher — dropdown list of the roster + a + button to add */}
          <AgentSwitcher
            personaName={personaName}
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelect={onSelectAgent}
            onAdd={onAddAgent}
            disabled={personaDisabled}
            reduce={reduce}
          />

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Right action cluster: chat-pane toggle, then + image-attach
              (when the chat model supports vision), then mic/send. Reads
              as one unit: [chat-pane][+ attach][mic / send]. The chat-pane
              + the + are wrapped in their own sub-flex with a tight 2px
              gap so they read as a paired control, while the outer row
              gap (8px) still spaces them away from the mic/send slot. */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
            }}
          >
            {onToggleChatPane && (
              <button
                type="button"
                onClick={onToggleChatPane}
                aria-label={chatPaneOpen ? 'Close chat history' : 'Open chat history'}
                aria-pressed={chatPaneOpen}
                title={chatPaneOpen ? 'Close chat history' : 'Open chat history'}
                style={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: chatPaneOpen ? 'var(--glass-bg-hover)' : 'transparent',
                  border: 'none',
                  color: chatPaneOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
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
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                {chatPaneOpen ? (
                  <PanelRightClose size={18} strokeWidth={2} />
                ) : (
                  <PanelRightOpen size={18} strokeWidth={2} />
                )}
              </button>
            )}

            {canAttachImages && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <PlusButton onClick={handlePickFiles} disabled={inputLocked} />
              </>
            )}
          </div>

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
              <VoiceButton
                voice={comingSoon ? { ...voice, disabled: true } : voice}
                isSending={isSending}
                reduce={reduce}
              />
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleSend}
              disabled={inputLocked || !canSend || isSending}
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
// Agent switcher — the roster as a dropdown list + a + button (row 2)
// ---------------------------------------------------------------------

function AgentSwitcher({
  personaName, agents, selectedAgentId, onSelect, onAdd, disabled, reduce,
}: {
  personaName: string;
  agents: Array<{ id: string; name: string }>;
  selectedAgentId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  disabled: boolean;
  reduce: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Fixed-viewport anchor for the portaled list. The list is rendered into
  // document.body so it escapes the InputBar's `overflow: hidden` glass capsule
  // (which would otherwise clip it to inside the bar). `bottom` anchors it just
  // above the chip's top edge; the bar lives at the bottom of the window.
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; minWidth: number } | null>(null);

  const measure = useCallback(() => {
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({
      left: r.left,
      bottom: window.innerHeight - r.top + 8,
      minWidth: Math.max(176, r.width),
    });
  }, []);

  // Measure synchronously before paint whenever the menu is open, so it never
  // flashes at a stale position.
  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);

  // Close on outside click / Escape; re-measure on resize (the list is fixed to
  // the viewport, so a window resize shifts where the chip sits).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => measure();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, measure]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== selectedAgentId) onSelect(id);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
        transition: 'opacity 0.25s var(--ease-out-quart)',
      }}
    >
      {/* Current agent — click opens the roster list above the bar. */}
      <button
        ref={chipRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          maxWidth: 148,
          fontSize: 13.5, fontWeight: 600, letterSpacing: '0.01em',
          color: 'var(--text-primary)',
          background: open ? 'var(--glass-bg-hover)' : 'transparent',
          border: 'none', padding: '3px 7px', borderRadius: 7,
          cursor: disabled ? 'default' : 'pointer',
          transition: 'background 150ms var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => { if (!disabled && !open) e.currentTarget.style.background = 'var(--glass-bg-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={personaName}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
            style={{
              display: 'inline-block',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {personaName}
          </motion.span>
        </AnimatePresence>
        <ChevronDown
          size={13} strokeWidth={2.75}
          style={{
            flexShrink: 0,
            color: 'var(--text-ghost)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms var(--ease-out-quart)',
          }}
        />
      </button>

      {/* + add a new agent */}
      {onAdd && (
        <motion.button
          type="button"
          whileHover={disabled ? undefined : { scale: 1.08 }}
          whileTap={disabled ? undefined : { scale: 0.92 }}
          onClick={() => { if (!disabled) { setOpen(false); onAdd(); } }}
          disabled={disabled}
          aria-label="Add a new agent"
          title="Add a new agent"
          style={{
            width: 24, height: 24, borderRadius: 7,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: 'var(--text-secondary)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            transition: 'background 150ms var(--ease-out-quart), color 150ms var(--ease-out-quart)',
          }}
          onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <Plus size={15} strokeWidth={2.75} />
        </motion.button>
      )}

      {/* Roster list — portaled to <body> so it escapes the InputBar's
          `overflow: hidden` glass capsule (which otherwise clips it to inside
          the bar). Fixed-positioned just above the chip; opens UPWARD (bar sits
          at the bottom). Near-opaque slate: a dropdown can't composite a second
          backdrop blur over the bar's own, so it uses a solid surface. */}
      {createPortal(
        <AnimatePresence>
          {open && menuPos && agents.length > 0 && (
            <motion.ul
              ref={listRef}
              role="listbox"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
              style={{
                position: 'fixed',
                bottom: menuPos.bottom,
                left: menuPos.left,
                minWidth: menuPos.minWidth,
                maxHeight: 264,
                overflowY: 'auto',
                margin: 0, padding: 5, listStyle: 'none',
                transformOrigin: 'bottom left',
                background: 'rgba(30, 36, 50, 0.98)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                boxShadow: '0 12px 34px -8px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
                zIndex: 1000,
              }}
            >
            {agents.map((a) => {
              const active = a.id === selectedAgentId;
              return (
                <li key={a.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => pick(a.id)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 9px', borderRadius: 8,
                      fontSize: 13, fontWeight: active ? 600 : 500,
                      letterSpacing: '0.01em',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: active ? 'var(--glass-bg-hover)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                      transition: 'background 120ms var(--ease-out-quart), color 120ms var(--ease-out-quart)',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Presence dot. TODO: wire to real per-agent activity;
                        for now every agent reads "idle" (there's no live
                        task-status signal yet), so a hollow ring always. */}
                    <span
                      aria-hidden
                      style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: 'transparent',
                        border: '1.5px solid rgba(255,255,255,0.22)',
                        transition: 'all 150ms var(--ease-out-quart)',
                      }}
                    />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                    </span>
                    <span style={{
                      flexShrink: 0,
                      fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--text-ghost)',
                    }}>
                      Idle
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// + button
// ---------------------------------------------------------------------

function PlusButton({
  onClick,
  disabled = false,
}: {
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      aria-label="Attach image"
      title="Attach image"
      style={{
        flexShrink: 0,
        width: 32,
        height: 32,
        borderRadius: 8,
        background: 'transparent',
        border: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        transition: 'all 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--glass-bg-hover)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      <Plus size={18} strokeWidth={2} />
    </motion.button>
  );
}

// ---------------------------------------------------------------------
// Voice button — circular control for continuous voice mode. A single mic
// glyph that scales + glows smoothly with the live VAD level while you speak
// (no WebGL). Inactive = white pill with a dark mic; active = dark orb with a
// light mic; transcribing = warm accent. Motion carries the "listening"
// signal, hue is spent only at the one moment of attention (DESIGN.md).
// ---------------------------------------------------------------------

function VoiceButton({
  voice,
  isSending,
  reduce,
}: {
  voice: InputVoiceState;
  isSending: boolean;
  reduce: boolean;
}) {
  const active = voice.active;
  const transcribing = voice.isTranscribing;

  // The ONLY thing that moves the bars is real signal: the live VAD level while
  // listening (so they rise as you actually speak), and a gentle constant while
  // she's transcribing (no mic then, but the bars shouldn't look dead). Silent =
  // resting fan, nothing animating. No decorative keyframe — that read as random.
  const energy = Math.max(
    0,
    Math.min(1, active ? (transcribing ? 0.3 : voice.vadLevel) : 0),
  );

  // Dark bars at rest; warm red (--accent) while recording — the mic is live
  // and capturing, so the bars glow red the whole time voice mode is on.
  const barColor = active ? 'var(--accent)' : 'rgba(20, 20, 20, 0.85)';

  // The pill stays light in every state (no dark orb) and carries no ring/
  // outline — the bars alone signal state. Only the resting `isSending` breathe
  // remains, as a CSS animation so it's parent-state-independent.
  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={voice.disabled}
      aria-label={active ? 'Stop voice mode' : 'Start voice mode'}
      className="glass-btn"
      style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '50%',
        position: 'relative',
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.92)',
        border: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.20)',
        opacity: voice.disabled ? 0.4 : 1,
        cursor: voice.disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        animation: isSending && !active && !reduce
          ? 'voice-breathing 1.6s ease-in-out infinite'
          : undefined,
        transition: 'box-shadow 0.25s var(--ease-out-quart)',
      }}
    >
      <VoiceBars energy={energy} color={barColor} />
    </button>
  );
}

// Equalizer bars for the voice orb. A center-tall fan that grows with the live
// VAD `energy`: at rest it sits at a low resting height (BARS_REST), and each
// bar's height rises smoothly toward its full weight as your voice level climbs.
// Movement is driven entirely by `energy` (a CSS height transition lerps between
// the ~60fps VAD updates), so the bars react to speech instead of animating on a
// timer. No WebGL.
// Steep center-tall fan: the middle bars dominate, edges fall off fast.
const BAR_WEIGHTS = [0.35, 0.85, 1.0, 0.85, 0.35];
const BARS_MAX_H = 24;
const BARS_MIN_H = 3;
const BARS_REST = 0.5; // resting fan height as a fraction of full, with no voice
const BARS_GAP = 1.5;  // tight horizontal spacing between bars

function VoiceBars({ energy, color }: { energy: number; color: string }) {
  const e = Math.max(0, Math.min(1, energy));
  const level = BARS_REST + (1 - BARS_REST) * e; // 0.4 (silent) → 1.0 (loud)
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: BARS_GAP,
        height: BARS_MAX_H,
      }}
    >
      {BAR_WEIGHTS.map((w, i) => (
        <div
          key={i}
          style={{
            width: 2.5,
            height: BARS_MIN_H + (BARS_MAX_H - BARS_MIN_H) * w * level,
            borderRadius: 1.5,
            background: color,
            flexShrink: 0,
            transition: 'height 120ms var(--ease-out-quart), background 220ms var(--ease-out-quart)',
          }}
        />
      ))}
    </div>
  );
}
