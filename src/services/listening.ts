/**
 * Listening reactions (backchannel). While the USER is speaking, we post
 * lightweight events to soul's /listening endpoint; soul synthesizes a
 * short captured-expression reaction (attention brow flick, slow
 * backchannel nods, an acknowledgment nod) and pushes it to UE over the
 * existing /ws job channel. Fire-and-forget: soul gates everything
 * server-side (captured mode only, cooldowns, never while the avatar
 * itself is speaking), so this client can stay dumb and silent.
 */
import { getSoulBaseUrl } from './soulBase';

export type ListeningEvent = 'start' | 'sustained' | 'end';

export function sendListeningEvent(event: ListeningEvent): void {
  void fetch(`${getSoulBaseUrl()}/listening`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {
    /* soul down or busy — reactions are pure garnish, never surface errors */
  });
}
