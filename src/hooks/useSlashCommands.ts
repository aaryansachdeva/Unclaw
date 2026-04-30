// Slash-command engine for the dock input. Pure state machine — no
// DOM, no key handling here; the consumer (Dock) owns the textarea
// and forwards Up/Down/Enter/Tab/Escape into navigateUp/Down/select/
// dismiss. Action callbacks (open sheet, dispatch UE event, clear
// memory) are injected so this hook stays free of app-specific deps.

import { useCallback, useMemo, useState } from 'react';
import {
  Bell, BarChart3, Newspaper, Cloud, Sparkles, Eraser,
  Heart, Wind, LucideIcon,
} from 'lucide-react';

import { SheetKey } from './useSheet';

export interface SlashItem {
  /** Full command including the leading slash, e.g. `/dance`. */
  command: string;
  /** One-line human description shown next to the command. */
  description: string;
  /** Lucide icon for the row. */
  icon: LucideIcon;
  /** Invoked on select. */
  run: () => void;
}

interface UseSlashCommandsArgs {
  /** Current input value. */
  value: string;
  /** Open a widget sheet by key. */
  onOpenSheet: (key: SheetKey) => void;
  /** Dispatch a UE animation event by name (`give_a_kiss`, `do_dance`,
   *  `say_hello`). The dock provides this so we don't have to import
   *  pixelStreaming here. */
  onDispatchAnimation: (name: 'give_a_kiss' | 'do_dance' | 'say_hello') => void;
  /** Clear conversation memory. The host shows a confirm dialog. */
  onClearMemory: () => void;
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
}

export function useSlashCommands({
  value,
  onOpenSheet,
  onDispatchAnimation,
  onClearMemory,
}: UseSlashCommandsArgs): SlashAPI {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Static command catalog. Built inside useMemo so the action
  // closures pick up the latest props without remounting on every
  // keystroke.
  const all: SlashItem[] = useMemo(() => [
    {
      command: '/reminders',
      description: 'Open the reminders panel',
      icon: Bell,
      run: () => onOpenSheet('reminders'),
    },
    {
      command: '/stocks',
      description: 'Open the watchlist',
      icon: BarChart3,
      run: () => onOpenSheet('stocks'),
    },
    {
      command: '/news',
      description: 'Open the headlines',
      icon: Newspaper,
      run: () => onOpenSheet('news'),
    },
    {
      command: '/weather',
      description: 'Open the weather',
      icon: Cloud,
      run: () => onOpenSheet('weather'),
    },
    {
      command: '/dance',
      description: 'Ask the agent to dance',
      icon: Sparkles,
      run: () => onDispatchAnimation('do_dance'),
    },
    {
      command: '/kiss',
      description: 'Ask for a kiss',
      icon: Heart,
      run: () => onDispatchAnimation('give_a_kiss'),
    },
    {
      command: '/hello',
      description: 'Wave hello',
      icon: Wind,
      run: () => onDispatchAnimation('say_hello'),
    },
    {
      command: '/clear',
      description: 'Clear conversation memory',
      icon: Eraser,
      run: () => onClearMemory(),
    },
  ], [onOpenSheet, onDispatchAnimation, onClearMemory]);

  const active = value.startsWith('/');
  const query = active ? value.slice(1).toLowerCase() : '';

  // Prefix-match first; fall back to substring so typos like `/lear`
  // still find `/clear`. Only render when active.
  const items = useMemo(() => {
    if (!active) return [];
    if (!query) return all;
    const prefix = all.filter(it => it.command.slice(1).toLowerCase().startsWith(query));
    if (prefix.length > 0) return prefix;
    return all.filter(it => it.command.slice(1).toLowerCase().includes(query));
  }, [active, query, all]);

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
    if (target) target.run();
  }, [items, highlightedIndex]);

  const reset = useCallback(() => setHighlightedIndex(0), []);

  return {
    active,
    query,
    items,
    highlightedIndex: Math.min(highlightedIndex, Math.max(0, items.length - 1)),
    navigateUp,
    navigateDown,
    select,
    reset,
  };
}
