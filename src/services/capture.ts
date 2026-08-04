// Photo-capture session client — the desktop half of the custom-character
// rendezvous. Desktop creates a session on the store Worker and renders the
// session token as a QR; the phone (Unclaw Scan) redeems that token, takes one
// front depth photo, uploads the bundle to R2 through the Worker, and marks the
// session uploaded. Desktop polls the status and then downloads the preview +
// person matte for the reveal.
//
// Auth mirrors store.ts: the account JWT goes up as a Bearer header. The phone
// never sees the JWT — its uploads authenticate with the one-shot session
// token embedded in the QR payload.

const STORE_URL = 'https://store.unclaw.io';

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export interface CaptureSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}

export type CaptureSessionStatus =
  | 'pending'
  | 'uploaded'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface CaptureStatus {
  sessionId: string;
  status: CaptureSessionStatus;
  files: string[];
  expiresAt: string;
}

export async function createCaptureSession(token: string): Promise<CaptureSession> {
  const res = await fetch(`${STORE_URL}/capture/session`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`capture /session ${res.status}`);
  return (await res.json()) as CaptureSession;
}

export async function fetchCaptureStatus(token: string, sessionId: string): Promise<CaptureStatus> {
  const res = await fetch(`${STORE_URL}/capture/session/${sessionId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`capture /status ${res.status}`);
  return (await res.json()) as CaptureStatus;
}

export async function cancelCaptureSession(token: string, sessionId: string): Promise<void> {
  await fetch(`${STORE_URL}/capture/session/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  }).catch(() => { /* best-effort */ });
}

/** Download one uploaded capture object (preview.jpg / matte.png / capture.zip)
 *  as a Blob. The Worker streams it out of the private bucket. */
export async function fetchCaptureFile(
  token: string,
  sessionId: string,
  name: 'preview.jpg' | 'matte.png' | 'capture.zip',
): Promise<Blob> {
  const res = await fetch(`${STORE_URL}/capture/session/${sessionId}/file/${name}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`capture /file/${name} ${res.status}`);
  return await res.blob();
}

/** The string the QR encodes. Compact JSON the phone parses: kind + version so
 *  the scanner can reject foreign QRs, endpoint so staging/prod can differ. */
export function captureQrPayload(session: CaptureSession): string {
  return JSON.stringify({
    k: 'unclaw.capture',
    v: 1,
    e: STORE_URL,
    s: session.sessionId,
    t: session.token,
  });
}
