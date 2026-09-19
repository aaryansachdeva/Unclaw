// Community: characters people made and shared.
//
// Browse is the store: one search across names, descriptions and creators,
// newest or most added, and every card says who made it. A character's page
// leads with its creator and links to more of their work. Yours is where a
// creator runs everything they published: rename, rewrite the description,
// take a new picture, choose who can find it, delete.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Camera, Mic, Pencil, Search, Trash2, X } from 'lucide-react';
import { WordTabs } from '../customize/Inspector';
import { FIELD_BASE, applyBlur, applyFocus } from '../Onboarding/onboardingKit';
import {
  MarketError, browseListings, deleteListing, listingThumb, myListings, reportListing, sharedDate, updateListing,
  type BrowseSort, type Listing, type Visibility,
} from '../../services/market';
import { EASE_OUT_EXPO, META, MarketStyles, PILL, PRIMARY, Spinner } from './kit';

type Tab = 'browse' | 'yours';

interface Props {
  token: string;
  onClose: () => void;
  /** Download, import and set up a listing. Resolves when it is in the roster. */
  onInstall: (listing: Listing, onStep: (words: string) => void) => Promise<void>;
  /** Characters of yours that can be shared and are not yet. */
  shareables: { id: string; name: string }[];
  /** Share one of them: App brings them on stage and opens the Share sheet. */
  onShare: (instanceId: string) => void;
  /** Listings whose character is still in this roster, so a new picture can be taken. */
  retakeable: string[];
  /** Take a new picture: App brings the character on stage and uploads it. */
  onRetake: (listingId: string) => void;
  /** A listing of yours was deleted: forget it on the roster instance. */
  onDeleted: (listingId: string) => void;
  initialTab?: Tab;
  /** A one-line note to show on open (e.g. "New picture saved"). */
  notice?: string | null;
}

