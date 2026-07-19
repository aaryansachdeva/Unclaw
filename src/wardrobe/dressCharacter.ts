// The dressing chain: applies one instance's saved wardrobe to the character
// currently live in UE. Extracted from App.tsx so the descriptor contract
// lives in one place and the chain is testable without React.
//
// Contract with UE (all descriptors are idempotent set-state calls):
//   initializeClothing   4 int fields (top/bottom/shoes/hair). Used only when
//                        ALL four indices are saved; it has no notion of a
//                        partial set, absent fields would read as 0 and stomp
//                        the character's authored garments.
//   changeWardrobeItem   per-category (wardrobeCategory + wardrobeIndex).
//                        Works outside wardrobe mode (the hair detail view and
//                        the custom-build brow/lash replay both prove it), so
//                        it's the sparse-apply path.
//   setBlends            all four unsigned morphs every time; the BP fires
//                        Apply Blend All so absent fields would zero an axis.
//   changeClothingColor  both tones + category, strings via toFixed (that BP
//                        still parses Get String Field).
//
// NOTE: the key light (changeLightAngle/changeLightColor) and backdrop
// (changeBGColor/changeBGMaterial) are NOT built here — they're GLOBAL, applied
// by App.tsx's applyEnvironment. See src/hooks/useEnvironment.ts.
//
// Sparseness: a field that was never saved is NOT sent. Saved wardrobes are
// dirty-tracked (the overlays persist only what the user touched), so absence
// means "the user never customized this, leave UE's authored default alone".
//
// LATENCY MODEL (why this pipelines instead of awaiting acks):
// The WebRTC data channel is ordered + reliable, so UE receives and applies
// descriptors in send order no matter what we await. The old chain blocked on
// a per-descriptor ack (1.5s timeout, then a retry) before sending the next;
// any EventType the Blueprint doesn't echo burned 3s of dead air, and a
// custom build's outfit group has enough descriptors to stack double-digit
// seconds of visible "clothes popping in". Acks only ever told us one thing:
// whether UE is processing descriptors AT ALL (the connect-race window). One
// probe answers that for the whole run.
//
// So: fire every payload back-to-back, arm ONE ack waiter on the first
// payload's EventType before firing, and if that probe stays silent while the
// run is still alive, re-fire the entire list once (everything is idempotent
// set-state, so a double apply is harmless). Total added latency when UE is
// healthy: zero.
//
// SCOPE (why scene and outfit split):
// The key light (keyLight3) and backdrop (SM_HalfSphereBackground) live in
// the persistent level. They exist BEFORE, DURING, and AFTER a character
// swap, so they never needed to wait for characterReady. The caller fires a
// 'scene' run the moment the swap starts (the light + backdrop snap while UE
// is still destroying/loading classes) and an 'outfit' run when the new
// character spawns. 'full' remains for the paths where the character is
// already live (same-class fast path, connect reconcile on-target).
//
// Cancellation: `isAlive` is checked before every send. The caller bumps its
// epoch on character switch / reset / disconnect, so a superseded chain stops
// dressing a character it no longer owns instead of racing the next chain.

import type { WardrobeSettings } from '../services/userSettings';
import { CLOTHING_COLORS } from '../components/CustomizationOverlay';
import { hexToRgb01, round3 } from '../components/ColorPickerPanel';
import { isCustomCharacter } from './catalog';

export type DescriptorPayload = Record<string, unknown> & { EventType: string };

export type DressScope = 'full' | 'scene' | 'outfit';

export interface DressCharacterOptions {
  wardrobe: WardrobeSettings;
  /** Agent TYPE id of the character being dressed (gates the custom-build
   *  extras: brows, lashes, strands, body blends). */
  agentId?: string | null;
  /** 'scene' = key light + backdrop (persistent-level actors, safe to apply
   *  mid-swap). 'outfit' = everything on the character itself. */
  scope?: DressScope;
  /** Fire one descriptor over the data channel. Fire-and-forget. */
  emit: (payload: DescriptorPayload) => void;
  /** Arm a waiter for UE's ack of `eventType`. Resolves false on silence. */
  waitForAck: (eventType: string, timeoutMs?: number) => Promise<boolean>;
  /** False once this run is superseded; checked before every send. */
  isAlive: () => boolean;
}

/** Build the ordered descriptor list for a wardrobe + scope. Exported for
 *  tests; the order IS the contract (garments before their colors). */
