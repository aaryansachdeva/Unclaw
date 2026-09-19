// Community: characters other people shared, and the ones you shared.
//
// Opened from Add character. Browse is a grid of portraits; a portrait opens
// the character, and "Add to my characters" downloads the package and voice,
// imports them and sets the character up the way its creator had it (App owns
// that, via onInstall). Yours lists what you shared, with who can see each one
// and delete.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { WordTabs } from '../customize/Inspector';
import { FIELD_BASE, applyBlur, applyFocus } from '../Onboarding/onboardingKit';
import {
  MarketError, browseListings, deleteListing, listingThumb, myListings, reportListing, updateListing, type Listing,
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
  /** A listing of yours was deleted: forget it on the roster instance. */
  onDeleted: (listingId: string) => void;
}

export function CommunityOverlay({ token, onClose, onInstall, shareables, onShare, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('browse');
  const [open, setOpen] = useState<Listing | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (open) setOpen(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '76px 20px 28px' }} className="no-scrollbar">
        <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" aria-label="Back" onClick={() => (open ? setOpen(null) : onClose())} className="mk-focus" style={BACK}>
              <ArrowLeft size={15} strokeWidth={1.8} />
            </button>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              {open ? open.name : 'Community'}
            </h1>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.div key={`detail-${open.id}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}>
                <Detail token={token} listing={open} onInstall={onInstall} onDone={onClose} />
              </motion.div>
            ) : (
              <motion.div key="lists" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <WordTabs<Tab> items={[{ id: 'browse', label: 'Browse' }, { id: 'yours', label: 'Yours' }]} value={tab} onChange={setTab} />
                {tab === 'browse'
                  ? <Browse token={token} onOpen={setOpen} />
                  : <Yours token={token} shareables={shareables} onShare={onShare} onOpen={setOpen} onDeleted={onDeleted} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function Browse({ token, onOpen }: { token: string; onOpen: (l: Listing) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Listing[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (query: string, after: string | null) => {
    const mine = ++seq.current;
    setError(null);
    try {
      const r = await browseListings(token, { q: query, cursor: after });
      if (mine !== seq.current) return;
      setItems((prev) => (after ? [...(prev ?? []), ...r.listings] : r.listings));
      setCursor(r.nextCursor);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof MarketError ? e.message : 'Community is unavailable right now.');
    } finally {
      setMore(false);
    }
  }, [token]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(q.trim(), null); }, q ? 260 : 0);
    return () => window.clearTimeout(t);
  }, [q, load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-ghost)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name"
          aria-label="Search characters"
          onFocus={(e) => applyFocus(e.currentTarget)}
          onBlur={(e) => applyBlur(e.currentTarget)}
          style={{ ...FIELD_BASE, paddingLeft: 34 }}
        />
      </div>
      {error && <p style={{ ...META, margin: 0 }}>{error}</p>}
      {!error && items === null && <p style={{ ...META, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading</p>}
      {!error && items?.length === 0 && (
        <p style={{ ...META, margin: 0 }}>
          {q ? `No one called "${q}" yet.` : 'No one has shared a character yet. Bring one in from Unreal and be the first.'}
        </p>
      )}
      {!!items?.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 14 }}>
          {items.map((l, i) => <Card key={l.id} token={token} listing={l} delay={Math.min(i, 12) * 0.03} onOpen={() => onOpen(l)} />)}
        </div>
      )}
      {cursor && !error && (
        <button type="button" disabled={more} onClick={() => { setMore(true); void load(q.trim(), cursor); }} className="mk-focus" style={{ ...PILL, alignSelf: 'center' }}>
          {more ? <><Spinner /> Loading</> : 'Show more'}
        </button>
      )}
    </div>
  );
}

function Portrait({ token, listing, style }: { token: string; listing: Listing; style?: CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listingThumb(token, listing.id, listing.updatedAt).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [token, listing.id, listing.updatedAt]);
  return (
    <div style={{
      aspectRatio: '4 / 5', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)',
      border: '1px solid var(--glass-border)', ...style,
    }}>
      {src && <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
}

function Card({ token, listing, delay, onOpen }: { token: string; listing: Listing; delay: number; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="mk-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 12 }}
    >
      <Portrait token={token} listing={listing} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, padding: '0 2px' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.name}</span>
        {listing.ownerName && <span style={{ ...META, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>by {listing.ownerName}</span>}
      </span>
    </motion.button>
  );
}

function Detail({ token, listing, onInstall, onDone }: {
  token: string; listing: Listing; onInstall: Props['onInstall']; onDone: () => void;
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
      onDone();
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

  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Portrait token={token} listing={listing} style={{ width: 220, flexShrink: 0 }} />
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {listing.ownerName && <span style={META}>Shared by {listing.ownerName}</span>}
        {listing.blurb && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', maxWidth: '60ch' }}>{listing.blurb}</p>}
        <div style={{ ...META, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{listing.hasVoice ? 'Comes with their own voice' : `Speaks with ${listing.setup.voiceFrom ?? 'a built-in'} voice`}</span>
          <span>{listing.downloads === 1 ? 'Added once' : listing.downloads > 1 ? `Added ${listing.downloads} times` : 'New'}</span>
        </div>
        {listing.mine ? (
          <p style={{ ...META, margin: 0 }}>This one is yours. Manage it from Yours.</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <motion.button type="button" onClick={add} disabled={!!step} whileTap={{ scale: 0.98 }} className="mk-focus"
              style={{ ...PRIMARY, opacity: step ? 0.85 : 1, cursor: step ? 'default' : 'pointer' }}>
              {step ? <><Spinner /> {step}</> : 'Add to my characters'}
            </motion.button>
          </div>
        )}
        {error && <p style={{ ...META, margin: 0, color: '#e8a0a0' }}>{error}</p>}
        {!listing.mine && (
          reported ? <p style={{ ...META, margin: 0 }}>Thanks. We will take a look.</p>
          : reporting ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
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
              Report
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Yours({ token, shareables, onShare, onOpen, onDeleted }: {
  token: string; shareables: Props['shareables']; onShare: Props['onShare'];
  onOpen: (l: Listing) => void; onDeleted: (id: string) => void;
}) {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    myListings(token)
      .then((l) => { if (live) setItems(l.filter((x) => x.status !== 'uploading')); })
      .catch((e) => { if (live) setError(e instanceof MarketError ? e.message : 'Community is unavailable right now.'); });
    return () => { live = false; };
  }, [token]);

  const setVisibility = async (l: Listing, visibility: 'public' | 'private') => {
    setItems((prev) => prev?.map((x) => (x.id === l.id ? { ...x, visibility } : x)) ?? null);
    try {
      await updateListing(token, l.id, { visibility });
    } catch (e) {
      setItems((prev) => prev?.map((x) => (x.id === l.id ? l : x)) ?? null);
      setError(e instanceof Error ? e.message : 'That did not save.');
    }
  };
  const remove = async (l: Listing) => {
    try {
      await deleteListing(token, l.id);
      setItems((prev) => prev?.filter((x) => x.id !== l.id) ?? null);
      onDeleted(l.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not delete.');
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {shareables.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {shareables.map((s, i) => (
            <button key={s.id} type="button" onClick={() => onShare(s.id)} className="mk-focus"
              style={i === 0 ? PRIMARY : PILL}>
              Share {s.name}
            </button>
          ))}
        </div>
      )}
      {error && <p style={{ ...META, margin: 0 }}>{error}</p>}
      {!error && items === null && <p style={{ ...META, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading</p>}
      {!error && items?.length === 0 && shareables.length === 0 && (
        <p style={{ ...META, margin: 0 }}>
          You have not shared anyone yet. After you bring a character in and set them up, you can share them from here.
        </p>
      )}
      {items?.map((l) => (
        <div key={l.id} style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: 10, borderRadius: 14,
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
        }}>
          <button type="button" onClick={() => onOpen(l)} className="mk-card" aria-label={`Open ${l.name}`} style={{ all: 'unset', cursor: 'pointer', width: 52, flexShrink: 0, borderRadius: 10 }}>
            <Portrait token={token} listing={l} style={{ borderRadius: 10 }} />
          </button>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
            <span style={META}>
              {l.visibility === 'public' ? 'Everyone can find them' : 'Only you'}
              {l.downloads > 0 ? `, added ${l.downloads === 1 ? 'once' : `${l.downloads} times`}` : ''}
            </span>
          </div>
          {confirmDelete === l.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...META, maxWidth: 190 }}>Delete? People who added them keep their copy.</span>
              <button type="button" onClick={() => void remove(l)} className="mk-focus" style={{ ...PILL, borderColor: 'rgba(196,68,68,0.55)', color: '#e8a0a0' }}>Delete</button>
              <button type="button" onClick={() => setConfirmDelete(null)} className="mk-focus" style={{ ...PILL, border: 'none', color: 'var(--text-ghost)' }}>Keep</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div role="radiogroup" aria-label={`Who can find ${l.name}`} style={{ display: 'flex', padding: 2, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)' }}>
                {(['public', 'private'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={l.visibility === v} onClick={() => void setVisibility(l, v)} className="mk-focus"
                    style={{
                      ...PILL, border: 'none', padding: '5px 11px', fontSize: 11.5,
                      background: l.visibility === v ? 'rgba(255,255,255,0.12)' : 'transparent',
                      fontWeight: l.visibility === v ? 600 : 500,
                      color: l.visibility === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}>
                    {v === 'public' ? 'Everyone' : 'Only me'}
                  </button>
                ))}
              </div>
              <button type="button" aria-label={`Delete ${l.name}`} onClick={() => setConfirmDelete(l.id)} className="mk-focus"
                style={{ ...PILL, border: 'none', padding: 7, color: 'var(--text-ghost)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const BACK: CSSProperties = {
  width: 32, height: 32, padding: 0, borderRadius: '50%', flexShrink: 0,
  background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.10)', color: 'var(--text-primary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};
