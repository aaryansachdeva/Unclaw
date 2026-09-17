// Hotspot regions (2026-09-16): Customize opens on the whole figure with a
// spot on each part you can change. Tap one and its options open beside her.
//
// Where the spots go. Unreal knows where the head, jaw, chest and legs are
// after body sliders and idle sway, so it can send them: while Customize is
// open the app asks for {EventType:'hotspots', enabled:true} and UE may reply
// {EventType:'hotspots', points:{hair:[x,y], face:[x,y], ...}} in 0-1 viewport
// coordinates. Until it does (or on a build without it), a hand-tuned map per
// camera framing places them. That map is measured in WIDTH units from the
// window centre, because UE keeps the horizontal field of view as the window
// changes shape: a taller window shows more above and below, not a bigger her.

import { useEffect, useRef, useState } from 'react';
import type { CustomCategory } from '../../wardrobe/catalog';

export type RegionId = 'hair' | 'face' | 'facial' | 'top' | 'legs' | 'body' | 'scene';
export type Framing = 'body' | 'face';

/** The garment categories each region edits. Face and Body edit blend axes and
 *  Scene the room, so they carry none. */
export const REGION_CATEGORIES: Record<RegionId, CustomCategory[]> = {
  hair: ['hair', 'eyebrow', 'eyelash'],
  face: [],
  facial: ['beard', 'mustache'],
  top: ['top'],
  legs: ['bottom', 'shoes'],
  body: [],
  scene: [],
};

export const REGION_LABEL: Record<RegionId, string> = {
  hair: 'Hair',
  face: 'Face',
  facial: 'Facial hair',
  top: 'Top',
  legs: 'Legs',
  body: 'Body',
  scene: 'Light',
};

/** Which side of the figure a region's label sits on in the overview. Chosen so
 *  neighbours alternate and no two labels on one side sit closer than ~90 px. */
export const REGION_SIDE: Record<RegionId, 'left' | 'right'> = {
  hair: 'right',
  face: 'left',
  facial: 'right',
  top: 'left',
  legs: 'right',
  body: 'left',
  scene: 'left',
};

/** Face-region edits want the close shot; everything else the whole figure. */
export function framingFor(region: RegionId | null, faceTab: boolean): Framing {
  if (region === 'hair' || region === 'facial') return 'face';
  if (region === 'face' && faceTab) return 'face';
  return 'body';
}

type Anchor = [number, number];

/** Measured on Nova at 600 x 780 (customize pull-back, and the close-up eased
 *  back by CUSTOMIZE_FACE_PULLBACK), with her centred. */
const ANCHORS: Record<Framing, Partial<Record<RegionId, Anchor>>> = {
  body: {
    hair: [0.09, -0.43],
    face: [-0.06, -0.37],
    facial: [0.02, -0.33],
    top: [0, -0.15],
    legs: [-0.05, 0.28],
    body: [-0.17, 0.05],
  },
  face: {
    hair: [-0.03, -0.22],
    face: [-0.11, -0.02],
    facial: [0, 0.12],
    top: [0, 0.36],
  },
};

export interface Point { x: number; y: number }

/** Fallback position of a region in pixels for a box of w x h. */
export function anchorPoint(region: RegionId, framing: Framing, w: number, h: number): Point | null {
  const a = ANCHORS[framing][region];
  if (!a) return null;
  return { x: w / 2 + a[0] * w, y: h / 2 + a[1] * w };
}

/** Where the key light sits in the overview: low on the left, clear of every
 *  label, drifting a little toward the side it shines from. 0 is front, 90
 *  camera-right, 180 behind. */
export function lightPoint(angle: number, w: number, h: number): Point & { behind: boolean } {
  const a = (angle * Math.PI) / 180;
  return { x: Math.max(56, 0.12 * w) + Math.sin(a) * 14, y: h - Math.max(150, 0.2 * w + 40), behind: Math.cos(a) < 0 };
}

export type UeSubscribe = (fn: (raw: string) => void) => () => void;

/** Live points from Unreal, keyed by region, in pixels for the given box. Empty
 *  until UE sends a hotspots reply; stale after 1.5 s without one so the
 *  fallback map takes over again if the stream stops sending. */
export function useUeHotspots(subscribe: UeSubscribe | undefined, w: number, h: number): Partial<Record<RegionId, Point>> {
  const [norm, setNorm] = useState<Partial<Record<RegionId, [number, number]>>>({});
  const staleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!subscribe) return undefined;
    const off = subscribe((raw) => {
      let msg: { EventType?: unknown; points?: unknown };
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg?.EventType !== 'hotspots' || !msg.points || typeof msg.points !== 'object') return;
      const next: Partial<Record<RegionId, [number, number]>> = {};
      for (const [k, v] of Object.entries(msg.points as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
          next[k as RegionId] = [Number(v[0]), Number(v[1])];
        }
      }
      setNorm(next);
      if (staleRef.current != null) window.clearTimeout(staleRef.current);
      staleRef.current = window.setTimeout(() => setNorm({}), 1500);
    });
    return () => {
      off();
      if (staleRef.current != null) window.clearTimeout(staleRef.current);
    };
  }, [subscribe]);
  const out: Partial<Record<RegionId, Point>> = {};
  for (const [k, v] of Object.entries(norm)) {
    if (v) out[k as RegionId] = { x: v[0] * w, y: v[1] * h };
  }
  return out;
}
