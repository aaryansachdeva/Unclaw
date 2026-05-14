// News panel content. Wrapped by SheetPanel; rows open the upstream
// URL in a new browser tab. Auto-refreshes every 15 min (soul caches
// for 10 min upstream).

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { getNews, NewsArticle } from '../services/news';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface NewsPanelProps {
  refreshKey?: number;
}

export function NewsPanel({ refreshKey = 0 }: NewsPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const res = await getNews();
    if (myReq !== reqIdRef.current) return;
    setAvailable(res.available);
    setHint(res.hint ?? null);
    setArticles(res.available && res.data ? res.data.articles : []);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (available === false) {
    return (
      <div style={unavailableStyle}>
        {hint ?? "News isn't available on this build of soul."}
      </div>
    );
  }
  if (available === null) return null;

  const count = articles.length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {count > 0 ? `${count} headlines` : 'No headlines'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {count === 0 ? (
          <EmptyState />
        ) : (
          articles.map((a, i) => (
            <ArticleRow
              key={`${a.url}:${i}`}
              article={a}
              staggerDelay={Math.min(0.04 * i, 0.32)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ArticleRow({ article, staggerDelay }: { article: NewsArticle; staggerDelay: number }) {
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
      transition={{ duration: 0.22, delay: staggerDelay, ease: EASE_OUT_EXPO }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: 8,
        borderRadius: 10,
        textAlign: 'left',
        background: hover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        cursor: 'pointer',
        transition:
          'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      {article.image_url && (
        <div
          style={{
            flexShrink: 0,
            width: 64,
            height: 64,
            borderRadius: 8,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={(e) => {
              // Hide on load failure so we don't show a broken-image icon.
              (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: article.image_url ? '2px 4px 2px 0' : '3px 5px',
        }}
      >
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
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            letterSpacing: '-0.01em',
          }}
        >
          {article.title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.85,
          }}
        >
          {article.source}
          {article.published_at
            ? ` · ${formatTimeAgo(article.published_at)}`
            : ''}
        </div>
      </div>

      {/* External-link affordance — always rendered but only visible
          on hover. Reserving the slot prevents the title text from
          re-laying out as the icon mounts/unmounts. */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          color: 'var(--text-ghost)',
          opacity: hover ? 1 : 0,
          transform: hover ? 'scale(1)' : 'scale(0.85)',
          transition:
            'opacity 0.16s var(--ease-out-quart), transform 0.16s var(--ease-out-quart)',
        }}
      >
        <ExternalLink size={11} strokeWidth={2.2} />
      </span>
    </motion.button>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '14px 4px 6px 4px',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      No headlines right now. Try again in a moment.
    </motion.div>
  );
}

const unavailableStyle: React.CSSProperties = {
  padding: '14px 4px',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

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
