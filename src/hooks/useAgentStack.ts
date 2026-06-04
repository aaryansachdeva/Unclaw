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
export const BASE_AGENT = 'grace';

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

function load(): AgentInstance[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.every(isInstance) && arr.length > 0) {
        const list = arr as AgentInstance[];
        // Guarantee the permanent base instance is present + first.
        const base = list.find((i) => i.id === BASE_INSTANCE_ID)
          ?? { id: BASE_INSTANCE_ID, agentId: BASE_AGENT };
        const rest = list.filter((i) => i.id !== BASE_INSTANCE_ID);
        return [base, ...rest];
      }
    }
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

  return { stack, addInstance, removeInstance, renameInstance, setInstanceWardrobe };
}
