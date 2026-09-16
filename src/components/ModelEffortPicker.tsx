// Model + effort in the input bar (2026-09-16). One quiet chip right of the
// history toggle shows the chat model and its thinking effort; it opens a
// list above the bar with the provider's live models and, when the chosen
// model has a thinking control, an effort row. A pick is saved straight to
// the key profile Settings > Chat edits (llm_model, chat_thinking_effort),
// so the next turn uses it; soul reads the profile per request.
//
// The model list and the thinking capabilities come from the same
// /validate_keys probe Settings uses (about 50 ms on a warm soul), fetched
// when the profile loads (so the chip shows the effort) and again each time
// the list opens, so newly pulled Ollama tags and a changed key show up. Providers stay in Settings: switching provider means a different key.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import {
  fetchApiKeys, saveApiKeys, validateKeys, filterChatModels, getProvider,
  thinkingCapabilityFor, thinkingOptionsFor, normalizeThinkingValue,
  type ApiKeysProfile, type ThinkingCapability, type ThinkingEffort,
} from '../services/apiKeys';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** CLI subscriptions sign in outside the app; every other cloud provider
 *  needs its key before it can list models. */
const KEYLESS = new Set(['claude-code', 'gemini-cli', 'codex', 'ollama']);

function bareModel(id: string | null | undefined): string {
  if (!id) return '';
  return id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

function effortLabel(cap: ThinkingCapability | null, effort: ThinkingEffort): string | null {
  if (!cap) return null;
  const value = normalizeThinkingValue(cap, effort);
  return thinkingOptionsFor(cap).find((o) => o.id === value)?.label ?? null;
}

export function ModelEffortPicker({
  activeModel, onChanged, reduce,
}: {
  /** The saved chat model App knows about; a change (Settings saved) re-reads the profile. */
  activeModel: string | null;
  /** After a pick is saved: App refreshes its active model and vision check. */
  onChanged: () => void;
  reduce: boolean;
}) {
  const [keys, setKeys] = useState<ApiKeysProfile | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [caps, setCaps] = useState<Record<string, ThinkingCapability>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ right: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const saveSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    void fetchApiKeys().then((k) => { if (alive) setKeys(k); }).catch(() => {});
    return () => { alive = false; };
  }, [activeModel]);

  const provider = keys?.llm_provider ?? null;
  const info = getProvider(provider);
  const canList = !!provider && (KEYLESS.has(provider) || !!keys?.llm_api_key?.trim());

  // Probe when the profile loads (so the chip can show the effort before
  // the list is ever opened) and again on each open: the live model ids and
  // each one's thinking capability.
  const apiKey = keys?.llm_api_key ?? null;
  useEffect(() => {
    if (!keys || !provider || !canList) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void validateKeys({ ...keys, agentic_enabled: false, grounding_search_enabled: false })
      .then((res) => {
        if (!alive) return;
        setCaps((prev) => ({ ...prev, ...(res.llm?.thinking_caps ?? {}) }));
        const raw = res.llm?.ok ? res.llm.models ?? [] : [];
        setModels(filterChatModels(provider, raw));
        if (!res.llm?.ok) setError(res.llm?.error || `${info?.label ?? 'Provider'} is not reachable`);
      })
      .catch(() => { if (alive) setError('Could not reach the local server'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider, apiKey, !!keys]);

  const measure = useCallback(() => {
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 8 });
  }, []);
  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Optimistic: the chip changes at once; a failed save puts the old
  // profile back and says so in the list.
  const save = useCallback(async (patch: Partial<ApiKeysProfile>) => {
    if (!keys) return;
    const before = keys;
    const next = { ...keys, ...patch };
    setKeys(next);
    const seq = ++saveSeq.current;
    const ok = await saveApiKeys(next).catch(() => false);
    if (seq !== saveSeq.current) return;
    if (!ok) {
      setKeys(before);
      setError('Could not save that change');
      return;
    }
    setError(null);
    onChanged();
  }, [keys, onChanged]);

  if (!keys || !provider || !keys.llm_model) return null;

  const current = keys.llm_model;
  const cap = thinkingCapabilityFor(current, caps);
  const effort = effortLabel(cap, keys.chat_thinking_effort);
  const listed = models.map((raw) => (raw.startsWith(`${provider}:`) ? raw : `${provider}:${raw}`));
  // The saved model stays pickable even when the probe did not list it.
  if (!listed.includes(current)) listed.unshift(current);

  const pickModel = (id: string) => {
    if (id === current) return;
    const nextCap = thinkingCapabilityFor(id, caps);
    const patch: Partial<ApiKeysProfile> = { llm_model: id };
    if (nextCap) patch.chat_thinking_effort = normalizeThinkingValue(nextCap, keys.chat_thinking_effort);
    void save(patch);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0, flexShrink: 1 }}>
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Chat model and thinking effort"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          minWidth: 0, maxWidth: 190,
          fontSize: 12.5, fontWeight: 500, letterSpacing: '0.01em',
          color: open ? 'var(--text-primary)' : 'var(--text-secondary)',
          background: open ? 'var(--glass-bg-hover)' : 'transparent',
          border: 'none', padding: '4px 7px', borderRadius: 7,
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background 150ms var(--ease-out-quart), color 150ms var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => { if (!open) { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bareModel(current)}
          {effort && <span style={{ color: 'var(--text-ghost)' }}>{` · ${effort}`}</span>}
        </span>
        <ChevronDown
          size={12} strokeWidth={2.75}
          style={{
            flexShrink: 0, color: 'var(--text-ghost)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms var(--ease-out-quart)',
          }}
        />
      </button>

      {/* Portaled for the same reason as the agent list: the bar's glass
          capsule clips overflow. Opens upward, right-aligned to the chip. */}
      {createPortal(
        <AnimatePresence>
          {open && menuPos && (
            <motion.div
              ref={listRef}
              role="dialog"
              aria-label="Chat model and thinking effort"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
              style={{
                position: 'fixed', right: menuPos.right, bottom: menuPos.bottom,
                width: 236,
                maxHeight: Math.min(420, Math.max(180, window.innerHeight - menuPos.bottom - 24)),
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                padding: 5, transformOrigin: 'bottom right',
                background: 'rgba(30, 36, 50, 0.98)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
                boxShadow: '0 12px 34px -8px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
                zIndex: 1000,
              }}
            >
              <SectionLabel>
                {info?.label ?? 'Model'}
                {loading && <Loader2 size={10} className="animate-spin" style={{ marginLeft: 6 }} aria-label="Loading models" />}
              </SectionLabel>
              <div role="listbox" className="no-scrollbar" style={{ overflowY: 'auto', minHeight: 0, flex: '0 1 auto' }}>
                {listed.map((id) => {
                  const active = id === current;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pickModel(id)}
                      style={{
                        width: '100%', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 8,
                        fontSize: 13, fontWeight: active ? 600 : 500, letterSpacing: '0.01em',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        background: active ? 'var(--glass-bg-hover)' : 'transparent',
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 120ms var(--ease-out-quart)',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bareModel(id)}</span>
                      {active && <Check size={14} strokeWidth={2.5} style={{ flexShrink: 0, opacity: 0.9 }} aria-hidden />}
                    </button>
                  );
                })}
              </div>

              {cap && (
                <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                  <SectionLabel>Thinking</SectionLabel>
                  <div role="radiogroup" aria-label="Thinking effort" style={{ display: 'flex', gap: 2, padding: '0 3px 3px' }}>
                    {thinkingOptionsFor(cap).map((o) => {
                      const active = o.id === normalizeThinkingValue(cap, keys.chat_thinking_effort);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => { if (!active) void save({ chat_thinking_effort: o.id }); }}
                          style={{
                            flex: 1, padding: '5px 0', borderRadius: 7,
                            fontSize: 12, fontWeight: active ? 600 : 500, letterSpacing: '0.01em',
                            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                            background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            transition: 'background 120ms var(--ease-out-quart), color 120ms var(--ease-out-quart)',
                          }}
                          onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                          onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(error || !canList) && (
                <div style={{ padding: '6px 9px 4px', fontSize: 11.5, lineHeight: 1.4, color: 'var(--text-ghost)' }}>
                  {!canList ? 'Add your key in Settings to see more models.' : error}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '5px 8px 4px',
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text-ghost)',
    }}>
      {children}
    </div>
  );
}
