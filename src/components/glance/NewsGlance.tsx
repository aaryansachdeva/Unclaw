// News glance: one headline at a time, cycling through the feed, source
// in caps under it. Expanded, every headline as a row in the same
// language with source and age, spaced apart; clicking a headline opens
// the article, and Summarize under each one stages it in the input bar so
// the next message (a question, or nothing) is about that article. The
// cycling headline carries the same button.
// Data from soul's free Google News RSS path (services/news), every 30 min.

import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';
import { MessageSquareText } from 'lucide-react';

import { getNews, type NewsArticle } from '../../services/news';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE } from './GlanceSection';
import { useCycle } from './useCycle';

const CYCLE_MS = 8000;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  refreshKey: number;
  /** Stage an article in the input bar for the chat. Absent = no button. */
  onSummarize?: (article: NewsArticle) => void;
  /** Edit mode (GlanceColumn): header only, drag handle and remove. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  onLayout?: () => void;
}

function openArticle(a: NewsArticle, fallback: () => void) {
  if (a.url) window.open(a.url, '_blank', 'noopener,noreferrer');
  else fallback();
}

function Headline({ a, lines = 2 }: { a: NewsArticle; lines?: number }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{
        fontSize: 13, fontWeight: 500, lineHeight: 1.3,
        display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', maxWidth: 208,
      }}>
        {a.title}
      </span>
      <span style={GLANCE_META_STYLE}>{a.source}{a.published_at ? ` · ${ago(a.published_at)}` : ''}</span>
    </span>
  );
}

export const NewsGlance = forwardRef<HTMLDivElement, Props>(function NewsGlance(
  { open, onOpen, onClose, refreshKey, onLayout, editing, dragControls, onRemove, onSummarize },
  ref,
) {
  const [articles, setArticles] = useState<NewsArticle[] | null>(null);
  const [off, setOff] = useState(false);
  const [hover, setHover] = useState(false);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++reqRef.current;
    const res = await getNews();
    if (my !== reqRef.current) return;
    if (res.available && res.data) { setArticles(res.data.articles); setOff(false); }
    else setOff(true);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);
  useEffect(() => { onLayout?.(); }, [articles, off, onLayout]);

  const idx = useCycle(articles?.length ?? 0, CYCLE_MS, hover || open);
  const shown = articles && articles.length ? articles[idx] : null;

  const ghost = (text: string) => (
    <div style={{ padding: '3px 8px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {text}
    </div>
  );

  const expanded = articles && (
    <div>
      {articles.length === 0 && ghost('No headlines right now')}
      {articles.map((a, i) => (
        <div key={a.url || a.title} style={{ marginTop: i === 0 ? 0 : 12 }}>
          <GlanceRow onClick={() => openArticle(a, onOpen)} ariaLabel={`Open article: ${a.title}`} align="flex-start">
            <Headline a={a} lines={3} />
          </GlanceRow>
          {onSummarize && <SummarizeButton title={a.title} onClick={() => onSummarize(a)} />}
        </div>
      ))}
    </div>
  );

  return (
    <GlanceSection ref={ref} label="News" open={open} onOpen={onOpen} onClose={onClose} panel={expanded ?? undefined} editing={editing} dragControls={dragControls} onRemove={onRemove}>
      {!articles && !off && ghost('Reading the headlines…')}
      {off && !articles && ghost('News unavailable')}
      {shown && (
        /* One headline at a time, cycling with a soft cross-fade; pauses
           under the pointer. */
        <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={shown.url || shown.title}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
            >
              <GlanceRow onClick={() => openArticle(shown, onOpen)} ariaLabel={`Open article: ${shown.title}`} align="flex-start">
                <Headline a={shown} />
              </GlanceRow>
              {/* Summarize the headline on screen. It lives inside the
                  hover wrapper, so pointing at it pauses the cycle and the
                  article cannot change under the click. */}
              {onSummarize && <SummarizeButton title={shown.title} onClick={() => onSummarize(shown)} />}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </GlanceSection>
  );
});

/** Quiet caps action under a headline: sends the article to the input bar. */
function SummarizeButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sheet-trigger
      onClick={onClick}
      aria-label={`Summarize: ${title}`}
      title="Ask about this article"
      style={{
        ...GLANCE_META_STYLE,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        margin: '1px 0 0 2px', padding: '3px 6px', borderRadius: 6,
        background: 'transparent', border: 'none', fontFamily: 'inherit',
        color: 'var(--text-ghost)', opacity: 1, cursor: 'pointer',
        textShadow: 'var(--text-shadow-floating)',
        transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-ghost)'; }}
    >
      <MessageSquareText size={11} strokeWidth={2.4} aria-hidden style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }} />
      Summarize
    </button>
  );
}

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
