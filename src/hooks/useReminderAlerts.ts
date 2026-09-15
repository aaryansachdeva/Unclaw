// Reminder alerts. A notification LEAD_MINUTES before a timed reminder;
// at its time (9 AM for a date-only one) a notification and a spoken line
// from the character. Notifications are native, sent by the main process
// (electronAPI.showNotification); clicking one reports its reminder back. The clock runs here, every 15 s and whenever the
// list changes, but soul decides what already fired (POST
// /reminders/{id}/alert claims each stage once per reminder time), so a
// reload, a second window or a restart never repeats an alert, and a
// moved reminder alerts again at its new time.
//
// Speech waits for a quiet moment (the caller's `canSpeak`: no reply in
// flight, not speaking, no tool run) for up to five minutes, one line at a
// time; past that only the notification stands.

import { useEffect, useRef } from 'react';

import { claimReminderAlert, type Reminder } from '../services/reminders';
import { alertStage, dueAt, formatClock, parseWhen, type AlertStage } from '../services/reminderSchedule';

const TICK_MS = 15_000;
const SPEAK_WAIT_MS = 5 * 60_000;

interface Options {
  enabled: boolean;
  reminders: Reminder[];
  /** True when the character can talk without cutting anything off. */
  canSpeak: () => boolean;
  /** Render and play the line; resolves with its duration in seconds. */
  speak: (reminder: Reminder, minutesLate: number) => Promise<number>;
  onNotificationClick?: (reminder: Reminder) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function notificationBody(r: Reminder, stage: AlertStage, now: Date): string {
  const w = parseWhen(r.when_iso);
  const at = dueAt(r);
  const parts: string[] = [];
  if (w && at) {
    if (stage === 'lead') {
      const mins = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000));
      parts.push(`In ${mins} min`, formatClock(at));
    } else if (w.dateOnly) {
      parts.push('Today');
    } else if (now.getTime() - at.getTime() > 2 * 60_000) {
      parts.push(`Was due at ${formatClock(at)}`);
    } else {
      parts.push(`Now, ${formatClock(at)}`);
    }
  }
  if (r.location) parts.push(r.location);
  return parts.join(' · ');
}

type NotifyBridge = {
  showNotification?: (opts: { title: string; body?: string; tag?: string }) => void;
  onNotificationClick?: (cb: (tag: string) => void) => () => void;
};
const bridge = (): NotifyBridge | undefined =>
  (window as unknown as { electronAPI?: NotifyBridge }).electronAPI;

function notify(r: Reminder, stage: AlertStage, now: Date) {
  const title = r.title;
  const body = notificationBody(r, stage, now);
  const tag = `reminder-${r.id}-${stage}`;
  const api = bridge();
  if (api?.showNotification) { api.showNotification({ title, body, tag }); return; }
  // Outside Electron (a plain browser preview): the web API, where allowed.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, tag }); } catch (err) { console.warn('[reminders] notification failed', err); }
}

export function useReminderAlerts({ enabled, reminders, canSpeak, speak, onNotificationClick }: Options): void {
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const callbacksRef = useRef({ canSpeak, speak, onNotificationClick });
  callbacksRef.current = { canSpeak, speak, onNotificationClick };
  // Keys (id:stage:when) already claimed or being claimed in this window.
  const handledRef = useRef(new Set<string>());
  const queueRef = useRef<Array<{ reminder: Reminder; queuedAt: number }>>([]);
  const drainingRef = useRef(false);
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!enabled) { tickRef.current = null; return undefined; }
    let stopped = false;

    const drain = async () => {
      if (drainingRef.current) return;
      drainingRef.current = true;
      try {
        while (!stopped && queueRef.current.length > 0) {
          const item = queueRef.current[0];
          if (!callbacksRef.current.canSpeak()) {
            if (Date.now() - item.queuedAt > SPEAK_WAIT_MS) { queueRef.current.shift(); continue; }
            await sleep(2000);
            continue;
          }
          queueRef.current.shift();
          const at = dueAt(item.reminder);
          const late = at ? Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000)) : 0;
          try {
            const seconds = await callbacksRef.current.speak(item.reminder, late);
            if (seconds > 0) await sleep(seconds * 1000 + 800);
          } catch (err) {
            console.warn('[reminders] announce failed', err);
          }
        }
      } finally {
        drainingRef.current = false;
      }
    };

    const tick = async () => {
      const now = new Date();
      for (const r of remindersRef.current) {
        if (stopped) return;
        const stage = alertStage(r, now);
        if (!stage) continue;
        const key = `${r.id}:${stage}:${r.when_iso}`;
        if (handledRef.current.has(key)) continue;
        handledRef.current.add(key);
        const claim = await claimReminderAlert(r.id, stage);
        if (claim === 'error') { handledRef.current.delete(key); continue; }
        if (claim !== 'claimed') continue;
        console.log(`[reminders] ${stage} alert: ${r.title}`);
        notify(r, stage, now);
        if (stage === 'due') {
          queueRef.current.push({ reminder: r, queuedAt: Date.now() });
          void drain();
        }
      }
    };
    tickRef.current = tick;

    void tick();
    const id = window.setInterval(() => { void tick(); }, TICK_MS);
    return () => { stopped = true; window.clearInterval(id); tickRef.current = null; };
  }, [enabled]);

  // A reminder added or moved close to now should not wait for the next beat.
  useEffect(() => { void tickRef.current?.(); }, [reminders]);

  // Notification clicks come back from the main process as the tag.
  useEffect(() => bridge()?.onNotificationClick?.((tag) => {
    const m = /^reminder-(.+)-(lead|due)$/.exec(tag || '');
    const r = m ? remindersRef.current.find((x) => x.id === m[1]) : undefined;
    if (r) callbacksRef.current.onNotificationClick?.(r);
  }), []);
}
