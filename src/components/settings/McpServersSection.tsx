// Settings > Tools: the user's own MCP servers. Soul keeps them in its
// mcp.json, starts each one on its first tool call and stops it when idle,
// so adding a server costs nothing until the model reaches for it. Paste a
// command or URL, import from the other AI apps on this Mac, or toggle
// what is there. Built-ins are listed underneath, read-only, so the user
// can see what "on demand" covers.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Trash2, Download, Play, Check, X } from 'lucide-react';

import {
  listMcpServers, saveMcpServer, deleteMcpServer, testMcpServer, restartMcpServer,
  listImportSources, importMcpServers, getToolCatalog, parseServerInput, suggestServerName,
  type McpServerRow, type ImportSource, type ToolCatalog, type McpServerEntry,
} from '../../services/mcpServers';

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

const LABEL: CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-ghost)',
};

const META: CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.005em', lineHeight: 1.45 };

const STATUS_COLOR: Record<McpServerRow['status'], string> = {
  running: 'var(--live)',
  stopped: 'var(--text-ghost)',
  pending: 'var(--text-ghost)',
  error: 'var(--danger)',
  invalid: 'var(--danger)',
  disabled: 'transparent',
};

const STATUS_WORD: Record<McpServerRow['status'], string> = {
  running: 'running',
  stopped: 'on demand',
  pending: 'checking',
  error: 'failed',
  invalid: 'invalid',
  disabled: 'off',
};

function Dot({ status }: { status: McpServerRow['status'] }) {
  return (
    <span
      aria-hidden
      style={{
        width: 6, height: 6, borderRadius: 999, flex: '0 0 auto',
        background: STATUS_COLOR[status],
        border: status === 'disabled' ? '1px solid var(--text-ghost)' : 'none',
        boxShadow: status === 'running' ? '0 0 6px var(--live)' : 'none',
      }}
    />
  );
}

function Ghost({ children, onClick, title, disabled, primary }: {
  children: ReactNode; onClick: () => void; title?: string; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...BTN,
        ...(primary ? { background: 'var(--accent)', border: '1px solid rgba(255,200,190,0.42)', color: '#fff', fontWeight: 600 } : {}),
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function IconButton({ children, onClick, label, danger, busy }: {
  children: ReactNode; onClick: () => void; label: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 6,
        background: 'transparent', border: 'none',
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 0.85,
      }}
    >
      {children}
    </button>
  );
}

