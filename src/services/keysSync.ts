// Cloud sync for the BYOK API keys vault. Talks to the same Hono
// Worker that handles auth + profile, on /sync/keys.
//
// The Worker stores opaque ciphertext + KDF params; ALL encryption
// happens here in the renderer. Server sees nothing usable.
//
// Flow:
//   First device:
//     user finishes onboarding -> picks a sync passphrase ->
//     encryptJson(apiKeys, passphrase) -> PUT /sync/keys
//
//   Second device:
//     user logs in -> JWT stored -> fetchVaultBlob() ->
//     prompt for passphrase -> decryptJson -> save locally via safeStorage
//
// Caller wires this; this module is pure transport + crypto glue.

import { decryptJson, encryptJson, type VaultBlob } from './keysCrypto'
import { loadStoredToken } from './auth'
import {
  type ApiKeysProfile,
  DEFAULT_API_KEYS,
  saveApiKeys,
} from './apiKeys'

const API_URL = 'https://unclaw-api.aryansachdeva1999.workers.dev'

interface CloudVaultResponse {
  vault: (VaultBlob & {
    version: number
    created_at: string
    updated_at: string
  }) | null
}


// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function authHeaders(): Promise<HeadersInit | null> {
  const token = await loadStoredToken()
  if (!token) return null
  return { Authorization: `Bearer ${token}` }
}


// ---------------------------------------------------------------------------
// Cloud surface
// ---------------------------------------------------------------------------

/** Returns the current user's vault blob if one exists, null if the
 *  user hasn't synced yet, or 'unauth' if the JWT is missing/expired. */
export async function fetchVaultBlob(): Promise<
  | { state: 'present'; blob: VaultBlob }
  | { state: 'absent' }
  | { state: 'unauth' }
  | { state: 'error'; reason: string }
> {
  const headers = await authHeaders()
  if (!headers) return { state: 'unauth' }
  try {
    const res = await fetch(`${API_URL}/sync/keys`, { headers })
    if (res.status === 401) return { state: 'unauth' }
    if (!res.ok) {
      return { state: 'error', reason: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as CloudVaultResponse
    if (!data.vault) return { state: 'absent' }
    const { ciphertext, salt, nonce, kdf_params } = data.vault
    return { state: 'present', blob: { ciphertext, salt, nonce, kdf_params } }
  } catch (err) {
    return { state: 'error', reason: String(err) }
  }
}


/** Encrypt the keys profile under `passphrase` and PUT to /sync/keys.
 *  Returns true on success. The profile that's encrypted is what the
 *  caller passes — caller is responsible for fetching the latest local
 *  state first if it wants a "save and sync" semantic. */
export async function pushVaultBlob(
  keys: ApiKeysProfile,
  passphrase: string,
): Promise<boolean> {
  const headers = await authHeaders()
  if (!headers) return false
  // Encrypt the keys WITHOUT sync-state metadata — that lives outside
  // the encrypted blob so we can know "vault exists" without unlocking.
  const blob = await encryptJson(stripSyncState(keys), passphrase)
  try {
    const res = await fetch(`${API_URL}/sync/keys`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(blob),
    })
    return res.ok
  } catch {
    return false
  }
}


/** Decrypt a downloaded vault under `passphrase` and return the plaintext
 *  keys. Throws on wrong-passphrase or corrupt blob. */
export async function decryptVault(
  blob: VaultBlob, passphrase: string,
): Promise<ApiKeysProfile> {
  const decoded = await decryptJson<Partial<ApiKeysProfile>>(blob, passphrase)
  // Merge over defaults so any new schema fields added since the blob
  // was written get sane initial values.
  return { ...DEFAULT_API_KEYS, ...decoded }
}


/** Convenience: pull cloud blob, decrypt with passphrase, persist locally
 *  via safeStorage. Used during sign-in on a second device. */
export async function unlockAndStore(
  blob: VaultBlob, passphrase: string,
): Promise<ApiKeysProfile> {
  const keys = await decryptVault(blob, passphrase)
  await saveApiKeys(keys)
  return keys
}


/** Clear the cloud blob (e.g. on full sign-out + "forget on this account").
 *  Local copy is untouched — call clearApiKeys() separately if needed. */
export async function deleteVaultBlob(): Promise<boolean> {
  const headers = await authHeaders()
  if (!headers) return false
  try {
    const res = await fetch(`${API_URL}/sync/keys`, {
      method: 'DELETE',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}


// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Strip fields that shouldn't be part of the encrypted payload — sync
 *  toggles + cosmetic flags belong outside the ciphertext so the UI can
 *  reflect them without unlocking the vault. */
function stripSyncState(keys: ApiKeysProfile): ApiKeysProfile {
  // Currently every field is sync-relevant; this is a hook for future
  // additions like `last_synced_at` that should stay client-side.
  return { ...keys }
}
