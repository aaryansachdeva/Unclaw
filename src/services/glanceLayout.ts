// Which glances the column shows and in what order. Persisted per install
// in localStorage like the agent stack; following the account through the
// settings blob is a follow-up (see project-cloud-sync-architecture).

import type { SheetKey } from '../hooks/useSheet';

export type GlanceKey = Exclude<SheetKey, 'wardrobe'>;

export const ALL_GLANCES: GlanceKey[] = ['reminders', 'weather', 'stocks', 'news'];

export const GLANCE_LABELS: Record<GlanceKey, string> = {
  reminders: 'Reminders',
  weather: 'Weather',
  stocks: 'Stocks',
  news: 'News',
};

export interface GlanceLayout {
  /** Visible glances, top to bottom. */
  order: GlanceKey[];
}

const KEY = 'unclaw.glanceLayout.v1';

export const DEFAULT_GLANCE_LAYOUT: GlanceLayout = { order: [...ALL_GLANCES] };

function sanitize(raw: unknown): GlanceLayout {
  const order = Array.isArray((raw as GlanceLayout | null)?.order)
    ? ((raw as GlanceLayout).order as unknown[]).filter(
        (k, i, arr): k is GlanceKey =>
          typeof k === 'string' && (ALL_GLANCES as string[]).includes(k) && arr.indexOf(k) === i,
      )
    : null;
  return order ? { order } : { ...DEFAULT_GLANCE_LAYOUT };
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

/** Glances not currently shown, in canonical order. */
export function hiddenGlances(layout: GlanceLayout): GlanceKey[] {
  return ALL_GLANCES.filter((k) => !layout.order.includes(k));
}
