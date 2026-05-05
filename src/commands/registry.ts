// Slash command registry. Add new commands here — both the hook and
// the input bar pick them up automatically.
//
// Each command is declarative: name, description, icon, and a `run`
// function that receives the user-typed arguments (a string after the
// command word) plus an `actions` bag of host callbacks. Keep `run`
// implementations thin — they should just delegate to the appropriate
// action callback. Heavy logic belongs in App.tsx where state lives.
//
// Behavior model:
//   * `takesArgs: false` (default) → command needs no argument. When
//     the slash menu is open and the user presses Tab on this item,
//     it EXECUTES immediately (no autocomplete-then-wait step). Same
//     for Enter.
//   * `takesArgs: true` → command needs one or more argument words.
//     Tab AUTOCOMPLETES the typed text up to the full command plus a
//     trailing space, parking the caret ready to type the argument.
//     The user then types the args and presses Enter (or Tab again
//     with args already entered) to execute.

import {
  Bell, BarChart3, Newspaper, Cloud, Sparkles, Eraser,
  Heart, Wind, UserCog, Drama, Swords, LucideIcon,
} from 'lucide-react';

import type { SheetKey } from '../hooks/useSheet';

/** Host-provided callbacks. Add a new field here when adding a
 *  command that needs a new app-level action; App.tsx then wires
 *  the implementation through the InputBar -> hook -> registry path. */
export interface CommandActions {
  onOpenSheet: (key: SheetKey) => void;
  onDispatchAnimation: (name: 'give_a_kiss' | 'do_dance' | 'say_hello' | 'react_as_star_wars_fan') => void;
  onClearMemory: () => void;
  onOpenOnboarding: () => void;
  onExpress: (emotion: string) => void;
}

export interface SlashCommand {
  /** Includes the leading slash, e.g. '/express'. */
  command: string;
  /** One-line human description shown next to the command. */
  description: string;
  /** Lucide icon for the row. */
  icon: LucideIcon;
  /** When true, Tab autocompletes (parking the caret after a space)
   *  instead of executing. Defaults to false (Tab fires immediately). */
  takesArgs?: boolean;
  /** Optional placeholder shown after the command in the slash menu
   *  to hint what argument is expected, e.g. '<emotion>'. Cosmetic. */
  argHint?: string;
  /** Invoked on select/Tab-execute. Receives the trimmed args string
   *  (whatever the user typed after the command word) and the host
   *  actions bag. */
  run: (args: string, actions: CommandActions) => void;
}

// =====================================================================
// THE REGISTRY
// =====================================================================
// Add new commands at the bottom (or grouped logically). Order here is
// the order shown in the slash menu when the user types just '/'.

export const SLASH_COMMANDS: SlashCommand[] = [
  // ---- widget panels ------------------------------------------------
  {
    command: '/reminders',
    description: 'Open the reminders panel',
    icon: Bell,
    run: (_a, actions) => actions.onOpenSheet('reminders'),
  },
  {
    command: '/stocks',
    description: 'Open the watchlist',
    icon: BarChart3,
    run: (_a, actions) => actions.onOpenSheet('stocks'),
  },
  {
    command: '/news',
    description: 'Open the headlines',
    icon: Newspaper,
    run: (_a, actions) => actions.onOpenSheet('news'),
  },
  {
    command: '/weather',
    description: 'Open the weather',
    icon: Cloud,
    run: (_a, actions) => actions.onOpenSheet('weather'),
  },

  // ---- character animations ----------------------------------------
  {
    command: '/dance',
    description: 'Ask the agent to dance',
    icon: Sparkles,
    run: (_a, actions) => actions.onDispatchAnimation('do_dance'),
  },
  {
    command: '/kiss',
    description: 'Ask for a kiss',
    icon: Heart,
    run: (_a, actions) => actions.onDispatchAnimation('give_a_kiss'),
  },
  {
    command: '/hello',
    description: 'Wave hello',
    icon: Wind,
    run: (_a, actions) => actions.onDispatchAnimation('say_hello'),
  },
  {
    command: '/starwars',
    description: 'May the Force be with you (lightsaber idle)',
    icon: Swords,
    run: (_a, actions) => actions.onDispatchAnimation('react_as_star_wars_fan'),
  },
  {
    command: '/express',
    description: 'Express an emotion (T2F-only probe)',
    icon: Drama,
    takesArgs: true,
    argHint: '<emotion>',
    run: (args, actions) => {
      const emotion = args.trim();
      if (emotion) actions.onExpress(emotion);
    },
  },

  // ---- session / profile -------------------------------------------
  {
    command: '/clear',
    description: 'Clear conversation memory',
    icon: Eraser,
    run: (_a, actions) => actions.onClearMemory(),
  },
  {
    command: '/onboard',
    description: 'Edit your profile + vibe sliders',
    icon: UserCog,
    run: (_a, actions) => actions.onOpenOnboarding(),
  },
];
