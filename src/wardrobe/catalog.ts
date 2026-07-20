// Wardrobe catalog for the CUSTOM characters (grace_custom / kevin_custom /
// syd_custom). These builds expose far more than the original six: 34 hair, 18
// brows, 6 lashes, plus the original clothing slots.
//
// `index` is the ONLY thing UE cares about — it's the array index into the
// wardrobe DataAsset, sent verbatim as changeWardrobeItem's `wardrobeIndex`.
// Everything else here (key, name, thumb) is ours, for the picker.
//
// Source of truth: ~/Documents/Unclaw-Mac/thumbnails/index.json. Transcribed
// rather than imported so the indices are reviewable in a diff and can't drift
// silently when that folder is regenerated.
//
// Two known gaps, deliberate (verified against the folder on 2026-07-16):
//   * `jeansMidCalf` (bottom 6) has no thumbnail — renders the nameplate.
//   * The folder also carries cargoPants / chealseaBoots / loafers /
//     runningShoes. index.json does NOT list them, so they are NOT wired: an
//     index we can't verify would equip the wrong garment. If they're real,
//     they need index numbers from the DataAsset first.

export type CustomCategory =
  | 'hair' | 'eyebrow' | 'eyelash' | 'top' | 'bottom' | 'shoes';

export interface WardrobeItem {
  /** Array index into the UE DataAsset. Sent as `wardrobeIndex`. */
  index: number;
  /** Stable asset key (matches the UE asset name). */
  key: string;
  /** Human label for the picker. */
  name: string;
  /** Bundled thumbnail URL, or undefined when the asset has no art yet. */
  thumb?: string;
}

// Vite resolves these at build time into fingerprinted URLs. `eager` so the
// grid never pops in a frame late, and the whole set is ~11MB of 512px stills
// that the picker shows all at once anyway.
const THUMBS = import.meta.glob<string>(
  '../assets/wardrobe/**/*.{png,jpg}',
  { eager: true, query: '?url', import: 'default' },
);

/** `clothing/hoodie.jpg` -> the bundled URL. Undefined when absent. */
function thumb(rel: string): string | undefined {
  return THUMBS[`../assets/wardrobe/${rel}`];
}

// ---- Tops -------------------------------------------------------------
// The thumbnail filenames diverge from the index keys (the art was re-exported
// as .jpg under different names), so the mapping is explicit rather than
// derived from the key. Verified by eye against each render.
export const TOPS: WardrobeItem[] = [
  { index: 0, key: 'hoodie',            name: 'Hoodie',        thumb: thumb('clothing/hoodie.jpg') },
  { index: 1, key: 'sweater',           name: 'Sweater',       thumb: thumb('clothing/sweater.jpg') },
  { index: 2, key: 'crewNeckTee',       name: 'Crew Tee',      thumb: thumb('clothing/tshirt.jpg') },
  { index: 3, key: 'cropTopPushCufSlv', name: 'Crop Top',      thumb: thumb('clothing/cropTop.jpg') },
  { index: 4, key: 'teeLngSlv',         name: 'Long Tee',      thumb: thumb('clothing/tshirtLong.jpg') },
];

// ---- Bottoms ----------------------------------------------------------
export const BOTTOMS: WardrobeItem[] = [
  { index: 0, key: 'jeans',            name: 'Jeans',        thumb: thumb('clothing/jeans.jpg') },
  { index: 1, key: 'skinnyJeans',      name: 'Skinny Jeans', thumb: thumb('clothing/slimJeans.jpg') },
  { index: 2, key: 'yogaPants',        name: 'Yoga Pants',   thumb: thumb('clothing/yogaPants.jpg') },
  { index: 3, key: 'yogaPantsShort',   name: 'Yoga Shorts',  thumb: thumb('clothing/yogaPantsShort.jpg') },
  { index: 4, key: 'skinnyJeansShort', name: 'Denim Shorts', thumb: thumb('clothing/slimJeansShort.jpg') },
  { index: 5, key: 'shorts',           name: 'Shorts',       thumb: thumb('clothing/shorts.jpg') },
  // No art in the drop — nameplate fallback. Still equippable.
  { index: 6, key: 'jeansMidCalf',     name: 'Mid-Calf Jeans' },
];

