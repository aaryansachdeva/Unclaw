// Side-anchored chat history pane. Toggled from the input bar's expand
// button. Distinct cool-gray surface (deliberately NOT the warm frosted
// glass the rest of the app uses) so it reads as a focused work pane
// next to the theatrical streamed companion.
//
// Aesthetic direction: refined-utilitarian. Tight type, dense rows,
// minimal chrome. The contrast against the app's frosted body is what
// makes it feel premium — control panel next to stage.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Turn } from '../hooks/useChatMemory';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface ToolEvent {
  id: number;
  ts: number;
  label: string;
}

interface ChatPaneProps {
  open: boolean;
  turns: Turn[];
  personaName: string;
  /** Pixel width — driven by the parent so the pane can be a
   *  percentage of the window. Falls back to 360 if not provided. */
  width?: number;
  /** Tool events emitted by escalation, each with the timestamp it
   *  fired at. Merged with `turns` by ts and rendered as their own
   *  rows in the chat stack at the moment they happened, so the
   *  conversation reads chronologically: user turn → tool → tool →
   *  assistant turn → tool → final assistant turn, etc. */
  toolEvents?: ToolEvent[];
  /** True while an escalation is running. Drives the pulsing dot
   *  next to the LATEST tool row so the user can tell the model
   *  is still working between calls. */
  escalating?: boolean;
  /** Called when the user begins dragging the resize handle on the
   *  pane's left edge. App.tsx owns the width state. */
  onResizeStart?: (e: React.PointerEvent) => void;
}

