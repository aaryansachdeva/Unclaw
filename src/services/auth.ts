// Renderer-side auth service. Talks to the unclaw-api Worker for
// account state and to the Electron main process (via window.electronAPI)
// for the loopback OAuth flow and encrypted token storage.
//
// Three sign-in paths:
//   * Google OAuth   — open browser -> wait for unclaw://auth/callback
//                      -> exchange code via /auth/google
//   * Discord OAuth  — same, /auth/discord
//   * Email/password — register -> verify code -> session token
//
// All three converge on a JWT stored via safeStorage. App boot reads
// the token (auth:get-token) and either resumes the session or shows
// the SignInScreen.

const API_URL = 'https://api.unclaw.io';
// Loopback HTTP redirect — Google's Desktop OAuth client and Discord
// both accept this pattern. Port + path must match what the Electron
// main process binds in `auth:start-oauth-loopback` and what's
// registered in Discord's OAuth2 Redirects list.
const REDIRECT_URI = 'http://localhost:47821/oauth/callback';
const STATE_PREFIX_LEN = 16;

// OAuth client IDs are public-by-design (the secret stays on the
// Worker). Hard-coding here is the simplest reliable path; if you
// ever rotate them, update this file + the Worker secrets together.
const GOOGLE_CLIENT_ID =
  '68525410132-u16heb99ivjqv2s32ddtolmnfgl7acf1.apps.googleusercontent.com';
const DISCORD_CLIENT_ID = '1500222195446583397';

export type AuthProvider = 'google' | 'discord' | 'email';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

/** Worker `/auth/*` payload shapes. */
interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}
interface NeedsVerificationResponse {
  needsVerification: true;
  email: string;
}
interface ErrorResponse {
  error: string;
}

function isError(v: unknown): v is ErrorResponse {
  return typeof v === 'object' && v !== null && 'error' in v;
}
function isNeedsVerification(v: unknown): v is NeedsVerificationResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    'needsVerification' in v &&
    (v as { needsVerification?: unknown }).needsVerification === true
  );
}

class AuthError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'AuthError';
  }
}

function randomState(): string {
  const bytes = new Uint8Array(STATE_PREFIX_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function jsonPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // empty / non-json body — leave payload as null
  }
  if (!res.ok) {
    const msg = isError(payload) ? payload.error : `HTTP ${res.status}`;
    throw new AuthError(msg, res.status);
  }
  return payload as T;
}

// --- Token persistence (via Electron safeStorage) ----------------------

export async function loadStoredToken(): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.authGetToken) return null;
  return api.authGetToken();
}

async function persistToken(token: string): Promise<void> {
  const api = window.electronAPI;
  if (!api?.authSetToken) return;
  await api.authSetToken(token);
}

async function clearStoredToken(): Promise<void> {
  const api = window.electronAPI;
  if (!api?.authClearToken) return;
  await api.authClearToken();
}

// --- /me — resume an existing session ---------------------------------

/** Probe the Worker for the current user. Returns null if the token
 *  is invalid/expired (and clears it). Used on app start. */
export async function fetchCurrentUser(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await clearStoredToken();
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json() as { user: AuthUser };
    return data.user;
  } catch {
    return null;
  }
}

// --- OAuth flows -------------------------------------------------------

/** Run a complete OAuth round-trip:
 *    1. start the loopback server
 *    2. open the provider's auth URL in the system browser
 *    3. wait for the loopback to fire (resolves with code/state)
 *    4. validate state, exchange the code at the Worker, return session
 *  Used by both Google and Discord — the only thing that varies is
 *  the auth URL builder.
 */
async function runOAuthFlow(
  buildAuthUrl: (state: string) => string,
  workerPath: '/auth/google' | '/auth/discord',
): Promise<AuthSession> {
  const api = window.electronAPI;
  if (!api?.authOpenExternal || !api?.authStartOAuthLoopback) {
    throw new AuthError('Auth bridge not available (Electron only)');
  }

  const state = randomState();

  // Start the loopback BEFORE opening the browser so we can never
  // race the provider redirecting back. The promise resolves when
  // the provider hits us OR the 3-minute timeout fires.
  const callbackPromise = api.authStartOAuthLoopback();

  await api.authOpenExternal(buildAuthUrl(state));

  const payload = await callbackPromise;
  if (payload.error) {
    throw new AuthError(`Sign-in failed: ${payload.error}`);
  }
  if (!payload.code) {
    throw new AuthError('Sign-in failed: no authorization code returned');
  }
  if (payload.state !== state) {
    throw new AuthError('Sign-in state mismatch. Please try again');
  }

  const session = await jsonPost<AuthSuccessResponse>(workerPath, {
    code: payload.code,
    redirect_uri: REDIRECT_URI,
  });
  await persistToken(session.token);
  return session;
}

export async function signInWithGoogle(): Promise<AuthSession> {
  return runOAuthFlow(
    (state) =>
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&state=${encodeURIComponent(state)}` +
      `&prompt=select_account`,
    '/auth/google',
  );
}

export async function signInWithDiscord(): Promise<AuthSession> {
  return runOAuthFlow(
    (state) =>
      'https://discord.com/api/oauth2/authorize' +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('identify email')}` +
      `&state=${encodeURIComponent(state)}` +
      `&prompt=consent`,
    '/auth/discord',
  );
}

// --- Email + password -------------------------------------------------

/** Returns either a full session (if email already verified) or a
 *  flag indicating the verification step is required. */
export type EmailRegisterResult =
  | { kind: 'session'; session: AuthSession }
  | { kind: 'needs-verification'; email: string };

export async function registerWithEmail(
  email: string,
  password: string,
  name: string,
): Promise<EmailRegisterResult> {
  const res = await jsonPost<AuthSuccessResponse | NeedsVerificationResponse>(
    '/auth/register',
    { email, password, name },
  );
  if (isNeedsVerification(res)) return { kind: 'needs-verification', email: res.email };
  await persistToken(res.token);
  return { kind: 'session', session: res };
}

export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<AuthSession> {
  const session = await jsonPost<AuthSuccessResponse>('/auth/verify-email', {
    email,
    code,
  });
  await persistToken(session.token);
  return session;
}

export async function resendVerificationCode(email: string): Promise<void> {
  await jsonPost<{ success: true }>('/auth/resend-code', { email });
}

export type EmailLoginResult =
  | { kind: 'session'; session: AuthSession }
  | { kind: 'needs-verification'; email: string };

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<EmailLoginResult> {
  const res = await jsonPost<AuthSuccessResponse | NeedsVerificationResponse>(
    '/auth/login',
    { email, password },
  );
  if (isNeedsVerification(res)) return { kind: 'needs-verification', email: res.email };
  await persistToken(res.token);
  return { kind: 'session', session: res };
}

// --- Sign out ----------------------------------------------------------

export async function signOut(token: string | null): Promise<void> {
  if (token) {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Server-side revoke is best-effort; clearing the local token is
      // what actually signs the user out from this device.
    }
  }
  await clearStoredToken();
}

export { API_URL, AuthError };