// ---- Shoes ------------------------------------------------------------
export const SHOES: WardrobeItem[] = [
  { index: 0, key: 'casualSneakers',  name: 'Sneakers',  thumb: thumb('clothing/casualSneaker.jpg') },
  { index: 1, key: 'boots',           name: 'Boots',     thumb: thumb('clothing/boots.jpg') },
  { index: 2, key: 'hightopSneakers', name: 'High Tops', thumb: thumb('clothing/highTops.jpg') },
  { index: 3, key: 'flipFlops',       name: 'Flip Flops', thumb: thumb('clothing/flipFlops.jpg') },
];

// ---- Grooms -----------------------------------------------------------
// Hair/brow/lash thumbnail filenames match their keys exactly, so these are
// generated from the key list instead of being hand-paired. The ORDER is the
// index — never re-sort these arrays.
function groom(dir: string, keys: Array<[string, string]>): WardrobeItem[] {
  return keys.map(([key, name], index) => ({
    index, key, name, thumb: thumb(`${dir}/${key}.png`),
  }));
}

export const HAIR: WardrobeItem[] = groom('hair', [
  ['Hair_L_AfroCurly', 'Afro Curly'],
  ['Hair_L_MessyClumps', 'Messy Clumps'],
  ['Hair_L_Straight', 'Long Straight'],
  ['Hair_L_StraightBangs', 'Straight Bangs'],
  ['Hair_M_BobBangs', 'Bob Bangs'],
  ['Hair_M_BobCurly', 'Bob Curly'],
  ['Hair_M_BobMessy', 'Bob Messy'],
  ['Hair_M_BobSlick', 'Bob Slick'],
  ['Hair_M_BobStraight', 'Bob Straight'],
  ['Hair_M_FauxMohawk', 'Faux Mohawk'],
  ['Hair_M_Layered', 'Layered'],
  ['Hair_M_Mohawk', 'Mohawk'],
  ['Hair_M_SideSweptFringe', 'Side Swept'],
  ['Hair_M_TwistedBraids', 'Twisted Braids'],
  ['Hair_S_AfroFade', 'Afro Fade'],
  ['Hair_S_BobLayered', 'Bob Layered'],
  ['Hair_S_BrushCut', 'Brush Cut'],
  ['Hair_S_Casual', 'Casual'],
  ['Hair_S_Clean', 'Clean'],
  ['Hair_S_Coil', 'Coil'],
  ['Hair_S_Cornrows', 'Cornrows'],
  ['Hair_S_CurlyFade', 'Curly Fade'],
  ['Hair_S_HairLoss', 'Thinning'],
  ['Hair_S_LowPonytail', 'Low Ponytail'],
  ['Hair_S_Messy', 'Messy'],
  ['Hair_S_Pixie', 'Pixie'],
  ['Hair_S_PulledBack', 'Pulled Back'],
  ['Hair_S_RecedeMessy', 'Recede Messy'],
  ['Hair_S_SideSweptFringe', 'Short Swept'],
  ['Hair_S_SlickBack', 'Slick Back'],
  ['Hair_S_SweptUp', 'Swept Up'],
  ['Hair_S_Updo', 'Updo'],
  ['Hair_S_UpdoBraids', 'Updo Braids'],
  ['Hair_S_UpdoBuns', 'Updo Buns'],
]);

export const BROWS: WardrobeItem[] = groom('brows', [
  ['Eyebrows_L_Scraggly', 'Scraggly'],
  ['Eyebrows_L_Shaded', 'Long Shaded'],
  ['Eyebrows_M_Dense', 'Dense'],
  ['Eyebrows_M_Fine', 'Fine'],
  ['Eyebrows_M_FlatThick', 'Flat Thick'],
  ['Eyebrows_M_Full', 'Full'],
  ['Eyebrows_M_Messy', 'Messy'],
  ['Eyebrows_M_Natural', 'Natural'],
  ['Eyebrows_M_Shaded', 'Shaded'],
  ['Eyebrows_M_SlightArch', 'Slight Arch'],
  ['Eyebrows_M_Slit', 'Slit'],
  ['Eyebrows_M_Swept', 'Swept'],
  ['Eyebrows_M_Thick', 'Thick'],
  ['Eyebrows_M_Thin', 'Thin'],
  ['Eyebrows_M_Unruly', 'Unruly'],
  ['Eyebrows_M_Wide', 'Wide'],
  ['Eyebrows_S_FlatThin', 'Flat Thin'],
  ['Eyebrows_S_Shaded', 'Short Shaded'],
]);

