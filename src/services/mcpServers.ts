// User MCP servers (Settings > Tools). Soul keeps them in <data>/mcp.json
// on this machine, spawns each one on its first tool call and stops it
// when idle. Secrets (env, headers) come back redacted as "••••"; sending
// that marker back keeps the stored value.

import { getSoulBaseUrl } from './soulBase';

export type ServerStatus = 'running' | 'stopped' | 'pending' | 'error' | 'disabled' | 'invalid';

export interface McpServerRow {
  name: string;
  builtin: boolean;
  label: string;
  description: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string | null;
  args: string[];
  url?: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
  disabled: boolean;
  note: string;
  error?: string | null;
  status: ServerStatus;
  tool_count: number;
  tool_names: string[];
  core_tools: string[];
  last_used?: number | null;
  idle_shutdown_s?: number | null;
}

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: 'http' | 'sse';
  disabled?: boolean;
  note?: string;
  core_tools?: string[];
}

export interface ImportSource {
  app: string;
  path: string;
  servers: { name: string; entry: McpServerEntry; already: boolean }[];
}

export interface ToolCatalog {
  core: string[];
  deferred_count: number;
  groups: { name: string; label: string; description: string; user: boolean; core: string[]; deferred: string[] }[];
}

async function call<T>(path: string, init: RequestInit = {}, ms = 30_000): Promise<T> {
  const res = await fetch(`${getSoulBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) {
    let detail = `soul ${path} ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch { /* keep the status line */ }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const listMcpServers = () => call<{ servers: McpServerRow[]; config_path: string }>('/mcp/servers');

export const saveMcpServer = (name: string, entry: McpServerEntry) =>
  call<{ server: McpServerRow }>(`/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'PUT', body: JSON.stringify(entry),
  });

export const deleteMcpServer = (name: string) =>
  call<{ ok: boolean; servers: McpServerRow[] }>(`/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const restartMcpServer = (name: string) =>
  call<{ ok: boolean; server: McpServerRow }>(`/mcp/servers/${encodeURIComponent(name)}/restart`, { method: 'POST' }, 100_000);

export const testMcpServer = (name: string) =>
  call<{ ok: boolean; seconds: number; server: McpServerRow }>(`/mcp/servers/${encodeURIComponent(name)}/test`, { method: 'POST' }, 100_000);

export const listImportSources = () => call<{ sources: ImportSource[] }>('/mcp/import/sources');

export const importMcpServers = (app: string, names: string[]) =>
  call<{ added: string[]; servers: McpServerRow[] }>('/mcp/import', {
    method: 'POST', body: JSON.stringify({ app, names }),
  });

export const getToolCatalog = () => call<ToolCatalog>('/tools/catalog');

/** Turn a pasted line like `npx -y @scope/server --flag` or a URL into an entry. */
export function parseServerInput(raw: string): McpServerEntry | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return { url: s };
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      // Accept a whole {"mcpServers": {name: entry}} paste too: first entry.
      const servers = obj.mcpServers as Record<string, McpServerEntry> | undefined;
      const entry = servers ? Object.values(servers)[0] : (obj as McpServerEntry);
      if (entry && (entry.command || entry.url)) return entry;
    } catch { /* not JSON */ }
    return null;
  }
  const parts = s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^["']|["']$/g, '')) ?? [];
  if (parts.length === 0) return null;
  const env: Record<string, string> = {};
  while (parts.length && /^[A-Z_][A-Z0-9_]*=/.test(parts[0])) {
    const [k, ...v] = parts.shift()!.split('=');
    env[k] = v.join('=');
  }
  if (parts.length === 0) return null;
  const [command, ...args] = parts;
  return { command, args, ...(Object.keys(env).length ? { env } : {}) };
}

/** A name for a pasted entry: the package or host. */
export function suggestServerName(entry: McpServerEntry): string {
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';
  if (entry.url) {
    try { return slug(new URL(entry.url).hostname.replace(/^(mcp|api|www)\./, '').split('.')[0]); } catch { return 'remote'; }
  }
  const pkg = (entry.args || []).find((a) => !a.startsWith('-') && /[@/]|server|mcp/i.test(a));
  if (pkg) return slug(pkg.replace(/^@[^/]+\//, '').replace(/^(server-|mcp-server-|mcp-)/, '').replace(/(-mcp|-server)$/, '').replace(/@.*$/, ''));
  return slug(entry.command || 'server');
}
