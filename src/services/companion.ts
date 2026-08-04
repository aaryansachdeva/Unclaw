// Companion (phone) connection service.
//
// The desktop bridges into the iOS companion through the cloud Worker:
//
//   iPhone <--WSS--> Worker (api.unclaw.io) <--WSS--> soul <--WSS--> UE
//   then, after SDP/ICE:  iPhone <===== WebRTC media (direct) =====> UE
//
// Only signalling touches the Worker; the avatar video/audio flow direct
// phone<->UE. Soul owns the streamer side (soul/cloud_signalling.py); this
// module owns the renderer side: it ensures the desktop is PAIRED (a
// long-lived credential in soul's auth.bin, which arms the cloud client) and
// produces the QR the phone scans to join this desktop's live session.
//
// Pairing handshake (mirrors soul/soul/server.py /pair/*):
//   1. renderer mints a desktop refresh credential from the Worker
//      (POST /auth/desktop/credential/issue, Bearer = the signed-in JWT)
//   2. renderer hands it to soul (POST /pair/install) -> soul writes auth.bin
//      and opens its streamer WSS to the Worker
//   3. GET soul /pair/connect_link -> the universal link the phone opens

import { getSoulBaseUrl } from './soulBase';

const API_URL = 'https://api.unclaw.io';

export interface PairStatus {
  paired: boolean;
  /** STOPPED | STARTING | RUNNING | REFRESHING | RECONNECTING | AUTH_INVALID */
  state: string;
  user_id: string | null;
  device_id: string | null;
  credential_expires_at: number | null;
  jwt_expires_at: number | null;
  last_connect_at: number | null;
  last_error: string | null;
  /** playerIds currently bridged — non-empty means a phone is connected. */
  active_players: string[];
  api_base_url: string;
}

export interface ConnectLink {
  ok: boolean;
  paired: boolean;
  state: string;
  /** The QR payload — https://api.unclaw.io/connect?u=..&d=.. — or null. */
  connect_url: string | null;
  active_players?: string[];
}

/** The Worker's /auth/desktop/credential/issue response (minted once). */
interface IssuedCredential {
  credential: string;   // "dr_<32>"
  device_id: string;    // "desktop:<uuid>"
  expires_at: number;   // unix ms (90-day TTL)
}

async function soulGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getSoulBaseUrl()}${path}`);
  if (!res.ok) throw new Error(`soul ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function soulPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getSoulBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`soul ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Cheap poll of the local cloud-client state. No network beyond loopback. */
export function fetchPairStatus(): Promise<PairStatus> {
  return soulGet<PairStatus>('/pair/status');
}

export function fetchConnectLink(): Promise<ConnectLink> {
  return soulGet<ConnectLink>('/pair/connect_link');
}

/** Mint a fresh desktop credential from the Worker (Bearer = signed-in JWT). */
async function issueDesktopCredential(token: string): Promise<IssuedCredential> {
  const res = await fetch(`${API_URL}/auth/desktop/credential/issue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`credential/issue: HTTP ${res.status}`);
  return res.json() as Promise<IssuedCredential>;
}

/** Hand a minted credential to soul so it arms the cloud client. */
async function installPairing(cred: IssuedCredential, userId: string): Promise<PairStatus> {
  const out = await soulPost<{ ok: boolean; status: PairStatus }>('/pair/install', {
    credential: cred.credential,
    device_id: cred.device_id,
    user_id: userId,
    expires_at: cred.expires_at,
    issued_at: Date.now(),
  });
  return out.status;
}

/**
 * Ensure the desktop is paired, then return the QR connect link.
 *
 * If already paired (auth.bin present, cloud client armed) this is one cheap
 * loopback round-trip. Otherwise it mints a credential from the Worker and
 * installs it first. `token`/`userId` are the signed-in session — required to
 * pair; when absent and unpaired, throws so the UI can prompt sign-in.
 */
export async function ensureConnectLink(
  token: string | null,
  userId: string | null,
): Promise<ConnectLink> {
  let status = await fetchPairStatus();
  if (!status.paired) {
    if (!token || !userId) {
      throw new Error('sign-in required to pair a phone');
    }
    const cred = await issueDesktopCredential(token);
    status = await installPairing(cred, userId);
  }
  return fetchConnectLink();
}

/** Unpair: revoke the server credential + wipe soul's auth.bin. */
export async function unpairPhone(token: string | null): Promise<void> {
  try {
    if (token) {
      await fetch(`${API_URL}/auth/desktop/credential/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch { /* best-effort server revoke; local wipe still runs */ }
  await soulPost('/pair/uninstall');
}