export const LASHES: WardrobeItem[] = groom('lashes', [
  ['Eyelashes_L_Curl', 'Long Curl'],
  ['Eyelashes_L_SlightCurl', 'Slight Curl'],
  ['Eyelashes_L_ThickCurl', 'Thick Curl'],
  ['Eyelashes_S_Fine', 'Fine'],
  ['Eyelashes_S_Sparse', 'Sparse'],
  ['Eyelashes_S_Thin', 'Thin'],
]);

/** category -> its items. The key IS the `wardrobeCategory` string UE expects. */
export const CUSTOM_WARDROBE: Record<CustomCategory, WardrobeItem[]> = {
  hair: HAIR,
  eyebrow: BROWS,
  eyelash: LASHES,
  top: TOPS,
  bottom: BOTTOMS,
  shoes: SHOES,
};

/** Ordered head-to-toe, so the rail reads like a body diagram. */
export const CUSTOM_CATEGORY_ORDER: CustomCategory[] =
  ['hair', 'eyebrow', 'eyelash', 'top', 'bottom', 'shoes'];

export const CUSTOM_CATEGORY_LABELS: Record<CustomCategory, string> = {
  hair:    'Hair',
  eyebrow: 'Brows',
  eyelash: 'Lashes',
  top:     'Top',
  bottom:  'Bottom',
  shoes:   'Shoes',
};

/** Categories whose garment material exposes diffuse_color_1/2. Grooms are a
 *  different material path, so they have no clothing-color submenu. */
export const CUSTOM_COLORABLE: CustomCategory[] = ['top', 'bottom', 'shoes'];

export function itemsFor(cat: CustomCategory): WardrobeItem[] {
  return CUSTOM_WARDROBE[cat] ?? [];
}

/** Clamp a saved index back into range — the catalog can shrink between builds. */
export function clampCustomIndex(cat: CustomCategory, value: number | undefined): number {
  const max = itemsFor(cat).length;
  if (value == null || !Number.isFinite(value) || max === 0) return 0;
  return Math.max(0, Math.min(max - 1, Math.floor(value)));
}

/** True for the character ids that use this expanded wardrobe. */
export function isCustomCharacter(agentId: string | null | undefined): boolean {
  return !!agentId && agentId.endsWith('_custom');
}

// ======================================================================
// BASE (non-custom) characters — the original six: grace / mark / ava /
// goblin / chris / joi.
//
// These do NOT use the shared 34-hair / 18-brow / 6-lash catalog. Each has
// its own UE wardrobe DataAsset (DA_Wardrobe_<Name>) with a small, fixed set,
// and `wardrobeIndex` is the array index into THAT DataAsset — a different
// index space than the custom catalog above.
//
// What's the same for all six (verified against every DA_Wardrobe_*): the
// top / bottom / shoes arrays. Their leading indices are identical to the
// custom catalog's, so the base sets are just the custom lists minus the
// custom-only extras (Long Tee at top 4, Mid-Calf Jeans at bottom 6).
//
// What differs per character: HAIR. Each base character carries its own 5
// grooms in its own order (transcribed from each DataAsset's Hair Grooms
// array). The style keys below reuse the 34-hair catalog's keys ONLY to
// borrow their thumbnail + label — the `index` is the base character's own.
//
// What's absent for base characters: eyebrow + eyelash (baked, one each per
// character, not selectable) and body blends (setBlends is custom-only).

/** Tops/bottoms/shoes are shared across all six base characters and match the
 *  custom catalog's leading indices exactly. */
const BASE_TOPS: WardrobeItem[]    = TOPS.slice(0, 4);   // hoodie, sweater, crewNeckTee, cropTop
const BASE_BOTTOMS: WardrobeItem[] = BOTTOMS.slice(0, 6); // jeans … shorts (no Mid-Calf)
const BASE_SHOES: WardrobeItem[]   = SHOES;               // all four, identical to custom

/** Category order for base characters: no brows/lashes. */
export const BASE_CATEGORY_ORDER: CustomCategory[] = ['hair', 'top', 'bottom', 'shoes'];

const HAIR_BY_KEY = new Map(HAIR.map((h) => [h.key, h] as const));

