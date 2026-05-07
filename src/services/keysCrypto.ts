// E2E client-side crypto for the BYOK API keys vault.
//
// Threat model: encrypt the user's plaintext keys (Groq / OpenAI / Eleven /
// Gemini-search) under a passphrase the user controls, in a way that even
// a fully-compromised server CAN'T decrypt. This protects against:
//   * Server breach (only opaque ciphertext leaks)
//   * Network eavesdropping (TLS already, but defense in depth)
//   * Stolen JWT alone (attacker still needs the passphrase)
//
// What this does NOT protect against:
//   * Compromised client device (keys live in memory while the app runs)
//   * Lost passphrase (no recovery — same trade as Bitwarden / 1Password)
//
// Choices and rationale:
//   * PBKDF2-HMAC-SHA256, 600 000 iterations
//       Web Crypto native, no extra deps. 600k is OWASP 2025's
//       recommendation for PBKDF2-SHA256 (NIST minimum is 300k).
//       Argon2id would be nicer but isn't in Web Crypto and would add
//       ~200 KB of WASM; we can swap algorithms via `kdf_params` later
//       without breaking older blobs (the server stores the params).
//   * AES-256-GCM with 12-byte random nonce, 16-byte random salt
//       AEAD: ciphertext + 16-byte auth tag. Tampering = decrypt fails.
//       Salt is per-blob (not per-user) so re-encrypting with the same
//       passphrase doesn't replay.
//   * Output is base64 to round-trip cleanly through JSON.

const ALGO = 'PBKDF2-HMAC-SHA256' as const
const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const NONCE_BYTES = 12  // standard for AES-GCM


export interface VaultBlob {
  /** Base64 ciphertext including the 16-byte AES-GCM auth tag. */
  ciphertext: string
  /** Base64 PBKDF2 salt. */
  salt: string
  /** Base64 AES-GCM nonce. */
  nonce: string
  /** KDF parameters baked in so we can rotate later without breaking
   *  older blobs. */
  kdf_params: { algo: typeof ALGO; iterations: number }
}


// ---------------------------------------------------------------------------
// Encoding helpers — Web Crypto wants Uint8Array, JSON wants base64.
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid String.fromCharCode(...arr) for big arrays (stack overflow on 64k+).
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}


// ---------------------------------------------------------------------------
// Key derivation — passphrase + salt -> AES-256-GCM key
// ---------------------------------------------------------------------------

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('passphrase required')
  }
  // Step 1: import the passphrase as a raw PBKDF2 base key.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    /* extractable */ false,
    ['deriveKey'],
  )
  // Step 2: stretch through PBKDF2 into a 256-bit AES-GCM key.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  )
}


// ---------------------------------------------------------------------------
// Public API: encrypt / decrypt arbitrary JSON-serializable values.
// ---------------------------------------------------------------------------

/**
 * Encrypt `payload` under `passphrase`. Generates fresh salt + nonce on
 * every call so re-encrypting the same value produces a different blob
 * (no replay leak). Returns the full vault blob ready to upload.
 */
export async function encryptJson<T>(payload: T, passphrase: string): Promise<VaultBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const key = await deriveAesKey(passphrase, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  )
  return {
    ciphertext: bytesToBase64(ciphertext),
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    kdf_params: { algo: ALGO, iterations: PBKDF2_ITERATIONS },
  }
}


/**
 * Reverse of `encryptJson`. Throws if the passphrase is wrong (AES-GCM's
 * auth tag will fail to verify, surfacing as an OperationError) or the
 * blob is corrupt. Caller should treat any thrown error as "wrong
 * passphrase" to avoid leaking which case it actually was.
 */
export async function decryptJson<T>(blob: VaultBlob, passphrase: string): Promise<T> {
  // Tolerate older blobs whose `kdf_params.iterations` was stored as a
  // plain number; current shape is the same. Future rotation could
  // dispatch on `kdf_params.algo` here.
  const iterations = blob.kdf_params?.iterations ?? PBKDF2_ITERATIONS
  if (iterations < 100_000) {
    // Refuse to decrypt blobs that claim suspiciously weak parameters.
    // Server should never store one of these (allowlist enforced) but
    // belt-and-suspenders.
    throw new Error('vault parameters too weak — refuse to decrypt')
  }
  const salt = base64ToBytes(blob.salt)
  const nonce = base64ToBytes(blob.nonce)
  const ciphertext = base64ToBytes(blob.ciphertext)
  const key = await deriveAesKeyForDecrypt(passphrase, salt, iterations)
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  )
  const json = new TextDecoder().decode(plaintext)
  return JSON.parse(json) as T
}


/** Identical to deriveAesKey but parameterized on iterations for the
 *  decrypt path's "honor whatever the blob says" semantics. */
async function deriveAesKeyForDecrypt(
  passphrase: string, salt: Uint8Array, iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
