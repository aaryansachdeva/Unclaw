// Claws — the in-app currency. Server-authoritative (store Worker + D1), so the
// balance follows the account and can't be faked client-side. New accounts are
// seeded with STARTING_CLAWS on first touch; characters cost CHARACTER_CLAW_COST
// to unlock with claws (the all-access bundle stays on Polar). Earned by
// interacting — 1 claw per message. All calls attach the UnClaw account JWT.

const STORE_URL = 'https://store.unclaw.io';

/** Display constants — must match the worker's authoritative values. */
export const STARTING_CLAWS = 250;
export const CHARACTER_CLAW_COST = 200;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Current balance (seeds the starting balance on first call). null on failure. */
export async function fetchClaws(token: string): Promise<number | null> {
  try {
    const res = await fetch(`${STORE_URL}/claws`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: number };
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (err) {
    console.warn('[claws] fetch failed', err);
    return null;
  }
}

/** Award `amount` claws (default 1, e.g. per message). Returns the new balance,
 *  or null on failure. Best-effort — earning must never block the chat. */
export async function earnClaws(token: string, amount = 1): Promise<number | null> {
  try {
    const res = await fetch(`${STORE_URL}/claws/earn`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: number };
    return typeof data.balance === 'number' ? data.balance : null;
  } catch {
    return null;
  }
}

export interface SpendResult {
  ok: boolean;
  /** New balance after the transaction (or the unchanged balance on failure). */
  balance: number | null;
  /** Why it failed: 'insufficient' | 'already_owned' | 'unknown_character' | 'error'. */
  reason?: string;
}

/** Spend CHARACTER_CLAW_COST to unlock a character. On success the worker grants
 *  the entitlement, so the normal owned→download→install flow takes over. */
export async function spendOnCharacter(token: string, characterId: string): Promise<SpendResult> {
  try {
    const res = await fetch(`${STORE_URL}/claws/spend-character`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; balance?: number; reason?: string };
    return {
      ok: !!data.ok,
      balance: typeof data.balance === 'number' ? data.balance : null,
      reason: data.reason,
    };
  } catch (err) {
    console.warn('[claws] spend failed', err);
    return { ok: false, balance: null, reason: 'error' };
  }
}
