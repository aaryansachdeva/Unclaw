// Character store client. Talks to the UnClaw store Worker (Polar-backed).
//
// Entitlement is account-bound: the user signs in (required), buys a character
// through a Polar checkout opened in the system browser, the store Worker
// records the grant on the `order.paid` webhook, and this client reads the
// owned set back. The base characters grace + mark are always owned.
//
// All calls attach the UnClaw account JWT as `Authorization: Bearer <token>`,
// mirroring userSettings.ts. The token is owned by App.tsx (authToken state).

// The dedicated store Worker (Polar checkout + entitlements + gated downloads).
// Separate from the auth host; it calls api.unclaw.io/me internally to resolve
// the user from the bearer token.
const STORE_URL = 'https://store.unclaw.io';

// Client-side store config. Owned truth always comes from the Worker
// (fetchEntitlements); these are display defaults + the sku/price map so the
// picker can render Buy pills without a round trip. The base characters are
// free and always owned.
export const BASE_CHARACTER_IDS = ['grace', 'mark'];
export const PAID_CHARACTER_IDS = ['ava', 'goblin', 'chris', 'joi'];
export const STORE_PRICING: Record<string, number> = { ava: 4.99, goblin: 4.99, chris: 4.99, joi: 4.99 };
export const BUNDLE_SKU = 'all-access';
export const BUNDLE_PRICE_USD = 9.99;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Just the owned character ids (fast path for launch + post-purchase poll). */
export async function fetchEntitlements(token: string): Promise<string[]> {
  const res = await fetch(`${STORE_URL}/store/entitlements`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`store /entitlements ${res.status}`);
  const data = (await res.json()) as { owned: string[] };
  return Array.isArray(data.owned) ? data.owned : [];
}

/** Create a Polar checkout for a sku (characterId or 'all-access'); returns
 *  the hosted checkout URL to open in the system browser. */
export async function createCheckout(token: string, sku: string): Promise<{ url: string; checkoutId?: string }> {
  const res = await fetch(`${STORE_URL}/store/checkout`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`store /checkout ${res.status}: ${detail.slice(0, 160)}`);
  }
  return (await res.json()) as { url: string; checkoutId?: string };
}

/** Entitlement-gated: returns a short-lived presigned R2 URL for the pak zip.
 *  403 if the user does not own the character. The Worker serves the pak's
 *  current pointer; the client SHA-verifies against its manifest on download. */
/** Mac and Windows paks are cooked separately and stored under
 *  characters/<id>/<platform>/current.zip. Tell the Worker which one to
 *  presign. Host OS comes from the preload bridge (never UA sniffing). */
function storePlatform(): 'windows' | 'mac' {
  return window.electronAPI?.platform === 'win32' ? 'windows' : 'mac';
}

export async function fetchDownloadUrl(token: string, characterId: string): Promise<string> {
  const res = await fetch(
    `${STORE_URL}/store/characters/${characterId}/download?platform=${storePlatform()}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`store /download ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

/** One gated, presigned voice file: a cloned-voice asset kept in the private
 *  bucket alongside the pak. `kind` tells the main process which soul voices
 *  dir it belongs in (supertonic -> .json, kokoro -> .safetensors). */
export interface VoiceFile {
  kind: 'supertonic' | 'kokoro';
  filename: string;
  url: string;
}

/** Entitlement-gated: presigned R2 URLs for a paid character's cloned voice
 *  files (supertonic JSON + kokoro safetensors). 403 if not owned. These ride
 *  in the private bucket so a voice is never downloadable without owning the
 *  character; the free characters (grace/mark) use the public CDN instead. */
export async function fetchVoiceUrls(token: string, characterId: string): Promise<VoiceFile[]> {
  const res = await fetch(`${STORE_URL}/store/characters/${characterId}/voice`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`store /voice ${res.status}`);
  const data = (await res.json()) as { files: VoiceFile[] };
  return data.files ?? [];
}
