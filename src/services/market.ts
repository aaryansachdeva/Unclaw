// Community marketplace: finished characters people chose to share.
//
// A listing is the character's .unclawchar, the cloned voice clip it speaks
// with, a portrait taken from the live character, and the Unclaw-side setup
// (personality, voice name, outfit, body). Small calls go straight to the
// store; the package and the voice stream through the main process
// (electron/marketplace.ts) so tens of MB never pass through the renderer.

import type { AgentInstance, CharacterVibe } from '../hooks/useAgentStack';
import type { WardrobeSettings } from './userSettings';

/** Must match MARKET_TERMS_VERSION in store-worker/src/market.ts. */
export const MARKET_TERMS_VERSION = '2026-09-19';
export const MARKET_TERMS_URL = 'https://unclaw.io/community-terms';

/** The store, or a local `wrangler dev` in a dev build (localStorage
 *  `unclaw.dev.storeUrl`, e.g. http://127.0.0.1:8799). */
export function marketStoreUrl(): string {
  if (import.meta.env.DEV) {
    try {
      const o = localStorage.getItem('unclaw.dev.storeUrl');
      if (o) return o.replace(/\/+$/, '');
    } catch { /* storage unavailable */ }
  }
  return 'https://store.unclaw.io';
}

export type Visibility = 'private' | 'unlisted' | 'public';

/** What a listing carries besides its files: enough to set the character up
 *  on the receiving side the way its creator had it. */
export interface ListingSetup {
  agentId?: string;
  vibe?: CharacterVibe;
  voiceName?: string;
  voiceFrom?: string;
  wardrobe?: WardrobeSettings;
  bodyAxes?: Record<string, number>;
}

export interface Listing {
  id: string;
  name: string;
  blurb: string;
  ownerName: string;
  mine: boolean;
  visibility: Visibility;
  hasVoice: boolean;
  packageBytes: number;
  downloads: number;
  setup: ListingSetup;
  createdAt: string;
  updatedAt: string;
  status?: 'uploading' | 'ready';
}

export class MarketError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

/** Server error codes, in words a person can act on. */
function explain(code: string | undefined, status: number): string {
  switch (code) {
    case 'terms_not_accepted': return 'Accept the community terms to share.';
    case 'too_many_listings': return 'You have shared the most characters an account can. Delete one to share another.';
    case 'missing_files': return 'The upload did not finish. Try sharing again.';
    case 'bad_length': return 'That file is too large to share.';
    case 'already_published': return 'This character is already shared.';
    case 'not_found': return 'That character is no longer shared.';
    case 'unauthorized': return 'Sign in again to use the community.';
    default: return `The community could not be reached (${status}).`;
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${marketStoreUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MarketError('The community could not be reached. Check your connection.');
  }
  if (!res.ok) {
    let code: string | undefined;
    try { code = ((await res.json()) as { error?: string }).error; } catch { /* no body */ }
    throw new MarketError(explain(code, res.status), code);
  }
  return (await res.json()) as T;
}

export function browseListings(token: string, opts: { q?: string; cursor?: string | null } = {}) {
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.cursor) qs.set('cursor', opts.cursor);
  return call<{ listings: Listing[]; nextCursor: string | null }>(token, `/market/characters?${qs}`);
}

export async function myListings(token: string): Promise<Listing[]> {
  return (await call<{ listings: Listing[] }>(token, '/market/mine')).listings;
}

