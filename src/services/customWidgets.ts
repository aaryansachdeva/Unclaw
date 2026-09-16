// Custom glance widgets: built from a description by the connected model
// (soul's widget_* tools) or restored from the account. Soul owns the
// specs (<data>/custom_widgets.json) and fetches the sources; the app
// only draws the rendered payload with the glance vocabulary. Header
// values never leave the machine (soul redacts them).

import { getSoulBaseUrl } from './soulBase';

export type WidgetKind = 'list' | 'metric' | 'text';

export interface WidgetSource {
  kind: 'http_json' | 'rss' | 'mcp' | 'static';
  url?: string;
  headers?: Record<string, string>;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
}

export interface WidgetSpec {
  id: string;
  label: string;
  summary?: string;
  refresh_min: number;
  source: WidgetSource;
  view: { type: WidgetKind; [k: string]: unknown };
  actions?: { kind: 'open_url' | 'send_to_chat'; label?: string }[];
  status: 'draft' | 'active';
  created_at?: number;
  updated_at?: number;
}

export interface WidgetItem {
  title: string;
  meta?: string;
  value?: string;
  url?: string;
}

export interface WidgetData {
  id: string;
  label: string;
  kind: WidgetKind;
  items: WidgetItem[];
  value?: string;
  unit?: string;
  delta?: string;
  caption?: string;
  text?: string;
  meta?: string;
  url?: string;
  fetched_at?: number;
  stale?: boolean;
  error?: string;
}

export interface CustomWidget {
  spec: WidgetSpec;
  data: WidgetData | null;
}

export const customKey = (id: string) => `custom:${id}` as const;
export const customIdOf = (key: string): string | null =>
  key.startsWith('custom:') ? key.slice('custom:'.length) : null;

async function call<T>(path: string, init: RequestInit = {}, ms = 25_000): Promise<T> {
  const res = await fetch(`${getSoulBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`soul ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** All custom widgets with their rendered data; [] when soul is away. */
export async function listCustomWidgets(): Promise<CustomWidget[]> {
  try {
    const out = await call<{ widgets: CustomWidget[] }>('/widgets/custom');
    return Array.isArray(out.widgets) ? out.widgets : [];
  } catch {
    return [];
  }
}

export async function setWidgetStatus(id: string, status: 'draft' | 'active'): Promise<CustomWidget | null> {
  try {
    const out = await call<{ widget: WidgetSpec; data: WidgetData }>(
      `/widgets/custom/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) });
    return { spec: out.widget, data: out.data };
  } catch {
    return null;
  }
}

export async function deleteCustomWidget(id: string): Promise<boolean> {
  try {
    await call(`/widgets/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

export async function refreshCustomWidget(id: string): Promise<CustomWidget | null> {
  try {
    const out = await call<{ widget: WidgetSpec; data: WidgetData }>(
      `/widgets/custom/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
    return { spec: out.widget, data: out.data };
  } catch {
    return null;
  }
}

/** Restore a spec from the account onto this machine (no-op when soul
 *  already has that id). */
export async function restoreCustomWidget(spec: WidgetSpec): Promise<void> {
  try {
    await call('/widgets/custom', {
      method: 'POST',
      body: JSON.stringify({ spec, status: spec.status || 'active' }),
    });
  } catch { /* soul away; the next boot retries */ }
}

/** The account copy of a spec: no header values, no volatile fields. */
export function specForAccount(spec: WidgetSpec): WidgetSpec {
  const { created_at: _c, updated_at: _u, ...rest } = spec;
  const source = { ...rest.source };
  if (source.headers) source.headers = Object.fromEntries(Object.keys(source.headers).map((k) => [k, '']));
  return { ...rest, source };
}