export function ChatPane({
  open,
  turns,
  personaName,
  width = 360,
  toolEvents,
  escalating,
  onResizeStart,
}: ChatPaneProps) {
  // Header is rendered by App.tsx as a sibling (not inside this
  // component) so its z-index isn't trapped inside the chat pane's
  // stacking context — that trap is what was preventing the close
  // button from being clickable through the titlebar's drag region.
  const reduce = useReducedMotion() ?? false;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether the user is already scrolled to the bottom. Only
  // auto-scroll on new turns when this is true — otherwise honor the
  // user's intent to read history without yanking them down.
  const pinnedToBottomRef = useRef(true);

  // No time-gap markers — pure list of turns, simplest possible read.

  // Bottom-pin behavior: detect on every scroll, auto-jump on new turn.
  // Threshold 80px (not 12) accounts for the scroll container's 150px
  // bottom padding — the user's perceived "bottom" sits above the true
  // scrollHeight by the height of the floating input bar's overlap.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      pinnedToBottomRef.current = dist < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Jump to bottom when the pane opens, when new turns arrive, AND when
  // a new tool event lands. Two extra rules:
  //   1. If the newest turn is from the user, ALWAYS scroll — they just
  //      hit send and expect to see their own message regardless of
  //      whether they were technically "pinned".
  //   2. Defer the scroll one rAF tick. Framer-motion's `layout` prop
  //      on ToolEventRow + AnimatePresence can leave the scroll container
  //      with a transient scrollHeight on the same tick the new item
  //      mounts, which the browser sometimes clamps — manifesting as a
  //      jump-to-top. rAF lets layout settle before we snap.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    const newest = turns.length > 0 ? turns[turns.length - 1] : null;
    const userJustSent = newest && newest.role === 'user';
    if (!userJustSent && !pinnedToBottomRef.current) return;
    const r = requestAnimationFrame(() => {
      const cur = scrollRef.current;
      if (cur) cur.scrollTop = cur.scrollHeight;
    });
    return () => cancelAnimationFrame(r);
  }, [open, turns.length, toolEvents?.length]);

  // Merge turns + tool events into a single chronological timeline
  // sorted by timestamp. Each entry carries enough info for the
  // renderer to dispatch on kind. Done in useMemo so re-render is
  // cheap when neither array changed.
  type Item =
    | { kind: 'turn'; turn: Turn; ts: number }
    | { kind: 'tool'; event: ToolEvent; ts: number };
  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];
    for (const t of turns) all.push({ kind: 'turn', turn: t, ts: t.ts });
    if (toolEvents) {
      for (const e of toolEvents) all.push({ kind: 'tool', event: e, ts: e.ts });
    }
    all.sort((a, b) => a.ts - b.ts);
    return all;
  }, [turns, toolEvents]);

  // The most-recent tool event gets a pulsing dot when escalation is
  // still running (signals "still working between calls").
  const latestToolId = useMemo<number | null>(() => {
    if (!toolEvents || toolEvents.length === 0) return null;
    return toolEvents[toolEvents.length - 1].id;
  }, [toolEvents]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="chat-pane"
          role="complementary"
          aria-label={`${personaName} conversation history`}
          initial={reduce ? { x: 0 } : { x: width }}
          animate={{ x: 0 }}
          exit={reduce ? { x: 0 } : { x: width }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.32, ease: EASE_OUT_EXPO }
          }
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width,
            zIndex: 35,
            // Cool dark gray — deliberately cooler than the app's
            // warm `--bg-void` (#050506) so it reads as a different
            // surface. A faint vertical wash adds depth without
            // looking gradient-y.
            background:
              'linear-gradient(180deg, #18181d 0%, #16161b 60%, #141418 100%)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.07)',
            // Inner shadow on the left edge so the pane reads as
            // "carved out of the window" rather than floating.
            boxShadow: 'inset 1px 0 0 rgba(255, 255, 255, 0.04)',
            overflow: 'hidden',
            // Drag-region opt-out: the titlebar's drag region overlaps
            // the pane's top edge; without this, clicking the close
            // button or scrolling messages would also drag the window.
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {/* Resize handle on the left edge — 6px wide, full height,
              col-resize cursor. Hover reveals a faint accent stripe so
              the affordance is discoverable without being noisy.
              `WebkitAppRegion: no-drag` keeps the titlebar from eating
              pointer-down events. */}
          {onResizeStart && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat pane"
              onPointerDown={onResizeStart}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: 6,
                cursor: 'col-resize',
                zIndex: 60,
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                const stripe = e.currentTarget.querySelector('span');
                if (stripe) (stripe as HTMLElement).style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                const stripe = e.currentTarget.querySelector('span');
                if (stripe) (stripe as HTMLElement).style.opacity = '0';
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 1,
                  width: 2,
                  background: 'var(--accent)',
                  opacity: 0,
                  transition: 'opacity 0.18s var(--ease-out-quart)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          )}

          <div
            ref={scrollRef}
            className="chat-pane-scroll"
            style={{
              // Header sits absolutely at top (z above titlebar);
              // the scroll layer fills the rest of the pane. Top
              // clears the roomier header (top:18 + ~32 stack +
              // breathing room).
              position: 'absolute',
              top: 64,
              left: 0,
              right: 0,
              bottom: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              // Reserve room at the bottom so the floating InputBar
              // (which slides into the pane region when open) never
              // covers the last message. Generous because the bar's
              // height varies with content + persona row.
              padding: '12px 14px 150px',
              // Custom thin scrollbar — see styles.css scoped class.
              scrollbarGutter: 'stable both-edges',
            }}
          >
            {items.length === 0 ? (
              <EmptyState />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <AnimatePresence initial={false}>
                  {items.map((it, i) => {
                    const prev = items[i - 1];
                    if (it.kind === 'tool') {
                      // Tool event — its own row in the stack at the
                      // moment it fired. Pulsing dot only on the most
                      // recent one while escalation is still running.
                      return (
                        <ToolEventRow
                          key={`tool-${it.event.id}`}
                          label={it.event.label}
                          live={!!escalating && it.event.id === latestToolId}
                          marginTop={i === 0 ? 0 : 6}
                        />
                      );
                    }
                    // Spacing rule: tighter on user→assistant
                    // follow-ups, looser before a new user turn.
                    const t = it.turn;
                    const prevIsUser =
                      prev && prev.kind === 'turn' && prev.turn.role === 'user';
                    const prevIsAssistant =
                      prev && prev.kind === 'turn' && prev.turn.role === 'assistant';
                    const prevIsTool = prev && prev.kind === 'tool';
                    const tightTop =
                      (prevIsUser && t.role === 'assistant')
                      || (prevIsTool && t.role === 'assistant');
                    const looseTop = prevIsAssistant && t.role === 'user';
                    return (
                      <MessageRow
                        key={`turn-${t.ts}`}
                        turn={t}
                        marginTop={
                          i === 0 ? 0 : tightTop ? 6 : looseTop ? 14 : 10
                        }
                      />
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------

/** Rendered as a SIBLING of <ChatPane> from App.tsx (not as its
 *  child) so its z-index escapes the pane's stacking context. The
 *  header needs to stack above the Titlebar (z 50) so the close
 *  button isn't swallowed by the titlebar's drag region — that's
 *  impossible to achieve from inside the pane (parent's z-35 caps
 *  any descendant's effective stacking). */
export function ChatPaneHeader({
  personaName,
  onClose,
}: {
  personaName: string;
  onClose: () => void;
}) {
  // Returns inline content only — App.tsx provides the absolute-
  // positioned wrapper at z-60, so the header escapes the chat pane's
  // z-35 stacking context and actually stacks above the titlebar.
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat pane"
        title="Close"
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: 'var(--text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s var(--ease-out-quart)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        }}
      >
        <X size={15} strokeWidth={2} />
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Real breathing room between the small-caps label and the
          // persona name — feels editorial, not crammed.
          gap: 5,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-ghost)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 500,
            lineHeight: 1,
            // Tiny shadow keeps the small-caps legible against the
            // titlebar gradient that washes through behind.
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.45)',
          }}
        >
          conversation
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.55)',
          }}
        >
          {personaName}
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------

function MessageRow({
  turn,
  marginTop,
}: {
  turn: Turn;
  marginTop: number;
}) {
  if (turn.role === 'user') {
    return (
      <div
        style={{
          marginTop,
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <div
          style={{
            // Soft user-bubble. Asymmetric corner on the bottom-right
            // (the speech-tail side) breaks the "iMessage-blue" cliché
            // while keeping clear directionality.
            maxWidth: '82%',
            padding: '7px 11px',
            borderRadius: '14px 14px 4px 14px',
            background: 'rgba(255, 255, 255, 0.07)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            color: 'var(--text-primary)',
            fontSize: 13,
            lineHeight: 1.5,
            letterSpacing: '-0.003em',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  // Assistant: plain left-aligned text, no bubble, no stripe. The
  // user-bubble alignment (right) vs assistant text-flush-left is
  // enough directional contrast on its own.
  return (
    <div
      style={{
        marginTop,
        color: 'var(--text-primary)',
        fontSize: 13,
        lineHeight: 1.5,
        letterSpacing: '-0.003em',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
    >
      {turn.content}
    </div>
  );
}

// One tool event in the chat stack. Plain italic text, no chip, no
// dot. Reads as quiet metadata in the conversation flow. While the
// tool is the most recent AND escalation is still running, the text
// pulses softly so the user can tell which step is currently active.
// Past tool events sit static at a low opacity.
function ToolEventRow({
  label,
  live,
  marginTop,
}: {
  label: string;
  live: boolean;
  marginTop: number;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 3 }}
      animate={
        live
          ? { opacity: [0.55, 0.95, 0.55], y: 0 }
          : { opacity: 0.62, y: 0 }
      }
      transition={
        live
          ? {
              opacity: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
              y: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
            }
          : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
      }
      style={{
        marginTop,
        fontSize: 12,
        fontStyle: 'italic',
        color: 'var(--text-secondary)',
        letterSpacing: '0.005em',
        // Tiny left inset so tool rows visually nest under the
        // assistant turns above them rather than competing for the
        // same starting edge.
        paddingLeft: 4,
      }}
    >
      {label}
    </motion.div>
  );
}

// ---------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------

function EmptyState() {
  return (
    <div
      style={{
        height: '100%',
        minHeight: 180,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '24px 16px',
        textAlign: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 2,
          borderRadius: 2,
          background: 'var(--accent)',
          opacity: 0.55,
          boxShadow: '0 0 8px rgba(196, 68, 68, 0.45)',
          marginBottom: 6,
        }}
      />
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          letterSpacing: '0.005em',
        }}
      >
        nothing yet
      </div>
    </div>
  );
}
