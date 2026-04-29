// News widget shaped after the same mobile-tab pattern as Reminders /
// Weather:
//
//   collapsed     [paper] News [N]                          (small pill)
//   click ↓
//   expanded     ┌──────────────────────────────────┐
//                │ Headline ...               ↗     │
//                │ source · 3h ago                  │
//                │ summary preview ...              │
//                │ ───                              │
//                │ Headline ...                     │
//                │ ...                              │
//                └──────────────────────────────────┘
//                [paper] News                         [×]
//
// Grows UPWARD; rows open the upstream URL in a new browser tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, ExternalLink, X } from 'lucide-react';
import { getNews, NewsArticle } from '../services/news';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface NewsProps {
  /** Bumping this number forces a refetch (e.g. after a chat round). */
  refreshKey?: number;
  /** Controlled open/close. App.tsx lifts this so only one widget panel
   *  can be expanded at a time. */
  isOpen?: boolean;
  onToggle?: () => void;
}

export function News({ refreshKey = 0, isOpen, onToggle }: NewsProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = onToggle ?? (() => setInternalOpen(o => !o));
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const res = await getNews();
    if (myReq !== reqIdRef.current) return;
    setAvailable(res.available);
    setArticles(res.available && res.data ? res.data.articles : []);
  }, []);

  useEffect(() => {
    void refresh();
    // News is cached server-side for 10 min; widget polls every 15 min.
    const id = window.setInterval(() => { void refresh(); }, 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (available === false) return null;
  if (available === null) return null;

  const count = articles.length;

  return (
    <div style={{ position: 'relative' }}>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              width: 400,
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: 14,
              borderRadius: 16,
              background: 'var(--glass-bg-panel)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border-focus)',
              boxShadow: [
                '0 1px 0 rgba(255, 255, 255, 0.06) inset',
                '0 16px 36px -10px rgba(0, 0, 0, 0.45)',
              ].join(', '),
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                }}
              >
                Headlines
              </span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {count}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {count === 0 ? (
                <EmptyState />
              ) : (
                articles.map((a, i) => (
                  <ArticleRow key={`${a.url}:${i}`} article={a} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Pill open={open} count={count} onToggle={setOpen} />
    </div>
  );
}

// ---------- pill ------------------------------------------------------

function Pill({
  open, count, onToggle,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const surfaceOn = hover || open;
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-expanded={open}
      aria-label={open ? 'Close news' : 'Open news'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        height: 40,
        borderRadius: 14,
        background: surfaceOn
          ? (open ? 'var(--glass-bg-hover)' : 'var(--glass-bg)')
          : 'transparent',
        backdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        border: `1px solid ${
          surfaceOn ? (open ? 'var(--glass-border-focus)' : 'var(--glass-border)') : 'transparent'
        }`,
        boxShadow: surfaceOn
          ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.25)'
          : 'none',
        cursor: 'pointer',
        transition:
          'background 0.2s var(--ease-out-quart), border-color 0.2s var(--ease-out-quart), box-shadow 0.2s var(--ease-out-quart)',
      }}
    >
      <Newspaper
        size={14}
        strokeWidth={2}
        color="var(--text-primary)"
        aria-hidden
        style={{
          filter: surfaceOn ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
        }}
      >
        News
      </span>
      {count > 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            minWidth: 12,
            textAlign: 'right',
            opacity: open ? 1 : 0.85,
            textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
          }}
        >
          {count}
        </span>
      )}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          marginLeft: 2,
          color: 'var(--text-ghost)',
        }}
      >
        {open ? <X size={11} strokeWidth={2.4} /> : null}
      </span>
    </motion.button>
  );
}

// ---------- row -------------------------------------------------------

function ArticleRow({ article }: { article: NewsArticle }) {
  const [hover, setHover] = useState(false);
  const onClick = useCallback(() => {
    if (article.url) window.open(article.url, '_blank', 'noopener,noreferrer');
  }, [article.url]);

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 10,
        textAlign: 'left',
        background: hover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        cursor: 'pointer',
        transition:
          'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--text-primary)',
            lineHeight: 1.35,
            wordBreak: 'break-word',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {article.title}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 11.5,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {article.source}
          {article.published_at
            ? ` · ${formatTimeAgo(article.published_at)}`
            : ''}
        </div>
        {article.summary && (
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              color: 'var(--text-secondary)',
              opacity: 0.78,
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {article.summary}
          </div>
        )}
      </div>

      <AnimatePresence>
        {hover && (
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.12 }}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              color: 'var(--text-ghost)',
            }}
            aria-hidden
          >
            <ExternalLink size={11} strokeWidth={2.2} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// ---------- empty state ----------------------------------------------

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '14px 4px 6px 4px',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      No headlines right now. Try again in a moment.
    </motion.div>
  );
}

// ---------- helpers --------------------------------------------------

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
