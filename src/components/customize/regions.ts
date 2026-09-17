// Hotspot regions (2026-09-17): Customize opens on the whole figure with a spot
// on each part you can change. Tap one and its options open beside her.
//
// TWO LEVELS. The body level holds Face, Top, Legs, Shoes, Body and the key
// light. Tapping Face does not open a panel: the camera moves in and the face
// level takes over, with its own spots for hair, brows, lashes, beard, mustache
// and (on characters with a blend rig) face shape. That keeps six readable
// labels on screen instead of eleven crowded ones, and it puts the groom spots
// where you can actually see what they do.
//
// Where the spots go. Unreal knows where the head, jaw, chest, legs and feet are
// after body sliders and idle sway, so it sends them: while Customize is open
// the app asks for {EventType:'hotspots', enabled:true} and UE replies
// {EventType:'hotspots', points:{hair:[x,y], ...}} in 0-1 viewport coordinates
// (UUnclawHotspotsSubsystem). Until it does, a hand-tuned map per camera
// framing places them; that map is measured in WIDTH units from the window
// centre, because UE keeps the horizontal field of view as the window changes
// shape: a taller window shows more above and below, not a bigger her.

import { useEffect, useRef, useState } from 'react';
import type { CustomCategory } from '../../wardrobe/catalog';

export type RegionId =
  | 'face' | 'hair' | 'brows' | 'lashes' | 'beard' | 'mustache' | 'shape'
  | 'top' | 'legs' | 'shoes' | 'body' | 'scene';

/** Which set of spots is on screen. */
export type Level = 'body' | 'face';
/** Which camera shot that level uses. */
export type Framing = 'body' | 'face';

/** The garment categories each region edits. Face is a hub, Shape and Body edit
 *  blend axes, Scene edits the room, so those carry none. */
export const REGION_CATEGORIES: Record<RegionId, CustomCategory[]> = {
  face: [],
  hair: ['hair'],
  brows: ['eyebrow'],
  lashes: ['eyelash'],
  beard: ['beard'],
  mustache: ['mustache'],
  shape: [],
  top: ['top'],
  legs: ['bottom'],
  shoes: ['shoes'],
  body: [],
  scene: [],
};

/** The face level, in the order they are laid out. */
export const FACE_REGIONS: RegionId[] = ['hair', 'brows', 'lashes', 'mustache', 'beard', 'shape'];

export const REGION_LABEL: Record<RegionId, string> = {
  face: 'Face',
  hair: 'Hair',
  brows: 'Brows',
  lashes: 'Lashes',
  beard: 'Beard',
  mustache: 'Mustache',
  shape: 'Shape',
  top: 'Top',
  legs: 'Legs',
  shoes: 'Shoes',
  body: 'Body',
  scene: 'Light',
};

/** Which side of her a region's label sits on. Chosen so neighbours alternate
 *  and no two labels on one side land within ~90 px of each other. */
export const REGION_SIDE: Record<RegionId, 'left' | 'right'> = {
  face: 'right',
  hair: 'right',
  brows: 'left',
  lashes: 'right',
  mustache: 'left',
  beard: 'right',
  shape: 'left',
  top: 'left',
  legs: 'right',
  shoes: 'left',
  body: 'right',
  scene: 'left',
};

/** The face level is the close shot; the body level is the whole figure. */
export function framingFor(level: Level): Framing {
  return level === 'face' ? 'face' : 'body';
}

type Anchor = [number, number];

/** Measured on Grace at 600 x 780 in each customize shot, with her centred:
 *  the pulled-back whole figure (feet included) and the close-up. */
const ANCHORS: Record<Framing, Partial<Record<RegionId, Anchor>>> = {
  body: {
    face: [0, -0.36],
    top: [0, -0.12],
    legs: [-0.04, 0.18],
    shoes: [-0.05, 0.44],
    body: [-0.17, 0.06],
  },
  face: {
    hair: [-0.02, -0.26],
    brows: [-0.09, -0.07],
    lashes: [0.08, -0.03],
    mustache: [-0.06, 0.09],
    beard: [0.02, 0.17],
    shape: [0.12, 0.02],
  },
};

export interface Point { x: number; y: number }

/** Fallback position of a region in pixels for a box of w x h. */
export function anchorPoint(region: RegionId, framing: Framing, w: number, h: number): Point | null {
  const a = ANCHORS[framing][region];
  if (!a) return null;
  return { x: w / 2 + a[0] * w, y: h / 2 + a[1] * w };
}

/** Where the key light sits: low on the left, clear of every label, drifting a
 *  little toward the side it shines from. 0 is front, 90 camera-right. */
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
      if (import.meta.env.DEV) {
        const w2 = window as unknown as { __unclawDev?: Record<string, unknown> };
        w2.__unclawDev = { ...(w2.__unclawDev ?? {}), lastHotspots: { at: Date.now(), points: next } };
      }
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
