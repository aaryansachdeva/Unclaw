// Slash-command engine for the dock input. Pure state machine — no
// DOM, no key handling here; the consumer (InputBar) owns the
// textarea and forwards Up/Down/Enter/Tab/Escape into navigateUp/
// navigateDown/select/tabKey/dismiss.
//
// The actual command catalog lives in `src/commands/registry.ts`.
// This hook just consumes that catalog and wires the host's actions
// (open sheet, dispatch UE animation, clear memory, etc.) into each
// command's `run` callback.
//
// Tab key behavior is per-command:
//   * `takesArgs: false` → Tab executes the command immediately
//   * `takesArgs: true`  → Tab autocompletes to `command + ' '`
//
// The `completion` field is the ghost-text SUFFIX to render after the
// user's typed text. E.g. user types "/e", best match is "/express",
// completion = "xpress " (with trailing space because /express
// takesArgs). Empty when there's no match, when args mode is active
// (user typed past the command word), or when the typed text isn't
// a strict prefix of the matched command.

import { useCallback, useMemo, useState } from 'react';
import { LucideIcon } from 'lucide-react';

import { SLASH_COMMANDS, type CommandActions, type SlashCommand } from '../commands/registry';

/** Surface item the InputBar's slash menu renders. Same shape as the
 *  registry entry minus the actions binding (already closed-over by
 *  `runBound`). Kept as a distinct type so UI code doesn't have to
 *  import the registry directly. */
export interface SlashItem {
  command: string;
  description: string;
  icon: LucideIcon;
  takesArgs?: boolean;
  argHint?: string;
  /** Pre-bound runner. Pass the args string the user typed. */
  runBound: (args: string) => void;
}

interface UseSlashCommandsArgs {
  /** Current input value. */
  value: string;
  /** Host callbacks the registry's commands invoke. */
  actions: CommandActions;
}

export interface SlashAPI {
  /** True iff the input is in slash-command mode (starts with `/`). */
  active: boolean;
  /** Filter query — characters after the slash. */
  query: string;
  /** Currently filtered + ranked items. */
  items: SlashItem[];
  /** Index into `items` for the highlighted row. */
  highlightedIndex: number;
  /** Cycle highlight up by one (wraps at the top). */
  navigateUp: () => void;
  /** Cycle highlight down by one (wraps at the bottom). */
  navigateDown: () => void;
  /** Run the highlighted item (or a specific one). */
  select: (item?: SlashItem) => void;
  /** Reset highlight to first item — call when the query changes. */
  reset: () => void;
  /** Ghost-text suffix to render after the user's typed text. Empty
   *  when there's no completable match (substring fallback, args
   *  mode, no items, or the user has already typed past the
   *  command word). */
  completion: string;
  /** Tab-key handler. For args-bearing commands, returns the new
   *  textarea value (caller should setMessage to it). For args-free
   *  commands, executes the command and returns null (caller should
   *  clear the textarea). Returns undefined when nothing actionable
   *  exists (no items, etc.) so the caller can fall through to
   *  whatever default Tab behavior the surface has. */
  tabKey: () => string | null | undefined;
}

export function useSlashCommands({
  value,
  actions,
}: UseSlashCommandsArgs): SlashAPI {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Bind each registry command to the current actions bag. useMemo on
  // `actions` so the closures pick up updated callbacks but we don't
  // rebuild on every keystroke.
  const all: SlashItem[] = useMemo(() => {
    return SLASH_COMMANDS.map<SlashItem>((cmd: SlashCommand) => ({
      command: cmd.command,
      description: cmd.description,
      icon: cmd.icon,
      takesArgs: cmd.takesArgs,
      argHint: cmd.argHint,
      runBound: (args: string) => cmd.run(args, actions),
    }));
  }, [actions]);

  const active = value.startsWith('/');
  // Split the query at the first whitespace: the COMMAND word (used
  // for filtering) is everything before the space; ARGS (passed to
  // run) is everything after. So `/express surprise` filters on
  // "express" and runs with "surprise".
  const rawQuery = active ? value.slice(1) : '';
  const firstSpace = rawQuery.search(/\s/);
  const queryWord = (firstSpace === -1 ? rawQuery : rawQuery.slice(0, firstSpace)).toLowerCase();
  const queryArgs = firstSpace === -1 ? '' : rawQuery.slice(firstSpace + 1);
  const inArgsMode = firstSpace !== -1;
  // Kept for backward compat in the API surface.
  const query = rawQuery.toLowerCase();

  // Prefix-match first; fall back to substring so typos like `/lear`
  // still find `/clear`. Only render when active.
  const items = useMemo(() => {
    if (!active) return [];
    if (!queryWord) return all;
    const prefix = all.filter(it => it.command.slice(1).toLowerCase().startsWith(queryWord));
    if (prefix.length > 0) return prefix;
    return all.filter(it => it.command.slice(1).toLowerCase().includes(queryWord));
  }, [active, queryWord, all]);

  const safeIndex = Math.min(highlightedIndex, Math.max(0, items.length - 1));
  const highlighted = items[safeIndex];

  // Ghost-text completion. Only when:
  //   * Slash is active and there's a highlighted item
  //   * The user is NOT in args mode (no space typed yet)
  //   * The highlighted command STARTS WITH the typed text
  //     (i.e. this is a prefix match, not a substring fallback)
  //   * The user hasn't typed the full command yet
  const completion = useMemo(() => {
    if (!active || !highlighted || inArgsMode) return '';
    const cmdLower = highlighted.command.toLowerCase();
    const typedLower = value.toLowerCase();
    if (!cmdLower.startsWith(typedLower)) return '';
    if (cmdLower === typedLower) {
      // Already fully typed. For args commands we still want a
      // trailing-space hint so the user knows to add the arg.
      return highlighted.takesArgs ? ' ' : '';
    }
    const suffix = highlighted.command.slice(value.length);
    return highlighted.takesArgs ? suffix + ' ' : suffix;
  }, [active, highlighted, inArgsMode, value]);

  const navigateUp = useCallback(() => {
    setHighlightedIndex(i => {
      const len = items.length || 1;
      return (i - 1 + len) % len;
    });
  }, [items.length]);

  const navigateDown = useCallback(() => {
    setHighlightedIndex(i => {
      const len = items.length || 1;
      return (i + 1) % len;
    });
  }, [items.length]);

  const select = useCallback((item?: SlashItem) => {
    const target = item ?? items[Math.min(highlightedIndex, items.length - 1)];
    if (target) target.runBound(queryArgs);
  }, [items, highlightedIndex, queryArgs]);

  const tabKey = useCallback((): string | null | undefined => {
    if (!active || items.length === 0) return undefined;
    const target = items[Math.min(highlightedIndex, items.length - 1)];
    if (!target) return undefined;
    if (target.takesArgs) {
      // Autocomplete to the full command + a trailing space, parking
      // the caret ready for argument input. If the user already typed
      // PAST the command word (in args mode) just leave it alone —
      // they're already at the args.
      if (inArgsMode) return undefined;
      return target.command + ' ';
    }
    // No-args command: execute immediately. Caller should clear input.
    target.runBound('');
    return null;
  }, [active, items, highlightedIndex, inArgsMode]);

  const reset = useCallback(() => setHighlightedIndex(0), []);

  return {
    active,
    query,
    items,
    highlightedIndex: safeIndex,
    navigateUp,
    navigateDown,
    select,
    reset,
    completion,
    tabKey,
  };
}
