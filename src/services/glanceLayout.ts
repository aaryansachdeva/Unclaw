// Which glances the column shows and in what order. Persisted per install
// in localStorage like the agent stack; following the account through the
// settings blob is a follow-up (see project-cloud-sync-architecture).
//
// Custom widgets (services/customWidgets) are `custom:<id>` keys. A new
// one appears at the bottom on its own; removing it in edit mode lists it
// under `hidden` instead of just dropping it from `order`, so "not in
// order" keeps meaning "never placed yet".

import type { SheetKey } from '../hooks/useSheet';

export type GlanceKey = Exclude<SheetKey, 'wardrobe'>;
export type BuiltinGlanceKey = 'reminders' | 'weather' | 'stocks' | 'news';

export const ALL_GLANCES: BuiltinGlanceKey[] = ['reminders', 'weather', 'stocks', 'news'];

const BUILTIN_LABELS: Record<BuiltinGlanceKey, string> = {
  reminders: 'Reminders',
  weather: 'Weather',
  stocks: 'Stocks',
  news: 'News',
};

export const isCustomKey = (k: string): k is `custom:${string}` => k.startsWith('custom:');
export const isBuiltinKey = (k: string): k is BuiltinGlanceKey => (ALL_GLANCES as string[]).includes(k);

export function glanceLabel(key: GlanceKey, customLabels: Record<string, string> = {}): string {
  if (isCustomKey(key)) return customLabels[key] ?? 'Widget';
  return BUILTIN_LABELS[key];
}

export interface GlanceLayout {
  /** Visible glances, top to bottom. */
  order: GlanceKey[];
  /** Custom widgets the user removed from the column. */
  hidden?: GlanceKey[];
}

const KEY = 'unclaw.glanceLayout.v1';

export const DEFAULT_GLANCE_LAYOUT: GlanceLayout = { order: [...ALL_GLANCES], hidden: [] };

const validKey = (k: unknown): k is GlanceKey =>
  typeof k === 'string' && (isBuiltinKey(k) || (isCustomKey(k) && k.length > 'custom:'.length));

function keys(raw: unknown): GlanceKey[] | null {
  return Array.isArray(raw)
    ? (raw as unknown[]).filter((k, i, arr): k is GlanceKey => validKey(k) && arr.indexOf(k) === i)
    : null;
}

function sanitize(raw: unknown): GlanceLayout {
  const order = keys((raw as GlanceLayout | null)?.order);
  const hidden = keys((raw as GlanceLayout | null)?.hidden) ?? [];
  return order ? { order, hidden: hidden.filter((k) => isCustomKey(k) && !order.includes(k)) } : { ...DEFAULT_GLANCE_LAYOUT };
}

export function loadGlanceLayout(): GlanceLayout {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_GLANCE_LAYOUT };
  } catch {
    return { ...DEFAULT_GLANCE_LAYOUT };
  }
}

export function saveGlanceLayout(layout: GlanceLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(layout)));
  } catch { /* storage unavailable; the session still works */ }
}

/** What the column shows, top to bottom: the saved order (minus custom
 *  widgets that no longer exist) then any custom widget not placed yet. */
export function visibleGlances(layout: GlanceLayout, customKeys: string[]): GlanceKey[] {
  const hidden = new Set(layout.hidden ?? []);
  const existing = layout.order.filter((k) => !isCustomKey(k) || customKeys.includes(k));
  const fresh = customKeys.filter((k): k is `custom:${string}` => isCustomKey(k) && !existing.includes(k) && !hidden.has(k));
  return [...existing, ...fresh];
}

/** Glances not currently shown: built-ins left out of the order, then
 *  custom widgets the user removed. */
export function hiddenGlances(layout: GlanceLayout, customKeys: string[] = []): GlanceKey[] {
  const builtins = ALL_GLANCES.filter((k) => !layout.order.includes(k));
  const customs = (layout.hidden ?? []).filter((k) => customKeys.includes(k));
  return [...builtins, ...customs];
}

export function removeGlance(layout: GlanceLayout, key: GlanceKey): GlanceLayout {
  const order = layout.order.filter((k) => k !== key);
  const hidden = (layout.hidden ?? []).filter((k) => k !== key);
  return { order, hidden: isCustomKey(key) ? [...hidden, key] : hidden };
}

export function addGlance(layout: GlanceLayout, key: GlanceKey): GlanceLayout {
  return {
    order: layout.order.includes(key) ? layout.order : [...layout.order, key],
    hidden: (layout.hidden ?? []).filter((k) => k !== key),
  };
}