export function buildDressPayloads(
  w: WardrobeSettings, agentId: string | null | undefined, scope: DressScope,
): DescriptorPayload[] {
  const out: DescriptorPayload[] = [];

  // The ENVIRONMENT (key light + backdrop) is GLOBAL now — applied by App.tsx's
  // applyEnvironment on every switch (changeLightAngle/changeLightColor +
  // changeBGColor/changeBGMaterial), NOT per-instance here. See
  // src/hooks/useEnvironment.ts. So the 'scene' scope emits nothing; every
  // per-character payload below is OUTFIT (needs a body to hang on).
  if (scope !== 'scene') {
    const idx = {
      top: w.topIndex, bottom: w.bottomIndex,
      shoes: w.shoesIndex, hair: w.hairIndex,
    } as const;
    const cats = (Object.keys(idx) as Array<keyof typeof idx>)
      .filter((c) => idx[c] != null);
    if (cats.length === 4) {
      out.push({
        EventType: 'initializeClothing',
        top: idx.top!, bottom: idx.bottom!, shoes: idx.shoes!, hair: idx.hair!,
      });
    } else {
      for (const c of cats) {
        out.push({
          EventType: 'changeWardrobeItem',
          wardrobeCategory: c,
          wardrobeIndex: idx[c]!,
        });
      }
    }
    // Custom-pipeline builds only; the original six have no such categories.
    if (isCustomCharacter(agentId)) {
      for (const [cat, i] of [
        ['eyebrow', w.browIndex],
        ['eyelash', w.lashIndex],
      ] as const) {
        if (i == null) continue;
        out.push({
          EventType: 'changeWardrobeItem',
          wardrobeCategory: cat,
          wardrobeIndex: i,
        });
      }
      // Both axes home = the authored shape; re-asserting zeroes buys nothing.
      const h = w.heightBlend ?? 0;
      const wt = w.weightBlend ?? 0;
      if (h !== 0 || wt !== 0) {
        out.push({
          EventType: 'setBlends',
          tall:  round3(Math.max(0, h)),
          short: round3(Math.max(0, -h)),
          fat:   round3(Math.max(0, wt)),
          slim:  round3(Math.max(0, -wt)),
        });
      }
    }
    // Colors AFTER the garments they tint. Ordered channel makes the
    // back-to-back send safe: UE still applies them in this order.
    if (w.clothingColors) {
      for (const cat of ['top', 'bottom', 'shoes'] as const) {
        const pair = w.clothingColors[cat];
        if (!pair) continue;
        const c1 = pair.c1Hex ? hexToRgb01(pair.c1Hex) : (CLOTHING_COLORS[pair.c1] ?? CLOTHING_COLORS[0]);
        const c2 = pair.c2Hex ? hexToRgb01(pair.c2Hex) : (CLOTHING_COLORS[pair.c2] ?? CLOTHING_COLORS[0]);
        out.push({
          EventType: 'changeClothingColor',
          wardrobeCategory: cat,
          'color1.r': c1.r.toFixed(3),
          'color1.g': c1.g.toFixed(3),
          'color1.b': c1.b.toFixed(3),
          'color2.r': c2.r.toFixed(3),
          'color2.g': c2.g.toFixed(3),
          'color2.b': c2.b.toFixed(3),
        });
      }
    }
  }

  return out;
}

export async function dressCharacter(
  { wardrobe, agentId, scope = 'full', emit, waitForAck, isAlive }: DressCharacterOptions,
): Promise<'done' | 'aborted'> {
  const t0 = performance.now();
  const payloads = buildDressPayloads(wardrobe, agentId, scope);
  if (payloads.length === 0) return 'done';

  const fireAll = (): boolean => {
    for (const p of payloads) {
      if (!isAlive()) return false;
      emit(p);
    }
    return true;
  };

  // Arm the probe BEFORE the first send so a same-tick ack can't slip past.
  const probe = waitForAck(payloads[0].EventType, 1500);
  if (!fireAll()) return 'aborted';

  const acked = await probe;
  if (!acked && isAlive()) {
    // UE stayed silent: either it wasn't processing descriptors yet (the
    // connect race) or this EventType simply has no ack in the BP. One blind
    // re-fire covers the first case; the second costs a harmless double
    // apply. No further waiting either way.
    console.warn(`[wardrobe] no ack for ${payloads[0].EventType}; re-firing ${scope} chain once`);
    fireAll();
  }

  const aborted = !isAlive();
  console.log(
    `[wardrobe] dress(${scope}) ${aborted ? 'ABORTED (superseded)' : 'complete'}: ` +
    `${payloads.length} descriptor(s) in ${Math.round(performance.now() - t0)}ms`,
  );
  return aborted ? 'aborted' : 'done';
}