/** Build a base character's hair list: [baseIndex, catalogKey] pairs. The key
 *  'none' is a real slot (an empty groom in the DataAsset — e.g. Goblin's bald
 *  index 0) and renders the nameplate fallback. Every other key borrows its
 *  label + thumbnail from the 34-hair catalog. */
function baseHair(pairs: Array<[number, string]>): WardrobeItem[] {
  return pairs.map(([index, key]) => {
    if (key === 'none') return { index, key: 'none', name: 'Bald' };
    const h = HAIR_BY_KEY.get(key);
    return { index, key, name: h?.name ?? key, thumb: h?.thumb };
  });
}

/** Per-base-character hair grooms, in DataAsset (wardrobeIndex) order. */
export const BASE_HAIR: Record<string, WardrobeItem[]> = {
  ava: baseHair([
    [0, 'Hair_S_Updo'], [1, 'Hair_L_Straight'], [2, 'Hair_L_StraightBangs'],
    [3, 'Hair_M_BobCurly'], [4, 'Hair_M_BobMessy'],
  ]),
  chris: baseHair([
    [0, 'Hair_S_Casual'], [1, 'Hair_S_Clean'], [2, 'Hair_S_SideSweptFringe'],
    [3, 'Hair_S_SweptUp'], [4, 'Hair_M_Layered'],
  ]),
  goblin: baseHair([
    [0, 'none'], [1, 'Hair_M_FauxMohawk'], [2, 'Hair_M_Mohawk'],
    [3, 'Hair_S_CurlyFade'], [4, 'Hair_S_PulledBack'],
  ]),
  grace: baseHair([
    [0, 'Hair_S_Updo'], [1, 'Hair_M_BobMessy'], [2, 'Hair_M_BobCurly'],
    [3, 'Hair_L_StraightBangs'], [4, 'Hair_M_TwistedBraids'],
  ]),
  joi: baseHair([
    [0, 'Hair_M_BobStraight'], [1, 'Hair_M_BobCurly'], [2, 'Hair_L_MessyClumps'],
    [3, 'Hair_L_StraightBangs'], [4, 'Hair_S_Updo'],
  ]),
  mark: baseHair([
    [0, 'Hair_M_TwistedBraids'], [1, 'Hair_M_FauxMohawk'], [2, 'Hair_M_Layered'],
    [3, 'Hair_S_AfroFade'], [4, 'Hair_S_Coil'],
  ]),
};

/** Everything the customization UI needs to render one character's wardrobe. */
export interface AgentWardrobe {
  /** Category chips to show, in order. */
  categories: CustomCategory[];
  /** category -> its items (empty array for categories this character lacks). */
  items: Record<CustomCategory, WardrobeItem[]>;
  /** Categories with a two-tone color submenu. */
  colorable: CustomCategory[];
  /** Whether the character supports body blends (height/weight). Custom-only. */
  body: boolean;
}

const EMPTY_ITEMS: Record<CustomCategory, WardrobeItem[]> = {
  hair: [], eyebrow: [], eyelash: [], top: [], bottom: [], shoes: [],
};

/** Resolve the wardrobe surface for an agent. Custom characters get the full
 *  catalog + brows/lashes + body; base characters get their restricted set
 *  (shared clothing, own hair, no brows/lashes, no body). */
export function wardrobeForAgent(agentId: string | null | undefined): AgentWardrobe {
  if (isCustomCharacter(agentId)) {
    return {
      categories: CUSTOM_CATEGORY_ORDER,
      items: CUSTOM_WARDROBE,
      colorable: CUSTOM_COLORABLE,
      body: true,
    };
  }
  const hair = BASE_HAIR[agentId ?? ''] ?? BASE_HAIR.grace;
  return {
    categories: BASE_CATEGORY_ORDER,
    items: { ...EMPTY_ITEMS, hair, top: BASE_TOPS, bottom: BASE_BOTTOMS, shoes: BASE_SHOES },
    colorable: CUSTOM_COLORABLE,
    body: false,
  };
}

/** Clamp a saved index into a resolved item list (per-agent bounds). */
export function clampAgentIndex(items: WardrobeItem[], value: number | undefined): number {
  const max = items.length;
  if (value == null || !Number.isFinite(value) || max === 0) return 0;
  return Math.max(0, Math.min(max - 1, Math.floor(value)));
}