export function CommunityOverlay(props: Props) {
  const { onClose, initialTab = 'browse', notice } = props;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<Listing | null>(null);
  const [creator, setCreator] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (open) setOpen(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const showCreator = (l: Listing) => {
    setCreator({ key: l.creatorKey, name: l.ownerName || 'this creator' });
    setOpen(null);
    setTab('browse');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      style={{ position: 'absolute', inset: 0, zIndex: 57, pointerEvents: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      <MarketStyles />
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.6) 100%)',
        backdropFilter: 'blur(28px) saturate(1.3)', WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
      }} />

      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '76px 20px 32px' }} className="no-scrollbar">
        <div style={{ maxWidth: 660, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" aria-label="Back" onClick={() => (open ? setOpen(null) : onClose())} className="mk-focus" style={BACK}>
              <ArrowLeft size={15} strokeWidth={1.8} />
            </button>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {open ? open.name : 'Community'}
            </h1>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.div key={`detail-${open.id}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}>
                <Detail {...props} listing={open} onCreator={() => showCreator(open)} onGone={() => setOpen(null)} onUpdated={setOpen} />
              </motion.div>
            ) : (
              <motion.div key="lists" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <WordTabs<Tab> items={[{ id: 'browse', label: 'Browse' }, { id: 'yours', label: 'Yours' }]} value={tab} onChange={setTab} />
                {notice && <p role="status" style={{ ...META, margin: 0, color: 'var(--live, #8cbf8a)' }}>{notice}</p>}
                {tab === 'browse'
                  ? <Browse token={props.token} onOpen={setOpen} creator={creator} onClearCreator={() => setCreator(null)} />
                  : <Yours {...props} onOpen={setOpen} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

function Browse({ token, onOpen, creator, onClearCreator }: {
  token: string; onOpen: (l: Listing) => void;
  creator: { key: string; name: string } | null; onClearCreator: () => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<BrowseSort>('newest');
  const [items, setItems] = useState<Listing[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (after: string | null) => {
    const mine = ++seq.current;
    setError(null);
    if (!after) setItems(null);
    try {
      const r = await browseListings(token, { q: q.trim(), cursor: after, sort, creator: creator?.key });
      if (mine !== seq.current) return;
      setItems((prev) => (after ? [...(prev ?? []), ...r.listings] : r.listings));
      setCursor(r.nextCursor);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof MarketError ? e.message : 'Community is unavailable right now.');
    } finally {
      setMore(false);
    }
  }, [token, q, sort, creator]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(null); }, q ? 260 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  const empty = q.trim()
    ? `Nothing matches "${q.trim()}". Try a name, a word from a description, or a creator.`
    : creator
      ? `${creator.name} has not shared anyone publicly.`
      : 'No one has shared a character yet. Bring one in from Unreal and be the first.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-ghost)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search characters or creators"
            aria-label="Search the community"
            onFocus={(e) => applyFocus(e.currentTarget)}
            onBlur={(e) => applyBlur(e.currentTarget)}
            style={{ ...FIELD_BASE, paddingLeft: 34, paddingRight: q ? 34 : 13 }}
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="mk-focus"
              style={{ ...PILL, border: 'none', padding: 4, position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-ghost)' }}>
              <X size={13} />
            </button>
          )}
        </div>
        <Segmented<BrowseSort> label="Sort" value={sort} onChange={setSort}
          options={[{ id: 'newest', label: 'Newest' }, { id: 'popular', label: 'Most added' }]} />
      </div>

      {creator && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...META, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 5px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}>
            <CreatorBadge name={creator.name} size={20} />
            From {creator.name}
            <button type="button" aria-label={`Show everyone, not just ${creator.name}`} onClick={onClearCreator} className="mk-focus"
              style={{ ...PILL, border: 'none', padding: 2, color: 'var(--text-ghost)' }}>
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {error && <p style={{ ...META, margin: 0 }}>{error}</p>}
      {!error && items === null && <p style={{ ...META, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading</p>}
      {!error && items?.length === 0 && <p style={{ ...META, margin: 0 }}>{empty}</p>}
      {!!items?.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(136px, 1fr))', gap: '18px 14px' }}>
          {items.map((l, i) => <Card key={l.id} token={token} listing={l} delay={Math.min(i, 12) * 0.03} onOpen={() => onOpen(l)} />)}
        </div>
      )}
      {cursor && !error && (
        <button type="button" disabled={more} onClick={() => { setMore(true); void load(cursor); }} className="mk-focus" style={{ ...PILL, alignSelf: 'center' }}>
          {more ? <><Spinner /> Loading</> : 'Show more'}
        </button>
      )}
    </div>
  );
}

function Card({ token, listing, delay, onOpen }: { token: string; listing: Listing; delay: number; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="mk-card"
      aria-label={`${listing.name}, by ${listing.ownerName || 'someone'}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 9, borderRadius: 12, minWidth: 0 }}
    >
      <div style={{ position: 'relative' }}>
        <Portrait token={token} listing={listing} />
        {listing.hasVoice && (
          <span title="Has their own voice" style={{ position: 'absolute', left: 8, bottom: 8, width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,14,20,0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', color: 'var(--text-primary)' }}>
            <Mic size={11} strokeWidth={2} />
          </span>
        )}
        {listing.mine && (
          <span style={{ position: 'absolute', right: 8, top: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: 'rgba(12,14,20,0.62)', color: 'var(--text-primary)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
            Yours
          </span>
        )}
      </div>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, padding: '0 2px' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <CreatorBadge name={listing.ownerName} size={16} />
          <span style={{ ...META, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.ownerName || 'Someone'}</span>
        </span>
      </span>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// A character's page
// ---------------------------------------------------------------------------

function Detail({ token, listing, onInstall, onClose, onCreator, onDeleted, onGone, onUpdated, retakeable, onRetake }: Props & {
  listing: Listing; onCreator: () => void; onGone: () => void; onUpdated: (l: Listing) => void;
}) {
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);

  const add = async () => {
    setError(null);
    setStep('Downloading');
    try {
      await onInstall(listing, setStep);
      onClose();
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : 'Adding them failed. Try again.');
    }
  };
  const report = async () => {
    if (!reason.trim()) return;
    try {
      await reportListing(token, listing.id, reason.trim());
      setReported(true);
      setReporting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report did not send.');
    }
  };

  const added = listing.downloads === 1 ? 'Once' : listing.downloads > 1 ? `${listing.downloads} times` : 'Not yet';
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Portrait token={token} listing={listing} style={{ width: 230, flexShrink: 0 }} />
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Who made them, first: the thing people asked to see. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CreatorBadge name={listing.ownerName} size={32} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{listing.mine ? 'You' : listing.ownerName || 'Someone'}</span>
            <span style={META}>Shared {sharedDate(listing.createdAt)}</span>
          </div>
          {!listing.mine && (
            <button type="button" onClick={onCreator} className="mk-focus" style={{ ...PILL, marginLeft: 'auto', fontSize: 11.5, padding: '5px 11px' }}>
              More from {firstName(listing.ownerName)}
            </button>
          )}
        </div>

        {listing.blurb && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text-primary)', maxWidth: '60ch' }}>{listing.blurb}</p>}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Fact label="Voice" value={listing.hasVoice ? 'Their own' : `Built-in (${cap(listing.setup.voiceFrom ?? 'default')})`} />
          <Fact label="Added" value={added} />
          <Fact label="Size" value={`${Math.max(1, Math.round(listing.packageBytes / 1048576))} MB`} />
        </div>

        {listing.mine ? (
          <Manage token={token} listing={listing} canRetake={retakeable.includes(listing.id)} onRetake={onRetake}
            onChanged={onUpdated} onDeleted={(id) => { onDeleted(id); onGone(); }} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <motion.button type="button" onClick={add} disabled={!!step} whileTap={{ scale: 0.98 }} className="mk-focus"
                style={{ ...PRIMARY, opacity: step ? 0.85 : 1, cursor: step ? 'default' : 'pointer' }}>
                {step ? <><Spinner /> {step}</> : 'Add to my characters'}
              </motion.button>
            </div>
            {error && <p style={{ ...META, margin: 0, color: '#e8a0a0' }}>{error}</p>}
            {reported ? <p style={{ ...META, margin: 0 }}>Thanks. We will take a look.</p>
              : reporting ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
                  <textarea value={reason} rows={2} maxLength={500} placeholder="What is wrong with this character?"
                    onChange={(e) => setReason(e.target.value)} onFocus={(e) => applyFocus(e.currentTarget)} onBlur={(e) => applyBlur(e.currentTarget)}
                    style={FIELD_BASE} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={report} disabled={!reason.trim()} className="mk-focus" style={{ ...PILL, opacity: reason.trim() ? 1 : 0.5 }}>Send report</button>
                    <button type="button" onClick={() => setReporting(false)} className="mk-focus" style={{ ...PILL, border: 'none', color: 'var(--text-ghost)' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setReporting(true)} className="mk-focus"
                  style={{ ...PILL, border: 'none', padding: 0, alignSelf: 'flex-start', color: 'var(--text-ghost)', fontSize: 11.5 }}>
                  Report this character
                </button>
              )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yours: everything you published, and what you could publish next
// ---------------------------------------------------------------------------

function Yours({ token, shareables, onShare, retakeable, onRetake, onDeleted, onOpen }: Props & { onOpen: (l: Listing) => void }) {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    myListings(token)
      .then((l) => { if (live) setItems(l.filter((x) => x.status !== 'uploading')); })
      .catch((e) => { if (live) setError(e instanceof MarketError ? e.message : 'Community is unavailable right now.'); });
    return () => { live = false; };
  }, [token]);

  const totals = useMemo(() => {
    const list = items ?? [];
    return { count: list.length, public: list.filter((l) => l.visibility === 'public').length, added: list.reduce((n, l) => n + l.downloads, 0) };
  }, [items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {shareables.length > 0 && (
        <Section title="Ready to share" hint="Characters you brought in that are not published yet.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {shareables.map((s, i) => (
              <button key={s.id} type="button" onClick={() => onShare(s.id)} className="mk-focus" style={i === 0 ? PRIMARY : PILL}>
                Share {s.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Published"
        hint={items && items.length > 0
          ? `${totals.count} ${totals.count === 1 ? 'character' : 'characters'}, ${totals.public} public, ${totals.added === 0 ? 'not added yet' : `added ${totals.added === 1 ? 'once' : `${totals.added} times`}`}`
          : undefined}
      >
        {error && <p style={{ ...META, margin: 0 }}>{error}</p>}
        {!error && items === null && <p style={{ ...META, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading</p>}
        {!error && items?.length === 0 && (
          <p style={{ ...META, margin: 0 }}>
            {shareables.length ? 'Nothing published yet. Share one of the characters above.' : 'Nothing published yet. After you bring a character in from Unreal and set them up, you can share them here.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items?.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 14, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
              <button type="button" onClick={() => onOpen(l)} className="mk-card" aria-label={`Open ${l.name}`}
                style={{ all: 'unset', cursor: 'pointer', width: 76, flexShrink: 0, borderRadius: 10, alignSelf: 'flex-start' }}>
                <Portrait token={token} listing={l} style={{ borderRadius: 10 }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Manage token={token} listing={l} compact canRetake={retakeable.includes(l.id)} onRetake={onRetake}
                  onChanged={(next) => setItems((prev) => prev?.map((x) => (x.id === next.id ? next : x)) ?? null)}
                  onDeleted={(id) => { setItems((prev) => prev?.filter((x) => x.id !== id) ?? null); onDeleted(id); }} />
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** A creator's controls for one listing: shared by the Yours list and the
 *  listing's own page, so both offer exactly the same things. */
function Manage({ token, listing, compact = false, canRetake, onRetake, onChanged, onDeleted }: {
  token: string; listing: Listing; compact?: boolean; canRetake: boolean;
  onRetake: (id: string) => void; onChanged: (l: Listing) => void; onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(listing.name);
  const [blurb, setBlurb] = useState(listing.blurb);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { visibility?: Visibility; name?: string; blurb?: string }) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await updateListing(token, listing.id, patch));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteListing(token, listing.id);
      onDeleted(listing.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not delete.');
      setBusy(false);
      setConfirm(false);
    }
  };

  const status = [
    listing.visibility === 'public' ? 'Everyone can find them' : 'Only you',
    listing.downloads > 0 ? `added ${listing.downloads === 1 ? 'once' : `${listing.downloads} times`}` : 'not added yet',
    `shared ${sharedDate(listing.createdAt)}`,
  ].join(', ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {compact && !editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.name}</span>
          <span style={META}>{status}</span>
          {listing.blurb && <span style={{ ...META, color: 'var(--text-ghost)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{listing.blurb}</span>}
        </div>
      )}
      {!compact && !editing && <span style={META}>{status}</span>}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={name} maxLength={60} aria-label="Name" onChange={(e) => setName(e.target.value)}
            onFocus={(e) => applyFocus(e.currentTarget)} onBlur={(e) => applyBlur(e.currentTarget)} style={FIELD_BASE} />
          <textarea value={blurb} rows={2} maxLength={280} aria-label="Description" placeholder="What are they like? (optional)"
            onChange={(e) => setBlurb(e.target.value)} onFocus={(e) => applyFocus(e.currentTarget)} onBlur={(e) => applyBlur(e.currentTarget)} style={FIELD_BASE} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void save({ name: name.trim(), blurb: blurb.trim() })} className="mk-focus"
              style={{ ...PRIMARY, padding: '6px 14px', opacity: busy || !name.trim() ? 0.6 : 1 }}>
              {busy ? <><Spinner /> Saving</> : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setName(listing.name); setBlurb(listing.blurb); }} className="mk-focus"
              style={{ ...PILL, border: 'none', color: 'var(--text-ghost)' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : confirm ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...META, flex: '1 1 180px' }}>Delete {listing.name}? People who already added them keep their copy.</span>
          <button type="button" disabled={busy} onClick={() => void remove()} className="mk-focus" style={{ ...PILL, borderColor: 'rgba(196,68,68,0.55)', color: '#e8a0a0' }}>
            {busy ? <><Spinner /> Deleting</> : 'Delete'}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="mk-focus" style={{ ...PILL, border: 'none', color: 'var(--text-ghost)' }}>Keep</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Segmented<'public' | 'private'> label={`Who can find ${listing.name}`} value={listing.visibility === 'public' ? 'public' : 'private'}
            onChange={(v) => void save({ visibility: v })}
            options={[{ id: 'public', label: 'Everyone' }, { id: 'private', label: 'Only me' }]} />
          <IconAction label="Edit name and description" onClick={() => setEditing(true)}><Pencil size={13} /></IconAction>
          {canRetake && <IconAction label="Take a new picture" onClick={() => onRetake(listing.id)}><Camera size={13} /></IconAction>}
          <IconAction label={`Delete ${listing.name}`} onClick={() => setConfirm(true)}><Trash2 size={13} /></IconAction>
        </div>
      )}
      {error && <p style={{ ...META, margin: 0, color: '#e8a0a0' }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Portrait({ token, listing, style }: { token: string; listing: Listing; style?: CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listingThumb(token, listing.id, listing.updatedAt).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [token, listing.id, listing.updatedAt]);
  return (
    <div style={{ aspectRatio: '4 / 5', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', ...style }}>
      {src && <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
}

/** A creator's initial on a quiet tint derived from their name, so the same
 *  person reads the same everywhere without us storing an avatar. */
function CreatorBadge({ name, size }: { name: string; size: number }) {
  const hue = [...(name || '?')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: `hsl(${hue} 22% 30%)`, border: '1px solid rgba(255,255,255,0.12)',
      color: 'rgba(255,255,255,0.9)', fontSize: Math.round(size * 0.46), fontWeight: 700, lineHeight: 1,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', padding: 2, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', flexShrink: 0 }}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} className="mk-focus"
          style={{
            ...PILL, border: 'none', padding: '5px 11px', fontSize: 11.5,
            background: value === o.id ? 'rgba(255,255,255,0.12)' : 'transparent',
            fontWeight: value === o.id ? 600 : 500,
            color: value === o.id ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="mk-focus"
      style={{ ...PILL, padding: 7, color: 'var(--text-secondary)' }}>
      {children}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{title}</h2>
        {hint && <span style={META}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ ...META, color: 'var(--text-ghost)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

const firstName = (full: string) => (full || 'them').trim().split(/\s+/)[0];
const cap = (s: string) => s.replace(/_custom$/, '').replace(/^\w/, (c) => c.toUpperCase());

const BACK: CSSProperties = {
  width: 32, height: 32, padding: 0, borderRadius: '50%', flexShrink: 0,
  background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.10)', color: 'var(--text-primary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};