function ServerRow({ row, onChange }: { row: McpServerRow; onChange: (rows?: McpServerRow[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try { await fn(); } catch (e) { console.warn('[mcp]', what, e); }
    setBusy(null);
    onChange();
  };
  const where = row.url ?? [row.command, ...row.args].filter(Boolean).join(' ');
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '9px 10px',
        borderRadius: 10,
        border: '1px solid var(--glass-border)',
        background: 'rgba(255,255,255,0.025)',
        opacity: row.disabled ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Dot status={row.status} />
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.builtin ? row.label : row.name}
        </span>
        <span style={{ ...META, whiteSpace: 'nowrap' }}>
          {STATUS_WORD[row.status]}{row.tool_count ? ` · ${row.tool_count} tool${row.tool_count === 1 ? '' : 's'}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {!row.builtin && (
          <>
            <IconButton label={row.disabled ? 'Turn on' : 'Turn off'} busy={busy === 'toggle'}
              onClick={() => { void act('toggle', () => saveMcpServer(row.name, { disabled: !row.disabled })); }}>
              {row.disabled ? <Play size={13} strokeWidth={2.2} /> : <Check size={13} strokeWidth={2.4} />}
            </IconButton>
            <IconButton label="Test now" busy={busy === 'test'}
              onClick={() => { void act('test', () => testMcpServer(row.name)); }}>
              <RefreshCw size={13} strokeWidth={2.2} />
            </IconButton>
            <IconButton label="Remove" danger busy={busy === 'delete'}
              onClick={() => { void act('delete', () => deleteMcpServer(row.name)); }}>
              <Trash2 size={13} strokeWidth={2.2} />
            </IconButton>
          </>
        )}
        {row.builtin && row.status === 'running' && (
          <IconButton label="Restart" busy={busy === 'restart'}
            onClick={() => { void act('restart', () => restartMcpServer(row.name)); }}>
            <RefreshCw size={13} strokeWidth={2.2} />
          </IconButton>
        )}
      </div>
      <div style={{ ...META, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={where}>
        {row.description || where}
      </div>
      {row.error && (
        <div style={{ ...META, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{row.error}</div>
      )}
      {row.tool_names.length > 0 && (
        <button
          type="button"
          onClick={() => setShowTools((v) => !v)}
          style={{ ...META, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--text-ghost)', fontFamily: 'inherit' }}
        >
          {showTools ? row.tool_names.join(', ') : `${row.tool_names.slice(0, 4).join(', ')}${row.tool_names.length > 4 ? ` and ${row.tool_names.length - 4} more` : ''}`}
          {row.core_tools.length > 0 && ` · always loaded: ${row.core_tools.join(', ')}`}
        </button>
      )}
    </div>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [raw, setRaw] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [envText, setEnvText] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseServerInput(raw), [raw]);
  useEffect(() => {
    if (parsed && !nameTouched) setName(suggestServerName(parsed));
  }, [parsed, nameTouched]);

  const submit = async () => {
    if (!parsed) { setError('Paste a command like  npx -y @scope/server  or an https:// URL.'); return; }
    const entry: McpServerEntry = { ...parsed, note: note.trim() || undefined };
    const env: Record<string, string> = { ...(parsed.env || {}) };
    for (const line of envText.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    if (Object.keys(env).length) {
      if (entry.url) entry.headers = { ...(entry.headers || {}), ...env };
      else entry.env = env;
    }
    setSaving(true);
    setError(null);
    try {
      const nm = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
      await saveMcpServer(nm, entry);
      void testMcpServer(nm).catch(() => undefined);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 10px', borderRadius: 10, border: '1px solid var(--glass-border-focus, rgba(255,255,255,0.18))', background: 'rgba(255,255,255,0.03)' }}>
      <div>
        <div style={{ ...LABEL, marginBottom: 6 }}>Command or URL</div>
        <input
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="npx -y @modelcontextprotocol/server-github   or   https://mcp.linear.app/mcp"
          style={INPUT}
          spellCheck={false}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
        <div>
          <div style={{ ...LABEL, marginBottom: 6 }}>Name</div>
          <input value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} placeholder="github" style={INPUT} spellCheck={false} />
        </div>
        <div>
          <div style={{ ...LABEL, marginBottom: 6 }}>When to use it</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="my repos, issues and pull requests" style={INPUT} />
        </div>
      </div>
      <div>
        <div style={{ ...LABEL, marginBottom: 6 }}>{parsed?.url ? 'Headers' : 'Environment'} <span style={{ ...META, textTransform: 'none', letterSpacing: 0 }}>one KEY=value per line, kept on this Mac</span></div>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={parsed?.url ? 'Authorization=Bearer …' : 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…'}
          rows={2}
          style={{ ...INPUT, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 }}
          spellCheck={false}
        />
      </div>
      {error && <div style={{ ...META, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Ghost onClick={onCancel}>Cancel</Ghost>
        <Ghost onClick={() => { void submit(); }} disabled={saving || !parsed} primary>
          {saving ? 'Adding…' : 'Add server'}
        </Ghost>
      </div>
    </div>
  );
}

function ImportPanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void listImportSources().then((r) => { if (live) setSources(r.sources); }).catch(() => { if (live) setSources([]); });
    return () => { live = false; };
  }, []);
  const key = (app: string, name: string) => `${app} ${name}`;
  const toggle = (app: string, name: string) => setPicked((prev) => {
    const next = new Set(prev);
    const k = key(app, name);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const run = async () => {
    setBusy(true);
    const byApp = new Map<string, string[]>();
    for (const k of picked) {
      const [app, name] = k.split(' ');
      byApp.set(app, [...(byApp.get(app) ?? []), name]);
    }
    for (const [app, names] of byApp) {
      try { await importMcpServers(app, names); } catch (e) { console.warn('[mcp] import', app, e); }
    }
    setBusy(false);
    onDone();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 10px', borderRadius: 10, border: '1px solid var(--glass-border-focus, rgba(255,255,255,0.18))', background: 'rgba(255,255,255,0.03)' }}>
      {sources === null && <div style={META}>Looking for Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Codex and Gemini CLI configs…</div>}
      {sources && sources.length === 0 && <div style={META}>No MCP configs from other apps were found on this Mac.</div>}
      {sources && sources.map((src) => (
        <div key={src.app}>
          <div style={{ ...LABEL, marginBottom: 6 }}>{src.app} <span style={{ ...META, textTransform: 'none', letterSpacing: 0 }}>{src.path.replace(/^\/Users\/[^/]+/, '~')}</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {src.servers.map((s) => {
              const on = picked.has(key(src.app, s.name));
              return (
                <button
                  key={s.name}
                  type="button"
                  disabled={s.already}
                  onClick={() => toggle(src.app, s.name)}
                  title={s.entry.url ?? [s.entry.command, ...(s.entry.args ?? [])].join(' ')}
                  style={{
                    ...BTN,
                    padding: '5px 10px',
                    background: on ? 'var(--glass-bg-hover)' : 'transparent',
                    borderColor: on ? 'var(--glass-border-focus, rgba(255,255,255,0.22))' : 'var(--glass-border)',
                    opacity: s.already ? 0.4 : 1,
                    cursor: s.already ? 'default' : 'pointer',
                  }}
                >
                  {on ? <Check size={11} strokeWidth={2.6} /> : <Plus size={11} strokeWidth={2.4} />}
                  {s.name}{s.already ? ' · added' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Ghost onClick={onCancel}>Cancel</Ghost>
        <Ghost onClick={() => { void run(); }} disabled={busy || picked.size === 0} primary>
          {busy ? 'Importing…' : `Import ${picked.size || ''}`.trim()}
        </Ghost>
      </div>
    </div>
  );
}

export function McpServersSection() {
  const [rows, setRows] = useState<McpServerRow[] | null>(null);
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [mode, setMode] = useState<'list' | 'add' | 'import'>('list');
  const [unreachable, setUnreachable] = useState(false);

  const reload = useCallback(async (given?: McpServerRow[]) => {
    if (given) { setRows(given); return; }
    try {
      const [s, c] = await Promise.all([listMcpServers(), getToolCatalog().catch(() => null)]);
      setRows(s.servers);
      if (c) setCatalog(c);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
      setRows((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => { void reload(); }, 8000);
    return () => window.clearInterval(id);
  }, [reload]);

  const user = (rows ?? []).filter((r) => !r.builtin);
  const builtin = (rows ?? []).filter((r) => r.builtin);
  const coreLine = catalog ? catalog.core.join(', ') : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={LABEL}>Your servers{user.length ? ` · ${user.length}` : ''}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <Ghost onClick={() => setMode(mode === 'import' ? 'list' : 'import')} title="Import from Claude Desktop, Cursor, Claude Code and others">
            <Download size={12} strokeWidth={2.2} /> Import
          </Ghost>
          <Ghost onClick={() => setMode(mode === 'add' ? 'list' : 'add')}>
            <Plus size={12} strokeWidth={2.4} /> Add
          </Ghost>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {mode !== 'list' && (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          >
            {mode === 'add'
              ? <AddForm onDone={() => { setMode('list'); void reload(); }} onCancel={() => setMode('list')} />
              : <ImportPanel onDone={() => { setMode('list'); void reload(); }} onCancel={() => setMode('list')} />}
          </motion.div>
        )}
      </AnimatePresence>

      {unreachable && <div style={META}>Soul is not reachable right now, so servers cannot be changed.</div>}
      {rows && user.length === 0 && mode === 'list' && (
        <div style={META}>
          None yet. Anything that speaks MCP works: GitHub, Linear, Notion, Slack, your own scripts.
          Servers start only when the model reaches for them and stop again when idle.
        </div>
      )}
      {user.map((r) => <ServerRow key={r.name} row={r} onChange={(given) => { void reload(given); }} />)}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
        <span style={LABEL}>Built in · on demand</span>
        {coreLine && <span style={{ ...META, textAlign: 'right' }}>Always loaded: {coreLine}</span>}
      </div>
      {builtin.map((r) => <ServerRow key={r.name} row={r} onChange={(given) => { void reload(given); }} />)}
    </div>
  );
}
