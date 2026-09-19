// Community marketplace: the file side. The renderer talks to the store for
// everything small (listings, visibility, the thumbnail); the character
// package (tens of MB) and the voice clip move here, streamed between disk and
// the store so they never pass through the renderer.

import { app } from 'electron';
import { spawnSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSoulDataDir } from './soulSupervisor';

/** Where the store may be reached from here. Anything else is refused, so a
 *  compromised page cannot turn this into "upload any file anywhere". */
function allowedStore(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' && u.hostname === 'store.unclaw.io')
      || (!app.isPackaged && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
  } catch {
    return false;
  }
}

const identityDir = (localId: string) => path.join(app.getPath('userData'), 'identities', localId);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The package a shared character is built from. A .unclawchar import keeps
 *  its original file (see importUnrealPackage); an older import, or one made
 *  from a folder, is zipped from what was unpacked. */
export function packageForListing(localId: string): { ok: true; path: string; bytes: number } | { ok: false; error: string } {
  if (!SAFE_ID.test(localId)) return { ok: false, error: 'bad character id' };
  const dir = identityDir(localId);
  const kept = path.join(dir, 'package.unclawchar');
  if (fs.existsSync(kept)) return { ok: true, path: kept, bytes: fs.statSync(kept).size };

  const unpacked = path.join(dir, 'unpacked');
  let root = unpacked;
  if (fs.existsSync(unpacked) && !fs.existsSync(path.join(root, 'manifest.json'))) {
    const sub = fs.readdirSync(unpacked).find((d) => fs.existsSync(path.join(unpacked, d, 'manifest.json')));
    if (sub) root = path.join(unpacked, sub);
  }
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    return { ok: false, error: 'this character was not imported from Unreal, so there is no package to share' };
  }
  // bsdtar writes zip on macOS and on Windows 10+, with the manifest at the root.
  const r = spawnSync('tar', ['--format', 'zip', '-cf', kept, '-C', root, '.'], { stdio: 'pipe' });
  if (r.status !== 0 || !fs.existsSync(kept)) {
    return { ok: false, error: `could not package the character (${(r.stderr?.toString() || 'tar failed').trim().slice(0, 120)})` };
  }
  return { ok: true, path: kept, bytes: fs.statSync(kept).size };
}

/** The clip a cloned voice was made from (soul keeps it under pocket/refs). */
export function voiceClipPath(slug: string): string | null {
  if (!SAFE_ID.test(slug)) return null;
  const p = path.join(getSoulDataDir(), 'pocket', 'refs', `${slug}.wav`);
  return fs.existsSync(p) ? p : null;
}

/** Stream one listing file from disk to the store. */
export async function uploadListingFile(args: {
  storeUrl: string; token: string; listingId: string; name: 'character.unclawchar' | 'voice.wav'; filePath: string;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!allowedStore(args.storeUrl)) return { ok: false, error: 'store address not allowed' };
  if (!SAFE_ID.test(args.listingId)) return { ok: false, error: 'bad listing id' };
  if (!['character.unclawchar', 'voice.wav'].includes(args.name)) return { ok: false, error: 'bad file name' };
  if (!fs.existsSync(args.filePath)) return { ok: false, error: 'file is gone' };
  try {
    const blob = await fs.openAsBlob(args.filePath);
    const res = await fetch(`${args.storeUrl}/market/characters/${args.listingId}/files/${args.name}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/octet-stream' },
      body: blob,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Download a listing's package (and voice clip) into userData/market/<id>/.
 *  The voice comes back as bytes: the renderer clones it through soul. */
export async function downloadListing(args: {
  storeUrl: string; token: string; listingId: string; withVoice: boolean;
}): Promise<{ ok: true; packagePath: string; voice?: Uint8Array } | { ok: false; error: string }> {
  if (!allowedStore(args.storeUrl)) return { ok: false, error: 'store address not allowed' };
  if (!SAFE_ID.test(args.listingId)) return { ok: false, error: 'bad listing id' };
  const dir = path.join(app.getPath('userData'), 'market', args.listingId);
  fs.mkdirSync(dir, { recursive: true });
  const get = async (name: string, dest: string) => {
    const res = await fetch(`${args.storeUrl}/market/characters/${args.listingId}/files/${name}`, {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok || !res.body) throw new Error(`${name}: ${res.status}`);
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  };
  try {
    const packagePath = path.join(dir, 'character.unclawchar');
    await get('character.unclawchar', packagePath);
    let voice: Uint8Array | undefined;
    if (args.withVoice) {
      const voicePath = path.join(dir, 'voice.wav');
      await get('voice.wav', voicePath);
      voice = new Uint8Array(fs.readFileSync(voicePath));
    }
    return { ok: true, packagePath, voice };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
