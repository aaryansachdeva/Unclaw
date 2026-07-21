import { useCallback, useState } from 'react';
import type { WardrobeSettings } from '../services/userSettings';

// The user's personal roster of character INSTANCES, in switch order. Everyone
// starts with one Grace instance (the baked base character). Instances can be
// added freely — including multiple of the same character — and each can be
// renamed. UE only ever receives `agentSwitch{agentId}` for the instance's
// underlying character; the instance id + name are a frontend concept (which
// stop in the carousel, what it's called). Persisted in localStorage.

const KEY = 'unclaw.agentStack.v2';
/** The permanent base instance (always present, always first, never removable). */
export const BASE_INSTANCE_ID = 'base-grace';
/** The base instance's character. Grace is now the custom build: the legacy
 *  non-custom `grace` is deprecated and everyone folds onto `grace_custom`
 *  (see migrateInstance). */
export const BASE_AGENT = 'grace_custom';

export interface AgentInstance {
  /** Stable unique id for this slot in the roster. */
  id: string;
  /** Which character this instance is (grace/mark/ava/...). */
  agentId: string;
  /** Optional custom name; falls back to the character's catalog name. */
  name?: string;
  /** This instance's saved outfit + colors + lighting. Applied to UE on
   *  every switch into this instance (see applyInstanceWardrobe). Absent
   *  = never customized; the character keeps its authored UE defaults. */
  wardrobe?: WardrobeSettings;
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultStack(): AgentInstance[] {
  return [{ id: BASE_INSTANCE_ID, agentId: BASE_AGENT }];
}

function isInstance(x: unknown): x is AgentInstance {
  return !!x && typeof x === 'object'
    && typeof (x as AgentInstance).id === 'string'
    && typeof (x as AgentInstance).agentId === 'string';
}

/** One-way migration of a persisted instance's character id, applied on every
 *  load + cloud restore so old rosters converge:
 *   - legacy non-custom `grace` folds onto the custom `grace_custom` build. Its
 *     saved outfit is dropped (the restricted base-six wardrobe doesn't map to
 *     the full custom catalog), so customizations reset until re-set.
 *   - `syd_custom` is pulled from the roster (not shipping yet) -> null = drop.
 *  Returns null to remove the instance entirely. */
function migrateInstance(i: AgentInstance): AgentInstance | null {
  if (i.agentId === 'grace') return { ...i, agentId: 'grace_custom', wardrobe: undefined };
  if (i.agentId === 'syd_custom') return null;
  return i;
}

/** Validate + canonicalize an arbitrary roster array: drop malformed
 *  instances and guarantee the permanent base instance is present + first.
 *  Returns the default stack when nothing valid survives. Shared by `load`
 *  (localStorage) and `hydrateStack` (cloud restore) so both apply the same
 *  invariants. */
function normalize(arr: unknown): AgentInstance[] {
  if (Array.isArray(arr) && arr.every(isInstance) && arr.length > 0) {
    const list = (arr as AgentInstance[])
      .map(migrateInstance)
      .filter((i): i is AgentInstance => i !== null);
    // The permanent base instance always survives migration (grace -> grace_custom);
    // if it was somehow dropped, recreate it on the current base character.
    const base = list.find((i) => i.id === BASE_INSTANCE_ID)
      ?? { id: BASE_INSTANCE_ID, agentId: BASE_AGENT };
    const rest = list.filter((i) => i.id !== BASE_INSTANCE_ID);
    return [base, ...rest];
  }
  return defaultStack();
}

function load(): AgentInstance[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw) as unknown);
  } catch {
    /* corrupt payload -> default */
  }
  return defaultStack();
}

function save(next: AgentInstance[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota -> just won't persist this session */
  }
}

export function useAgentStack() {
  const [stack, setStack] = useState<AgentInstance[]>(load);

  /** Push a new instance of `agentId`; returns its new instance id. */
  const addInstance = useCallback((agentId: string): string => {
    const id = makeId();
    setStack((prev) => {
      const next = [...prev, { id, agentId }];
      save(next);
      return next;
    });
    return id;
  }, []);

  const removeInstance = useCallback((id: string) => {
    if (id === BASE_INSTANCE_ID) return; // base Grace is permanent
    setStack((prev) => {
      if (!prev.some((i) => i.id === id)) return prev;
      const next = prev.filter((i) => i.id !== id);
      save(next);
      return next;
    });
  }, []);

  const renameInstance = useCallback((id: string, rawName: string) => {
    const name = rawName.trim();
    setStack((prev) => {
      const next = prev.map((i) =>
        i.id === id ? { ...i, name: name || undefined } : i);
      save(next);
      return next;
    });
  }, []);

  /** Persist this instance's outfit (clothing indices + colors + lighting).
   *  Called by the customization overlay's save so the look follows the
   *  instance and is re-applied to UE every time it's switched back to. */
  const setInstanceWardrobe = useCallback((id: string, wardrobe: WardrobeSettings) => {
    setStack((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, wardrobe } : i));
      save(next);
      return next;
    });
  }, []);

  /** Wipe the roster back to just the base Grace instance. Called when the
   *  machine changes owning account / on account reset so one account's added
   *  + renamed + re-dressed characters don't bleed into another's before the
   *  signing-in account's own roster is restored from the cloud. */
  const resetStack = useCallback(() => {
    const next = defaultStack();
    save(next);
    setStack(next);
  }, []);

  /** Replace the whole roster with one pulled from the cloud blob (sign-in
   *  reconcile). Normalizes + mirrors to localStorage so it survives reload.
   *  Distinct from the mutation callbacks so the caller can restore without
   *  the change immediately echoing back up to the cloud. */
  const hydrateStack = useCallback((incoming: unknown) => {
    const next = normalize(incoming);
    save(next);
    setStack(next);
  }, []);

  return { stack, addInstance, removeInstance, renameInstance, setInstanceWardrobe, resetStack, hydrateStack };
}
