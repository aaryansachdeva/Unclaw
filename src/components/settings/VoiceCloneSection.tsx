// Settings > Voice: the user's own cloned voices for the local clone
// engines. Record ten seconds or drop a clip, name it, and the stem works on
// Pocket and Chatterbox alike (soul keeps one clip per voice and each engine
// caches its own state from it). A voice can be set for everyone (the
// override in the keys profile) or assigned to one agent in the roster.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, Upload, Trash2, Check, Users } from 'lucide-react';

import {
  listCustomVoices, cloneVoice, deleteCustomVoice, recordClip, type CustomVoice,
} from '../../services/voices';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const INPUT: CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
  borderRadius: 9,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  outline: 'none',
  letterSpacing: '-0.005em',
  boxSizing: 'border-box',
};

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px',
  background: 'transparent',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.12))',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500, letterSpacing: '-0.005em',
  cursor: 'pointer', whiteSpace: 'nowrap',
};

const BTN_ACCENT: CSSProperties = {
  ...BTN,
  borderColor: 'rgba(196, 68, 68, 0.55)',
  color: '#e8a0a0',
};

const LABEL: CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-ghost)',
};

const META: CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.005em', lineHeight: 1.45 };

const MAX_MS = 15000;

export interface VoiceAgentRow {
  id: string;
  label: string;
  voice?: string;
}

interface Props {
  /** The "one voice for everyone" pair from the keys profile. */
  overrideVoice: string | null;
  overrideOn: boolean;
  onOverrideChange: (voice: string | null, on: boolean) => void;
  /** Roster instances for the per-agent picker. Absent = picker hidden. */
  agents?: VoiceAgentRow[];
  onAssignVoice?: (instanceId: string, slug: string | undefined) => void;
}

export function VoiceCloneSection({ overrideVoice, overrideOn, onOverrideChange, agents, onAssignVoice }: Props) {
  const [voices, setVoices] = useState<CustomVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVoices(await listCustomVoices());
      setError(null);
    } catch (e) {
      setVoices([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (busy !== 'recording') return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [busy]);

  const submit = useCallback(async (clip: Blob, filename: string) => {
    setBusy('uploading');
    setError(null);
    try {
      const v = await cloneVoice(name.trim() || 'My voice', clip, filename);
      setJustAdded(v.slug);
      setName('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('idle');
    }
  }, [name, refresh]);

  const startRecording = useCallback(async () => {
    setError(null);
    setElapsedMs(0);
    try {
      const rec = recordClip(MAX_MS);
      stopRef.current = rec.stop;
      setBusy('recording');
      const blob = await rec.done;
      stopRef.current = null;
      const ext = rec.mimeType.includes('mp4') ? 'm4a' : 'webm';
      await submit(blob, `take.${ext}`);
    } catch (e) {
      stopRef.current = null;
      setBusy('idle');
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in System Settings > Privacy > Microphone.'
        : (e instanceof Error ? e.message : String(e)));
    }
  }, [submit]);

  const stopRecording = useCallback(() => { stopRef.current?.(); }, []);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    await submit(f, f.name);
    if (fileRef.current) fileRef.current.value = '';
  }, [submit]);

  const remove = useCallback(async (slug: string) => {
    try {
      await deleteCustomVoice(slug);
      if (overrideVoice === slug) onOverrideChange(null, false);
      agents?.forEach((a) => { if (a.voice === slug) onAssignVoice?.(a.id, undefined); });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agents, onAssignVoice, onOverrideChange, overrideVoice, refresh]);

  const seconds = Math.min(MAX_MS, elapsedMs) / 1000;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
          <span style={LABEL}>Your voices</span>
          <span style={{ ...META, fontSize: 10.5 }}>work on Pocket and Chatterbox</span>
        </div>

        {voices === null ? (
          <div style={META}>Looking for voices…</div>
        ) : voices.length === 0 ? (
          <div style={META}>No cloned voices yet. Record ten seconds below and any agent can speak with it.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <AnimatePresence initial={false}>
              {voices.map((v) => {
                const isOverride = overrideOn && overrideVoice === v.slug;
                const users = (agents ?? []).filter((a) => a.voice === v.slug);
                return (
                  <motion.div
                    key={v.slug}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--glass-border, rgba(255,255,255,0.10))',
                      borderRadius: 10,
                      background: justAdded === v.slug ? 'rgba(196, 68, 68, 0.08)' : 'rgba(255,255,255,0.025)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.name}
                      </div>
                      <div style={META}>
                        {v.seconds.toFixed(1)} s
                        {isOverride ? ' · everyone' : users.length ? ` · ${users.map((u) => u.label).join(', ')}` : ''}
                      </div>
                    </div>
                    {agents && agents.length > 0 && onAssignVoice && (
                      <select
                        aria-label={`Assign ${v.name} to an agent`}
                        value=""
                        onChange={(e) => { if (e.target.value) onAssignVoice(e.target.value, v.slug); e.target.value = ''; }}
                        style={{ ...INPUT, width: 'auto', padding: '5px 8px', fontSize: 11.5 }}
                      >
                        <option value="">Assign to…</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.label}{a.voice === v.slug ? ' (using it)' : ''}</option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      style={isOverride ? BTN_ACCENT : BTN}
                      onClick={() => onOverrideChange(isOverride ? null : v.slug, !isOverride)}
                      title={isOverride ? 'Stop using this voice for every agent' : 'Use this voice for every agent'}
                    >
                      {isOverride ? <Check size={12} /> : <Users size={12} />}
                      {isOverride ? 'Everyone' : 'Everyone'}
                    </button>
                    <button type="button" style={BTN} onClick={() => void remove(v.slug)} title="Delete this voice">
                      <Trash2 size={12} />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
          <span style={LABEL}>Clone a voice</span>
          <span style={{ ...META, fontSize: 10.5 }}>6 to 15 seconds of clean speech, no music</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Name this voice"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy !== 'idle'}
            style={INPUT}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {busy === 'recording' ? (
              <button type="button" style={BTN_ACCENT} onClick={stopRecording}>
                <Square size={12} /> Stop · {seconds.toFixed(1)} s
              </button>
            ) : (
              <button type="button" style={BTN} onClick={() => void startRecording()} disabled={busy !== 'idle'}>
                <Mic size={12} /> Record
              </button>
            )}
            <button type="button" style={BTN} onClick={() => fileRef.current?.click()} disabled={busy !== 'idle'}>
              <Upload size={12} /> Choose a file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
              hidden
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {busy === 'uploading' && <span style={META}>Cloning…</span>}
            {busy === 'recording' && (
              <span style={META}>Speak naturally. Stops by itself at 15 s.</span>
            )}
          </div>
          {error && (
            <div style={{ ...META, color: 'var(--danger, #e06c6c)' }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