export function updateListing(token: string, id: string, patch: { visibility?: Visibility; name?: string; blurb?: string }) {
  return call<Listing>(token, `/market/characters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteListing(token: string, id: string): Promise<void> {
  await call(token, `/market/characters/${id}`, { method: 'DELETE' });
}

export async function reportListing(token: string, id: string, reason: string): Promise<void> {
  await call(token, `/market/characters/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
}

/** Listing thumbnails need the account token, so they are fetched once and
 *  kept as object URLs for the session. */
const thumbCache = new Map<string, Promise<string | null>>();
export function listingThumb(token: string, id: string, version: string): Promise<string | null> {
  const key = `${id}@${version}`;
  let p = thumbCache.get(key);
  if (!p) {
    p = fetch(`${marketStoreUrl()}/market/characters/${id}/files/thumb.jpg`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    thumbCache.set(key, p);
  }
  return p;
}

/** A portrait of whoever is on stage right now. The direct renderer cannot be
 *  read back from the page, so the main process captures the window while
 *  every piece of the app's interface is hidden for that one frame. */
export async function captureCharacterThumb(): Promise<Blob | null> {
  const api = window.electronAPI?.market;
  if (!api?.captureThumb) return null;
  const hide = document.createElement('style');
  hide.textContent = 'body *{visibility:hidden!important} canvas,video{visibility:visible!important}';
  document.head.appendChild(hide);
  try {
    // Two frames, so the hidden interface is actually off screen before the capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bytes = await api.captureThumb();
    return bytes && bytes.length ? new Blob([bytes as BlobPart], { type: 'image/jpeg' }) : null;
  } finally {
    hide.remove();
  }
}

/** The instance's identity folder id (the main process keeps its package there). */
export function instanceLocalId(inst: AgentInstance): string | null {
  const id = inst.identity?.sessionId;
  if (id) return id;
  const m = inst.identity?.dnaPath?.match(/[\\/]Identity[\\/]([^\\/]+)[\\/]/);
  return m ? m[1] : null;
}

/** Only characters brought in from Unreal can be shared: photo-built ones are
 *  not available to users yet, and built-in ones are not the user's to share. */
export function canShare(inst: AgentInstance): boolean {
  if (inst.fromListingId) return false;
  return !!inst.identity?.groomsDir || !!instanceLocalId(inst)?.startsWith('ue_');
}

export type ShareStep = 'preparing' | 'character' | 'voice' | 'picture' | 'publishing';

/** Share one character: create the listing, upload its files, publish. A
 *  failure part way removes the half-made listing. */
export async function shareCharacter(args: {
  token: string;
  inst: AgentInstance;
  name: string;
  blurb: string;
  visibility: Visibility;
  voiceName?: string;
  thumb: Blob;
  onStep?: (s: ShareStep) => void;
}): Promise<string> {
  const api = window.electronAPI?.market;
  if (!api) throw new MarketError('This build cannot share characters.');
  const localId = instanceLocalId(args.inst);
  if (!localId) throw new MarketError('This character has no files to share.');
  args.onStep?.('preparing');
  const prepared = await api.prepare({ localId, voice: args.inst.voice });
  if (!prepared.ok) throw new MarketError(prepared.error);
  if (!prepared.voicePath && !args.inst.voiceFrom) {
    throw new MarketError('Give this character a voice before sharing it.');
  }

  const setup: ListingSetup = {
    agentId: args.inst.agentId,
    vibe: args.inst.vibe,
    voiceName: args.voiceName,
    voiceFrom: prepared.voicePath ? undefined : args.inst.voiceFrom,
    wardrobe: args.inst.wardrobe,
    bodyAxes: args.inst.identity?.bodyAxes,
  };
  const { id } = await call<{ id: string }>(args.token, '/market/characters', {
    method: 'POST',
    body: JSON.stringify({
      name: args.name, blurb: args.blurb, visibility: args.visibility, setup,
      termsAccepted: true, termsVersion: MARKET_TERMS_VERSION,
    }),
  });
  const storeUrl = marketStoreUrl();
  try {
    args.onStep?.('character');
    const up = await api.upload({ storeUrl, token: args.token, listingId: id, name: 'character.unclawchar', filePath: prepared.packagePath });
    if (!up.ok) throw new MarketError(`The character did not upload (${up.error ?? up.status}).`);
    if (prepared.voicePath) {
      args.onStep?.('voice');
      const v = await api.upload({ storeUrl, token: args.token, listingId: id, name: 'voice.wav', filePath: prepared.voicePath });
      if (!v.ok) throw new MarketError(`The voice did not upload (${v.error ?? v.status}).`);
    }
    args.onStep?.('picture');
    const pic = await fetch(`${storeUrl}/market/characters/${id}/files/thumb.jpg`, {
      method: 'PUT', headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'image/jpeg' }, body: args.thumb,
    });
    if (!pic.ok) throw new MarketError('The picture did not upload.');
    args.onStep?.('publishing');
    await call(args.token, `/market/characters/${id}/publish`, { method: 'POST' });
    return id;
  } catch (e) {
    void deleteListing(args.token, id).catch(() => undefined);
    throw e;
  }
}

/** Fetch a listing's files. The caller imports the package through the normal
 *  import path and clones the voice clip through soul. */
export async function downloadListingFiles(token: string, listing: Listing): Promise<{ packagePath: string; voice?: Blob }> {
  const api = window.electronAPI?.market;
  if (!api) throw new MarketError('This build cannot add community characters.');
  const r = await api.download({ storeUrl: marketStoreUrl(), token, listingId: listing.id, withVoice: listing.hasVoice });
  if (!r.ok) throw new MarketError(`The character did not download (${r.error}).`);
  return { packagePath: r.packagePath, voice: r.voice ? new Blob([r.voice as BlobPart], { type: 'audio/wav' }) : undefined };
}
