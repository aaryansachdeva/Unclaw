// Account reset — wipe everything tied to this user across all storage
// surfaces. Used by the "Reset all data" entry in the profile popover,
// primarily to test the onboarding flow end-to-end without manually
// clearing each layer (safeStorage, soul, cloud, localStorage).
//
// What this touches:
//   * Local — Electron safeStorage: API keys + auth token
//   * Local — soul backend: /settings (DELETE)
//   * Local — localStorage: chat memory keys, pane width, guest-mode flag
//   * Cloud — Unclaw Worker: /settings (DELETE)
//   * Cloud — Unclaw Worker: /auth/logout (revoke session)
//
// API keys live LOCAL ONLY (Electron safeStorage at <userData>/apiKeys.bin).
// There is no cloud key vault — the previous /sync/keys path was removed
// before launch.
//
// Each step is best-effort: a network failure on the cloud side still
// leaves the local side cleared, so the next launch is guaranteed to
// behave as a fresh install.

import { clearApiKeys } from './apiKeys';
import { signOut } from './auth';
import { deleteSettings, deleteCloudSettings } from './userSettings';
import { uninstallKokoro } from './kokoro';
import { uninstallQwen3 } from './qwen3';

/** localStorage keys owned by the renderer. Listed explicitly so the
 *  reset is conservative — we don't accidentally nuke something the
 *  Electron host or other tooling might have parked under window.
 *  `unclaw.chat.*` is wildcard-matched at runtime since chat memory
 *  is keyed per-persona. */
const APP_LOCALSTORAGE_PREFIXES = ['unclaw.chat.'];
const APP_LOCALSTORAGE_KEYS = [
  'unclaw.chatPaneWidth',
  'unclaw.guestMode',
];

function clearAppLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Snapshot keys first — we're about to mutate the store mid-iteration.
    const all: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) all.push(k);
    }
    for (const k of all) {
      if (APP_LOCALSTORAGE_KEYS.includes(k)) {
        localStorage.removeItem(k);
        continue;
      }
      if (APP_LOCALSTORAGE_PREFIXES.some((p) => k.startsWith(p))) {
        localStorage.removeItem(k);
      }
    }
  } catch (err) {
    console.warn('[accountReset] localStorage clear failed', err);
  }
}

export interface AccountResetReport {
  /** Whether each step succeeded. Cloud-side steps return false on any
   *  network/HTTP error so the caller can surface a soft warning ("we
   *  cleared this device, but couldn't reach the cloud — try again on a
   *  better connection"). Local-side failures are typically catastrophic
   *  enough that they'd never reach this dict, but we capture them too. */
  apiKeys: boolean;
  soulProfile: boolean;
  cloudProfile: boolean | 'skipped';
  signOut: boolean | 'skipped';
}

/** Drop everything the user has accumulated. Caller passes the current
 *  auth token (null when in guest mode); cloud-side calls are skipped
 *  in that case. After this resolves, the caller should reset its
 *  in-memory React state to first-run (clear authToken, profile,
 *  trigger the SignInScreen / wizard again). */
export async function resetEverything(
  token: string | null,
): Promise<AccountResetReport> {
  const report: AccountResetReport = {
    apiKeys: false,
    soulProfile: false,
    cloudProfile: 'skipped',
    signOut: 'skipped',
  };

  // 1. Local — wipe API keys (safeStorage <userData>/apiKeys.bin).
  try {
    report.apiKeys = await clearApiKeys();
  } catch (err) {
    console.warn('[accountReset] clearApiKeys threw', err);
  }

  // 2. Local — wipe the soul-side settings so a /settings GET on next
  //    launch returns null and triggers the wizard's first-run mode.
  try {
    await deleteSettings();
    report.soulProfile = true;
  } catch (err) {
    console.warn('[accountReset] deleteSettings threw', err);
  }

  // 2b. Local — wipe TTS provider installs (kokoro model + voices,
  //     qwen3 venv + model + voices). Best-effort; the user can
  //     re-install via the wizard after the reset. Failures here
  //     don't gate the rest of the reset path.
  try { await uninstallKokoro(); } catch (err) {
    console.warn('[accountReset] uninstallKokoro threw', err);
  }
  try { await uninstallQwen3(); } catch (err) {
    console.warn('[accountReset] uninstallQwen3 threw', err);
  }

  // 3. Cloud (auth-required) — wipe the user's profile settings.
  //    Failures are silent. If the user is in guest mode (`token == null`)
  //    this is skipped entirely. There is no cloud API-key vault to clean
  //    up; keys live local-only via safeStorage and step 1 already wiped
  //    them.
  if (token) {
    report.cloudProfile = await deleteCloudSettings(token).catch(() => false);
  }

  // 4. Cloud — revoke the session, then wipe the local token.
  if (token) {
    try {
      await signOut(token);
      report.signOut = true;
    } catch (err) {
      console.warn('[accountReset] signOut threw', err);
      report.signOut = false;
    }
  } else {
    // Even in guest mode, clear any stray token left from a previous
    // signed-in session.
    try {
      await signOut(null);
    } catch {
      /* ignore */
    }
  }

  // 5. Local — chat memory + UI prefs + guest-mode flag.
  clearAppLocalStorage();

  return report;
}
