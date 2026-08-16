// Photo -> gen-3D bust, the front half of the H3D capture tier.
//
//   1. Gemini "nano banana 2" strips hair/brows/lashes/accessories from the
//      user's photo, because Rodin reconstructs whatever it sees: hair becomes
//      geometry, and a hairy bust conforms badly to a MetaHuman scalp.
//   2. Rodin (Hyper3D) Gen-2.5 turns that clean portrait into a textured GLB.
//   3. A second Gemini call reads the ORIGINAL photo (hair intact) to pick the
//      hair/brow/lash presets, replacing the OpenAI vision pick.
//
// The GLB then feeds the local UE chain: h3d_normalize.py -> h3d_trackshot.py
// -> run_bust_to_dna.py. That part lives in identityInference.ts.
//
// Keys live outside any repo at modal-mh/p1/secrets/*.txt, chmod 600, same
// convention as the OpenAI pipeline key.

import { BrowserWindow, nativeImage } from 'electron';
import { spawn } from 'child_process';
import { ueContainerSavedDir } from './identityInference';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SECRETS = '/Users/foton/Documents/Unclaw-Mac/modal-mh/p1/secrets';
const HYPER3D_KEY_FILE = `${SECRETS}/hyper3d_key.txt`;
const GEMINI_KEY_FILE = `${SECRETS}/gemini_key.txt`;
const OPENAI_KEY_FILE = `${SECRETS}/openai_key.txt`;

// ---- model + tier selection ------------------------------------------------
// Gemini image editing runs on the Interactions API, NOT generateContent.
// "nano banana 2" == gemini-3.1-flash-image (4K capable). Pro is the premium
// tier and costs more; Flash is the right call for a background clean-up.
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
// Basecolor runs on the same flash tier as the cleanup. The pro tier
// (gemini-3-pro-image, verified live) was tried and is one constant away if the
// texture ever justifies the cost, but nothing measured so far did.
const GEMINI_BASECOLOR_MODEL = GEMINI_IMAGE_MODEL;
const GEMINI_TEXT_MODEL = 'gemini-3.6-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// Image work moved BACK to OpenAI 2026-08-09. Gemini's image model kept
// inventing detail on the cleanup pass and drifting on the basecolor layout;
// gpt-image-2 holds a reference layout far better, which is the whole job here.
// The text/vision grooming read stays on Gemini: it is cheap and it works.
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const OPENAI_EDITS_ENDPOINT = 'https://api.openai.com/v1/images/edits';

/** Width/height of an encoded image, for picking an edit size. Falls back to
 *  square, which is the safe default for an unreadable buffer. */
function aspectOf(bytes: Uint8Array): number {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(bytes));
    const { width, height } = img.getSize();
    if (width > 0 && height > 0) return width / height;
  } catch { /* fall through */ }
  return 1;
}

/** Nearest supported edit size for a given aspect. The API takes only a fixed
 *  set, so a portrait photo goes to the portrait slot rather than being squashed
 *  into a square. */
function editSizeFor(aspect: number): string {
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 0.84) return '1024x1536';
  return '1024x1024';
}

/** POST an /images/edits call with one or more reference images.
 *  Returns the first image as bytes. 1K output throughout: the texture is
 *  sampled onto a head at streaming resolution, and 2K costs multiples more. */
async function openaiEdit(
  images: Array<{ bytes: Uint8Array; name: string }>,
  prompt: string,
  size: string,
  timeoutMs = 240_000,
): Promise<Uint8Array> {
  const key = readKey(OPENAI_KEY_FILE, 'OpenAI');
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', 'high');
  // input_fidelity is deliberately absent: gpt-image-2 processes every input at
  // high fidelity and rejects the parameter.
  for (const img of images) {
    form.append('image[]', new Blob([new Uint8Array(img.bytes)], { type: 'image/png' }), img.name);
  }
  const res = await fetch(OPENAI_EDITS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    console.error('[h3d] openai edits HTTP', res.status, body);
    throw new Error(`openai images/edits HTTP ${res.status}: ${body}`);
  }
  const json = await res.json() as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai returned no image');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// Rodin Gen-2.5 is selected through `tier`, not a separate endpoint or a
// version field. Gen-2.5-High is 0.5 credit; the HighPack addon would add 1.
const RODIN_BASE = 'https://api.hyper3d.com/api/v2';
const RODIN_TIER = 'Gen-2.5-High';

/** Long edge the renderer clamps to before upload. Mirrors MAX_EDGE in
 *  AddCustomOverlay; keep the two in step. 1K rather than 2K because image
 *  generation is priced by output resolution and this step only strips hair. */
export const MAX_IMAGE_EDGE = 1024;

function readKey(file: string, label: string): string {
  try {
    const k = fs.readFileSync(file, 'utf8').trim();
    if (k) return k;
  } catch { /* fall through */ }
  throw new Error(`${label} key missing at ${file}`);
}

function progress(win: BrowserWindow | null, stage: string, line: string) {
  try {
    win?.webContents.send('identity:progress', { stage, line });
  } catch { /* window gone */ }
}

/**
 * Strip hair, brows, lashes and accessories while holding the face itself
 * identical. Rodin turns hair into geometry, and a MetaHuman conform wants a
 * bald head, so this is a required step rather than a cosmetic one.
 *
 * The instruction is deliberately repetitive about preserving the face: image
 * models resynthesize rather than edit, and any drift here becomes a permanent
 * likeness error three stages downstream.
 */
export async function geminiRemoveHair(
  win: BrowserWindow | null,
  photoBytes: Uint8Array,
  mime: 'image/jpeg' | 'image/png',
  aspect = 1,
): Promise<Uint8Array> {
  const key = readKey(GEMINI_KEY_FILE, 'Gemini');
  progress(win, 'clean', 'removing hair and accessories');
  void aspect;

  const instruction = [
    'Edit this portrait photograph. Remove ALL hair from the subject:',
    'scalp hair, eyebrows, eyelashes, and any facial hair (beard, moustache, stubble).',
    'The result must be a completely bald head with no eyebrows and no eyelashes.',
    'Also remove any accessories: glasses, earrings, piercings, headwear, hats,',
    'headphones, jewellery, and anything covering or touching the face or head.',
    '',
    'DO NOT ADD ANY NEW DETAILS. DO NOT INVENT, EMBELLISH, SHARPEN, RESTYLE OR',
    'IMAGINE ANYTHING THAT IS NOT ALREADY IN THE PHOTOGRAPH. THIS IS A REMOVAL',
    'ONLY. THE ONLY NEW PIXELS ALLOWED ARE THE BARE SCALP WHERE HAIR USED TO BE,',
    'AND THAT MUST BE PLAIN SKIN CONSISTENT WITH THEIR OWN FOREHEAD.',
    '',
    'Every other aspect of the face must remain EXACTLY the same, pixel for pixel.',
    'Do not change the face shape, skull shape, jawline, chin, cheekbones, nose,',
    'lips, mouth, ears, eyes, eye shape, eye colour, skin tone, skin texture,',
    'moles, freckles, scars, wrinkles, age, expression, head pose, or camera angle.',
    'Do not beautify, smooth, retouch, slim, or stylise the face in any way.',
    'Do not change the lighting or shadows on the face.',
    '',
    'Keep the subject centred, front-on, on a plain neutral background.',
  ].join(' ');

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_IMAGE_MODEL,
      input: [
        { type: 'text', text: instruction },
        { type: 'image', mime_type: mime, data: Buffer.from(photoBytes).toString('base64') },
      ],
      // Only image/jpeg is accepted; image/png is rejected with a 400. No
      // aspect_ratio: unset, the generator preserves the input's own aspect,
      // which is what a portrait edit needs.
      response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    console.error('[h3d] hair removal HTTP', res.status, body);
    throw new Error(`gemini hair-removal HTTP ${res.status}: ${body}`);
  }
  const json = await res.json() as {
    steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
  };
  for (const step of json.steps ?? []) {
    for (const c of step.content ?? []) {
      if (c.type === 'image' && c.data) {
        const out = new Uint8Array(Buffer.from(c.data, 'base64'));
        progress(win, 'clean', `clean portrait received (${Math.round(out.length / 1024)} KB)`);
        return out;
      }
    }
  }
  throw new Error('gemini returned no image');
}

// Reference art for the basecolor generation. Both are 1K so the model is asked
// to match a layout at the same resolution it will output, and both are sent as
// JPEG because the interactions endpoint rejects image/png with a 400.
//
// DEV PATHS. These live beside the prompt they were authored with; a packaged
// build needs them shipped through runtimeAssets like any other data blob.
const BASECOLOR_ART = '/Users/foton/Documents/Unclaw-Mac/modal-mh/p1/basecolor';
const BASECOLOR_BASE = `${BASECOLOR_ART}/unified_base_bc_1k.png`;
const BASECOLOR_GUIDE = `${BASECOLOR_ART}/unified_base_bc_1k_reference.png`;

/** PNG on disk -> JPEG bytes, since the endpoint only accepts image/jpeg. */
function asJpeg(file: string): string {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw new Error(`basecolor art unreadable: ${file}`);
  return img.toJPEG(92).toString('base64');
}

/**
 * Strip the photograph's colour cast before it becomes an albedo.
 *
 * A basecolor is a PHYSICAL value that the engine then lights, so any warm,
 * cool, sepia or filtered grade baked into it gets applied a second time and
 * reads wrong under every lighting condition. Measured on a deliberately
 * vintage-graded portrait, using warm bias (mean R minus mean B) over a
 * forehead band of the resulting texture:
 *
 *     ungraded photo              +73.5   (shipped base texture: +73.4)
 *     vintage, untouched          +80.3
 *     vintage, prompt told to
 *       neutralise the grade      +81.7   <- asking the model does NOT work
 *     vintage, white-balanced     +69.9   <- this
 *
 * White patch rather than grey world: a portrait fills the frame with skin, so
 * assuming the average pixel is neutral drags the correction toward skin tone.
 * Assuming the BRIGHTEST pixels are neutral is the safer bet on a photo of a
 * person. On an already-neutral photo the gains come out near 1.0, so this is
 * close to a no-op rather than something that needs a "should I?" heuristic.
 */
function neutralizeWhiteBalance(bytes: Uint8Array): Uint8Array {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) return bytes;
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();           // BGRA
  const n = width * height;
  if (!n) return bytes;

  // Luminance threshold at the 97th percentile, via a 256-bin histogram.
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    hist[(bmp[o] + bmp[o + 1] + bmp[o + 2]) / 3 | 0]++;
  }
  let cum = 0, thr = 255;
  const target = n * 0.97;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= target) { thr = v; break; }
  }

  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if ((bmp[o] + bmp[o + 1] + bmp[o + 2]) / 3 < thr) continue;
    sb += bmp[o]; sg += bmp[o + 1]; sr += bmp[o + 2]; c++;
  }
  if (!c) return bytes;
  const mr = sr / c, mg = sg / c, mb = sb / c;
  const grey = (mr + mg + mb) / 3;
  const kr = grey / Math.max(mr, 1), kg = grey / Math.max(mg, 1), kb = grey / Math.max(mb, 1);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    bmp[o]     = Math.min(255, bmp[o] * kb);
    bmp[o + 1] = Math.min(255, bmp[o + 1] * kg);
    bmp[o + 2] = Math.min(255, bmp[o + 2] * kr);
  }
  return new Uint8Array(nativeImage.createFromBitmap(bmp, { width, height }).toJPEG(92));
}

/**
 * Generate a UV-unwrapped skin basecolor for the unified face from a portrait.
 *
 * Three inputs, and the ORDER is load-bearing because the prompt refers to them
 * by number: the photo (identity), the shipped base basecolor (the exact UV
 * layout to reproduce), and a line guide marking where features sit.
 *
 * Two clauses here look redundant and are not, both bought with failed runs:
 *
 * OUTPUT PURITY exists because the model will otherwise paint the guide itself
 * into the texture, strokes and the word labels included. Note also that the
 * body text no longer says "dashed line": a run with no guide image at all
 * still drew a dashed line, purely because the prompt mentioned one.
 *
 * FULL-FRAME COVERAGE exists because suppressing the lines made the model treat
 * the face as a portrait floating on flat background, losing the scalp, the
 * outward cheek bleed and the neck. The base texture is skin to every edge and
 * the output has to be too, or the head renders with a flat band around it.
 */
export async function geminiGenerateBasecolor(
  win: BrowserWindow | null,
  photoBytes: Uint8Array,
  mime: 'image/jpeg' | 'image/png',
): Promise<Uint8Array> {
  progress(win, 'basecolor', 'painting skin texture');
  void mime;

  // Compact on purpose. Every clause here was bought with a failed run, and the
  // ones that survived are the ones that name a specific failure: general
  // instructions ("photorealistic skin") were ignored, specific prohibitions
  // ("do not copy image 2's moles") were obeyed.
  //
  // Image order is load-bearing: the prompt refers to them by number.
  const prompt = [
    'THIS IS NOT A PHOTOGRAPH. THIS IS A UV UNWRAP. PAINT IT AS AN UNWRAP, NOT AS A FACE. EVERY FEATURE IS FLATTENED AND STRETCHED OUT OF ITS PHOTOGRAPHIC SHAPE, AND YOU MUST COPY THE FLATTENED SHAPES IN IMAGE 2 RATHER THAN THE SHAPES A CAMERA WOULD SEE.',
    '',
    'TASK: Generate a UV-unwrapped skin BASECOLOR (albedo) texture for a 3D head, in the EXACT UV layout of the second image (a MetaHuman head basecolor texture map).',
    '',
    'The output must be the SAME KIND of image as image 2: a flat unwrapped texture map. NOT a portrait, NOT a 3D render, NOT a photograph of a face. Reproduce image 2 layout precisely: the unwrapped frontal face at the same position and scale, ears as unwrapped islands at the left and right exactly where image 2 has them, scalp wrapping the top of the frame, neck and upper chest filling the bottom, the small mouth-interior islands in the top corners preserved from image 2 unchanged, and the grey shapes along the bottom edge of image 2 preserved exactly as they are.',
    '',
    'IDENTITY SOURCE: Image 1 is a photo of the person, and it is the ONLY source of skin appearance. Transfer their overall skin tone and undertone, complexion, and any moles, freckles or marks they actually have, at anatomically matching positions. Lips take their NATURAL colour, not whatever they are wearing.',
    '',
    'IMAGE 2 IS LAYOUT ONLY (critical): image 2 shows a DIFFERENT person. Take from it the UV arrangement, the island positions and shapes, the edge bleed and the flat even lighting. Take NOTHING of that person\'s skin: do not copy their moles, freckles, blemishes, scars, veins, redness, stubble, skin tone or complexion. If a mark appears in image 2 but not on the person in image 1, it must NOT appear in your output. If the person in image 1 has clear unmarked skin, paint clear unmarked skin.',
    '',
    'SKIN TONE FIDELITY: match the depth of their complexion, do not lighten it. Generated skin drifts pale and washed out, which is the single most common way this texture stops looking like the person. Judge the tone from the mid-tones of their cheeks, forehead and neck in image 1, not from the brightest highlights, which are lighting rather than skin. Warm undertones stay warm, olive stays olive, deep stays deep. If the result could be described as porcelain, chalky, bleached or ghostly, it is wrong. Err slightly toward the deeper reading rather than the lighter one.',
    '',
    'MAKEUP IS NOT SKIN: the person may be wearing lipstick, eyeshadow, eyeliner, blush, bronzer or contour. Do NOT transfer any of it. Paint the NATURAL lip colour their bare lips would have (a soft desaturated pink or rose in their own undertone), never the lipstick shade, however strong it looks. Eyelids are bare skin at cheek brightness with no shadow or liner. Cheeks carry only their own natural colour, no blush and no contour. This texture is the bare face; makeup belongs on a layer above it, exactly as hair does.',
    '',
    'FACIAL HAIR: paint a flat stubble shadow on the jaw, chin and upper lip ONLY if the person in image 1 visibly has stubble or a beard there. If they are clean-shaven or have no visible facial hair, paint none: no grey or green jaw tone, no shadow, just their skin colour.',
    '',
    'ABSOLUTELY NO HAIR OF ANY KIND: this character receives separate 3D hair grooms on top of this texture. Paint ZERO eyebrow hairs: the eyebrow area is completely bare skin, the same color and brightness as the forehead, with no brow shape, no shadow, no hair strands. Paint ZERO eyelash hairs. Paint ZERO scalp hair strands: the scalp region wrapping the top of the frame is bald skin with only a very subtle follicle tone. The jaw stubble SHADOW tone is the only facial-hair signal allowed, and it must be flat tone, not strands.',
    '',
    'LAYOUT GUIDE: Image 3 marks WHERE features sit, in the same coordinate space as the output. Eye openings must be CLOSED EYELID SKIN exactly as in image 2: a soft lid with lashline crease, never an opening, never dark, no eyeball, no iris, no whites, no gap. The curved marks above each eye indicate the brow ridge only: that area is bare skin at the SAME brightness as the forehead, with no brow, no hair, no darkening and no socket shadow. Lips fill the marked lip outline into both corners. Nostrils are small dark openings at the marked spots. Ears FILL their regions exactly as image 2 ears do. The marked jaw and neck boundaries indicate where the face blends into the neck: that blend must be seamless.',
    '',
    'FULL-FRAME COVERAGE (as important as the face): image 2 is skin from edge to edge, with the forehead continuing up into the scalp, the cheeks continuing outward, and the neck filling the bottom. Your output must do the same. Do NOT paint an oval face floating on a flat background. There must be no flat, featureless, uniform region anywhere: every part of the frame is skin, with the same soft tonal variation and the same colour continuation past every island edge that image 2 has.',
    '',
    'CRITICAL RULES:',
    '1. ALBEDO ONLY: zero lighting. No shadows, no highlights, no specular shine, no ambient occlusion. Perfectly flat even illumination exactly like image 2.',
    '2. Do not move, scale, rotate, or restyle any feature: positions come from images 2 and 3 only.',
    '3. Skin color must continue past every island edge (edge bleed) as in image 2. No black, white, or empty backgrounds anywhere in the frame.',
    '4. SKIN DETAIL, do not skip this: paint REAL skin, not retouched skin. Include fine visible pore structure across the whole face, subtle tonal variation between forehead, nose, cheeks, chin and neck, faint natural redness around the nostrils, ears and the inner corners of the eyes, and the mild unevenness every real face has. Portrait photos are usually smoothed and airbrushed; do NOT reproduce that smoothing. The base texture in image 2 shows the level of skin detail expected: match it or exceed it. Skin that reads as plastic, waxy, doll-like or like a smooth 3D render is a failure. Avoid deep wrinkles or heavy aged texture unless the person clearly has them. No text, no watermarks, no lines in the output.',
    '5. Nothing from the photo except skin: no glasses, no hair, no clothing, no background.',
    'Output: one square texture image.',
    '',
    'SKIN MARKS (highest priority, read twice): the skin in image 2 belongs to a DIFFERENT PERSON and is covered in small dark moles, freckles and blemishes across the cheeks, forehead, jaw and neck. Those marks are NOT part of the layout and must NOT be reproduced. Copy island positions and shapes from image 2; copy zero skin blemishes from it. Paint a mark ONLY where you can see that same mark on the person in image 1. If image 1 shows clear even skin, the output is clear even skin with no scattered dots anywhere. Inventing marks the person does not have is the single most damaging error you can make here, because it reads as dirt on their face.',
    '',
    'OUTPUT PURITY (highest priority): the finished texture must contain NO lines, NO dashes, NO outlines, NO arrows and NO text of any kind. Image 3 is a transparent measuring overlay, not content. Its strokes and its word labels exist only to tell you WHERE things sit and must be completely absent from your output. If any stroke or letter from image 3 appears in the result, the texture is unusable. Paint only skin.',
    '',
    'MOUTH GEOMETRY: this is an UNWRAP, not a photograph, so features are flattened and stretched compared to a real face. In image 2 the lips are a wide, flat, nearly lens-shaped patch with a STRAIGHT horizontal seam through the middle, because UV space splays the mouth open. Fill that same region at that same width. The line between the lips is straight, thin and flat in colour: no curve, no cupid bow, no corners turning up, no dark crease, no shadow and no volume shading anywhere on the lips. Copy the SHAPES in image 2, never the shapes a camera would see.',
  ].join('\n');

  // BASECOLOR STAYS ON GEMINI, cleanup stays on OpenAI.
  //
  // Measured across tonight's runs: gpt-image-2 paints better skin but drifts on
  // the reference layout, putting features off their marked positions and
  // shrinking the face within the frame. Gemini holds the layout, which matters
  // more here because this texture maps onto fixed geometry: a beautiful face in
  // the wrong place is unusable, a plainer face in the right place is not.
  //
  // The cleanup pass went the other way and is staying on OpenAI: that one is
  // an edit of a photograph with no layout to respect, and gpt-image-2 stopped
  // it inventing detail.
  const key = readKey(GEMINI_KEY_FILE, 'Gemini');
  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_BASECOLOR_MODEL,
      input: [
        { type: 'text', text: prompt },
        { type: 'text', text: 'Image 1 (identity source, the person photo):' },
        { type: 'image', mime_type: 'image/jpeg', data: Buffer.from(neutralizeWhiteBalance(photoBytes)).toString('base64') },
        { type: 'text', text: 'Image 2 (the EXACT UV layout to reproduce):' },
        { type: 'image', mime_type: 'image/jpeg', data: asJpeg(BASECOLOR_BASE) },
        { type: 'text', text: 'Image 3 (measuring overlay only; its lines and labels must NOT appear in the output):' },
        { type: 'image', mime_type: 'image/jpeg', data: asJpeg(BASECOLOR_GUIDE) },
      ],
      // Square is required: a basecolor maps onto a square UV layout, and the
      // field lives INSIDE response_format (top level is rejected outright).
      response_format: {
        type: 'image', mime_type: 'image/jpeg', image_size: '1K', aspect_ratio: '1:1',
      },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    console.error('[h3d] gemini basecolor HTTP', res.status, body);
    throw new Error(`gemini basecolor HTTP ${res.status}: ${body}`);
  }
  const json = await res.json() as {
    steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
  };
  let out: Uint8Array | null = null;
  for (const step of json.steps ?? []) {
    for (const c of step.content ?? []) {
      if (c.type === 'image' && c.data) { out = new Uint8Array(Buffer.from(c.data, 'base64')); break; }
    }
    if (out) break;
  }
  if (!out) throw new Error('gemini returned no basecolor image');
  progress(win, 'basecolor', `skin texture received (${Math.round(out.length / 1024)} KB)`);
  return out;
}

// The photo-read colour vocabulary. These two tables were referenced but
// never defined (found 2026-08-16 by the first-ever tsc pass over
// electron/): at runtime the lookups threw ReferenceError inside the
// grooming try/catch, which silently discarded the ENTIRE groom pick —
// gender, build and hair index included — so every custom character built
// with default grooming while the pipeline reported success.
//
// Values are grounded in the app's own curated presets
// (src/components/CustomizationOverlay.tsx HAIR_COLORS): melanin 0=white
// to ~0.97 jet, redness = pheomelanin ratio (0 ash to ~0.72 ginger).
type HairColorName =
  | 'black' | 'darkBrown' | 'brown' | 'lightBrown' | 'dirtyBlonde'
  | 'blonde' | 'platinum' | 'auburn' | 'ginger' | 'grey' | 'white';
const HAIR_COLOR_PARAMS: Record<HairColorName, { melanin: number; redness: number }> = {
  black:       { melanin: 0.97, redness: 0.10 },  // preset: Jet
  darkBrown:   { melanin: 0.84, redness: 0.22 },  // Espresso
  brown:       { melanin: 0.70, redness: 0.32 },  // Chestnut
  lightBrown:  { melanin: 0.56, redness: 0.40 },  // Caramel
  dirtyBlonde: { melanin: 0.44, redness: 0.34 },  // Honey
  blonde:      { melanin: 0.36, redness: 0.26 },  // Wheat
  platinum:    { melanin: 0.18, redness: 0.10 },  // Platinum
  auburn:      { melanin: 0.62, redness: 0.55 },  // Auburn
  ginger:      { melanin: 0.50, redness: 0.72 },  // Ginger
  grey:        { melanin: 0.28, redness: 0.02 },  // between Ash and Silver
  white:       { melanin: 0.10, redness: 0.00 },  // lighter than Silver
};

// The iris is a texture swap (T_IrisBC_<suffix>, see EYE_COLORS in
// CustomizationOverlay.tsx) and the photo-read enum was designed to match
// the shipped suffixes 1:1, so this mapping is the identity — kept as an
// explicit table so a rename on either side fails loudly here instead of
// silently skipping the eye colour.
type EyeColorName =
  | 'darkBrown' | 'brown' | 'amber' | 'hazel' | 'green' | 'blue' | 'grey';
const EYE_COLOR_IRIS: Record<EyeColorName, string> = {
  darkBrown: 'darkBrown',
  brown: 'brown',
  amber: 'amber',
  hazel: 'hazel',
  green: 'green',
  blue: 'blue',
  grey: 'grey',
};

export interface GroomPick {
  gender: 'm' | 'f';
  /** Read from the photo; mapped to material values by HAIR_COLOR_PARAMS. */
  hairColor?: HairColorName;
  /** Read from the photo; mapped to an iris variant by EYE_COLOR_IRIS. */
  eyeColor?: EyeColorName;
  /** Resolved here rather than in the renderer, because the lookup tables live
   *  in the main process and the renderer cannot import from electron/. */
  hairColorParams?: { melanin: number; redness: number };
  irisVariant?: string;
  /** Body read, mapped to the unified `musc`/`fat` slider axes. */
  build: 'skinny' | 'fit' | 'fat';
  hairIndex: number;
  browIndex: number;
  lashIndex: number;
}

/** Body build -> setBlendsUnified axes. Deliberately gentle: a wrong guess on a
 *  stranger's body should read as "close enough", not as a caricature. */
export function buildToAxes(build: GroomPick['build']): Record<string, number> {
  switch (build) {
    case 'skinny': return { fat: -0.55, musc: -0.25 };
    case 'fat':    return { fat: 0.70, musc: -0.10 };
    case 'fit':
    default:       return { fat: -0.20, musc: 0.55 };
  }
}

export interface GroomOption { index: number; name: string }

/**
 * Pick hair/brow/lash presets from the ORIGINAL photo (hair intact, obviously).
 * Same job the OpenAI vision call did; moved to Gemini for cost. Best-effort:
 * any failure returns undefined and the authored defaults stand.
 */
export async function geminiPickGrooming(
  win: BrowserWindow | null,
  photoBytes: Uint8Array,
  mime: 'image/jpeg' | 'image/png',
  catalogs: { hairs: GroomOption[]; brows: GroomOption[]; lashes: GroomOption[] },
): Promise<GroomPick | undefined> {
  try {
    const key = readKey(GEMINI_KEY_FILE, 'Gemini');
    progress(win, 'groom', `reading grooming + build with ${GEMINI_TEXT_MODEL}`);
    const list = (o: GroomOption[]) => o.map((x) => `${x.index}: ${x.name}`).join('; ');

    const prompt = [
      "Look at this photo of a person and answer with the closest matches from fixed catalogs.",
      "gender: their gender presentation.",
      "build: their body build. skinny = slight/narrow, fit = average or athletic, fat = heavier/rounder.",
      "  Judge from face, neck and shoulders; if unsure, answer fit.",
      "hairIndex: closest hairstyle by length, texture (straight/wavy/curly/coily) and style.",
      "browIndex: closest eyebrows by thickness and shape.",
      "lashIndex: closest eyelashes by length and density.",
      "hairColor: their natural hair colour, closest name from the list. Judge the roots and",
      "  the bulk of the hair, not highlights or dye. If the hair is dyed an unnatural colour,",
      "  answer with the closest natural shade instead.",
      "eyeColor: their iris colour, closest name from the list. Look at the iris only, not the",
      "  eyelid or lashes. If the eyes are not clearly visible, answer brown.",
      `HAIRSTYLES: ${list(catalogs.hairs)}`,
      `EYEBROWS: ${list(catalogs.brows)}`,
      `EYELASHES: ${list(catalogs.lashes)}`,
      "Use only indices that appear in these lists.",
    ].join('\n');

    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_TEXT_MODEL,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', mime_type: mime, data: Buffer.from(photoBytes).toString('base64') },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['gender', 'build', 'hairIndex', 'browIndex', 'lashIndex', 'hairColor', 'eyeColor'],
            properties: {
              gender: { type: 'string', enum: ['m', 'f'] },
              build: { type: 'string', enum: ['skinny', 'fit', 'fat'] },
              hairColor: { type: 'string', enum: [
                'black', 'darkBrown', 'brown', 'lightBrown', 'dirtyBlonde',
                'blonde', 'platinum', 'auburn', 'ginger', 'grey', 'white'] },
              eyeColor: { type: 'string', enum: [
                'darkBrown', 'brown', 'amber', 'hazel', 'green', 'blue', 'grey'] },
              hairIndex: { type: 'integer' },
              browIndex: { type: 'integer' },
              lashIndex: { type: 'integer' },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error('[h3d] grooming HTTP', res.status, body);
      progress(win, 'findings', JSON.stringify({ error: `photo read failed (HTTP ${res.status})` }));
      progress(win, 'groom', `grooming pick failed: HTTP ${res.status} ${body}`);
      return undefined;
    }
    // Verified against the live API: there is NO top-level `output_text`. The
    // reply is steps[], where step 0 is `type: "thought"` carrying only a
    // signature (no content array at all), and the answer lands in the
    // `model_output` step as content[].text. Kept the output_text read as a
    // forward-compatible first choice.
    const json = await res.json() as {
      output_text?: string;
      steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
    };
    let text = json.output_text ?? '';
    if (!text) {
      for (const step of json.steps ?? []) {
        for (const c of step.content ?? []) if (c.type === 'text' && c.text) text += c.text;
      }
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error('[h3d] grooming returned no JSON, raw:', text.slice(0, 300));
      progress(win, 'findings', JSON.stringify({ error: 'photo read returned no answer' }));
      progress(win, 'groom', 'grooming pick returned no JSON');
      return undefined;
    }
    const p = JSON.parse(m[0]) as GroomPick;
    if (p.gender !== 'm' && p.gender !== 'f') return undefined;
    // Resolve the colour NAMES the model chose into the numbers the materials
    // want. An unknown name simply resolves to nothing and the character keeps
    // its authored colour, which is a much better failure than a wrong one.
    if (p.hairColor && HAIR_COLOR_PARAMS[p.hairColor]) {
      p.hairColorParams = HAIR_COLOR_PARAMS[p.hairColor];
    }
    if (p.eyeColor && EYE_COLOR_IRIS[p.eyeColor]) {
      p.irisVariant = EYE_COLOR_IRIS[p.eyeColor];
    }
    // Surface the read itself, not just "done". The UI reveals these as they
    // land, which is the only visible evidence during a long build that we are
    // actually looking at THEIR photo rather than running a generic job.
    // Sent as a JSON line on its own stage so the progress bar ignores it.
    try {
      const label = (v?: string) => (v ? v.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : undefined);
      progress(win, 'findings', JSON.stringify({
        gender: p.gender === 'f' ? 'feminine' : 'masculine',
        build: p.build,
        hairColor: label(p.hairColor),
        eyeColor: label(p.eyeColor),
        hair: catalogs.hairs.find((h) => h.index === p.hairIndex)?.name,
      }));
    } catch { /* findings are decorative; never fail the pick over them */ }
    progress(win, 'groom',
      `${p.gender}/${p.build}: hair ${p.hairIndex}, brow ${p.browIndex}, lash ${p.lashIndex}`);
    return p;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[h3d] grooming threw:', msg);
    progress(win, 'findings', JSON.stringify({ error: `photo read failed (${msg})` }));
    progress(win, 'groom', `grooming pick failed: ${msg}`);
    return undefined;
  }
}

/**
 * Clean portrait -> textured GLB. Submits to Rodin, polls, downloads.
 *
 * `geometry_instruct_mode: faithful` matters more than anything else here: the
 * default is "creative", which invents plausible detail. For a likeness that is
 * exactly wrong.
 */
export async function rodinGenerateBust(
  win: BrowserWindow | null,
  imageBytes: Uint8Array,
  outDir: string,
  filename = 'bust.glb',
): Promise<string> {
  const key = readKey(HYPER3D_KEY_FILE, 'Hyper3D');
  fs.mkdirSync(outDir, { recursive: true });

  const form = new FormData();
  form.append('images', new Blob([new Uint8Array(imageBytes)], { type: 'image/jpeg' }), 'portrait.jpg');
  form.append('tier', RODIN_TIER);                    // required, no default. High = 0.5 credit
  form.append('geometry_file_format', 'glb');        // the normalizer reads GLB
  form.append('quality', 'high');                    // NOT default (medium): the
  // conform wants a dense surface, and this is what every good run so far used.
  // EVERYTHING ELSE LEFT AT THE API DEFAULT, deliberately.
  //
  // Checked against the Gen-2.5 spec 2026-08-09 rather than assumed:
  //   geometry_instruct_mode  defaults to `creative` (we were forcing `faithful`)
  //   mesh_mode               defaults to `Raw`, which is what the conform wants
  //   quality                 defaults to `medium`, overridden to `high` above
  //   prompt                  optional for image-to-3D; omitted so the geometry
  //                           comes from the pixels rather than from text
  //
  // Two options worth knowing about and NOT set here:
  //   is_micro   micro detail scale, but ONLY on Gen-2.5-Extreme-High, which is
  //              1.0 credit against High's 0.5. Double the cost per character.
  //   symmetry   does not exist. There is no symmetry parameter in the API.

progress(win, 'rodin', `submitting to Rodin ${RODIN_TIER}`);
  const sub = await fetch(`${RODIN_BASE}/rodin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!sub.ok) {
    throw new Error(`rodin submit HTTP ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  }
  const subJson = await sub.json() as {
    error?: string | null; uuid?: string;
    jobs?: { subscription_key?: string };
  };
  if (subJson.error) throw new Error(`rodin submit error: ${subJson.error}`);
  const taskUuid = subJson.uuid;
  const subKey = subJson.jobs?.subscription_key;
  if (!taskUuid || !subKey) throw new Error('rodin submit returned no uuid/subscription_key');
  progress(win, 'rodin', `task ${taskUuid.slice(0, 8)} queued`);

  // Poll. Status is per-job; the task is done when none are still running.
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('rodin timed out after 15 min');
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`${RODIN_BASE}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_key: subKey }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!st.ok) continue; // transient
    const stJson = await st.json() as { jobs?: { uuid?: string; status?: string }[] };
    const statuses = (stJson.jobs ?? []).map((j) => j.status ?? '');
    if (statuses.some((s) => s === 'Failed')) throw new Error('rodin job Failed');
    if (statuses.length > 0 && statuses.every((s) => s === 'Done')) break;
    progress(win, 'rodin', `generating (${statuses.join(',') || 'queued'})`);
  }

  progress(win, 'rodin', 'downloading GLB');
  const dl = await fetch(`${RODIN_BASE}/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_uuid: taskUuid }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!dl.ok) throw new Error(`rodin download HTTP ${dl.status}`);
  const dlJson = await dl.json() as { error?: string; list?: { url?: string; name?: string }[] };
  if (dlJson.error) throw new Error(`rodin download error: ${dlJson.error}`);
  const glb = (dlJson.list ?? []).find((f) => (f.name ?? '').toLowerCase().endsWith('.glb'));
  if (!glb?.url) {
    throw new Error(`rodin returned no .glb (got: ${(dlJson.list ?? []).map((f) => f.name).join(', ')})`);
  }

  const bin = await fetch(glb.url, { signal: AbortSignal.timeout(300_000) });
  if (!bin.ok) throw new Error(`glb fetch HTTP ${bin.status}`);
  const out = path.join(outDir, filename);
  fs.writeFileSync(out, Buffer.from(await bin.arrayBuffer()));
  progress(win, 'rodin', `bust saved (${Math.round(fs.statSync(out).size / 1024 / 1024)} MB)`);
  return out;
}

// ---- local chain: GLB -> .dna + .ujnt ---------------------------------------
// Same DEV-only posture as identityInference.ts: absolute paths, this Mac only.
// The packaged app will pull finished artifacts from the cloud instead.

const P1 = '/Users/foton/Documents/Unclaw-Mac/modal-mh/p1';
const P1_PY = `${P1}/venv/bin/python`;
const NORMALIZE = `${P1}/h3d_normalize.py`;
const TRACKSHOT = `${P1}/h3d_trackshot.py`;
const UE_CMD = '/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor-Cmd';
const WORKER_UPROJECT =
  '/Users/foton/Documents/Unreal Projects/UnclawCharWorker/UnclawCharWorker.uproject';
const BUST_TO_DNA =
  '/Users/foton/Documents/Unreal Projects/UnclawCharWorker/Scripts/run_bust_to_dna.py';

function runProc(
  win: BrowserWindow | null, stage: string, cmd: string, args: string[],
  env: NodeJS.ProcessEnv, timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    progress(win, stage, `$ ${path.basename(cmd)} ${args.join(' ').slice(0, 160)}`);
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
      reject(new Error(`${stage} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const feed = (b: Buffer) => {
      for (const l of b.toString().split('\n')) {
        const t = l.trim();
        if (t) progress(win, stage, t.slice(0, 300));
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(); return; }
      // h3d_normalize exits 2 when it cannot find a face and 3 when the QC gates
      // fail. Both mean "this photo will not produce a good head", which is a
      // retake, not a crash.
      if (stage === 'normalize' && (code === 2 || code === 3)) {
        reject(new Error('RETAKE: that photo did not give a usable head (face not clear enough).'));
        return;
      }
      reject(new Error(`${stage} exited with code ${code}`));
    });
  });
}


/** Shared, identity-independent tables the runtime apply needs. */
const RUNTIME_DATA = '/Users/foton/Documents/Unreal Projects/AudioTestProject02_58/RuntimeData';

/**
 * Copy everything the UE app must read into its OWN sandbox container.
 *
 * This is not optional and it is easy to miss: the shipped UE app is sandboxed,
 * so it cannot open anything under the Electron app's userData no matter how
 * correct the path string looks. The descriptor would carry a valid-looking
 * absolute path and the apply would simply fail.
 *
 * base_face.udvt goes NEXT TO the .dna on purpose, because
 * ResolveIdentityTablePath checks the .dna's own directory first, and the
 * packaged app has no RuntimeData of its own to fall back on. The garment
 * tables ride along for the same reason.
 */
function stageForUE(
  localId: string,
  files: { dna: string; ujnt?: string; basecolor?: string; normal?: string },
): {
  dnaPath: string; jointsPath?: string; tablePath?: string;
  baseColorPath?: string; normalPath?: string;
} {
  const dir = path.join(ueContainerSavedDir(), 'Identity', localId);
  fs.mkdirSync(dir, { recursive: true });

  const dnaPath = path.join(dir, path.basename(files.dna));
  fs.copyFileSync(files.dna, dnaPath);

  let jointsPath: string | undefined;
  if (files.ujnt && fs.existsSync(files.ujnt)) {
    jointsPath = path.join(dir, path.basename(files.ujnt));
    fs.copyFileSync(files.ujnt, jointsPath);
  }

  let tablePath: string | undefined;
  const srcTable = path.join(RUNTIME_DATA, 'base_face.udvt');
  if (fs.existsSync(srcTable)) {
    tablePath = path.join(dir, 'base_face.udvt');
    fs.copyFileSync(srcTable, tablePath);
  }

  const srcGarments = path.join(RUNTIME_DATA, 'garments');
  if (fs.existsSync(srcGarments)) {
    const dstGarments = path.join(dir, 'garments');
    fs.mkdirSync(dstGarments, { recursive: true });
    for (const f of fs.readdirSync(srcGarments)) {
      if (f.endsWith('.ugtt')) fs.copyFileSync(path.join(srcGarments, f), path.join(dstGarments, f));
    }
  }
  let baseColorPath: string | undefined;
  if (files.basecolor && fs.existsSync(files.basecolor)) {
    baseColorPath = path.join(dir, path.basename(files.basecolor));
    fs.copyFileSync(files.basecolor, baseColorPath);
  }
  // The skin-detail normal, staged the same way for the same reason: sandboxed
  // UE cannot read userData, so the bytes have to live beside the .dna.
  let normalPath: string | undefined;
  if (files.normal && fs.existsSync(files.normal)) {
    normalPath = path.join(dir, path.basename(files.normal));
    fs.copyFileSync(files.normal, normalPath);
  }
  return { dnaPath, jointsPath, tablePath, baseColorPath, normalPath };
}

export interface H3DResult {
  ok: boolean;
  dnaPath?: string;
  jointsPath?: string;
  bustPath?: string;
  tablePath?: string;
  cleanImagePath?: string;
  /** Generated skin basecolor, staged into the UE container. Absent when the
   *  generation failed: it is best-effort, and the authored skin is a fine
   *  fallback, so it must never fail the whole character. */
  baseColorPath?: string;
  /** MetaHuman Creator's own skin-detail normal, staged next to the basecolor.
   *  Absent when the texture step did not run; the face then keeps the shipped
   *  base normal. */
  normalPath?: string;
  grooming?: GroomPick;
  error?: string;
}

/**
 * The whole H3D tier: photo in, shippable character out.
 *
 *   gemini hair removal -> Rodin bust -> normalize -> track shot
 *   -> headless UE (conform + neutral pin + autorig + export)
 *
 * The grooming/build read runs concurrently against the ORIGINAL photo, since
 * it needs the hair the first step deletes.
 */
export async function runH3DPhotoToCharacter(
  win: BrowserWindow | null,
  opts: {
    localId: string;
    photoBytes: Uint8Array;
    ext: 'jpg' | 'png';
    workDir: string;
    catalogs?: { hairs: GroomOption[]; brows: GroomOption[]; lashes: GroomOption[] };
  },
): Promise<H3DResult> {
  const { localId, photoBytes, ext, workDir, catalogs } = opts;
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  try {
    for (const p of [P1_PY, NORMALIZE, TRACKSHOT, UE_CMD, WORKER_UPROJECT, BUST_TO_DNA]) {
      if (!fs.existsSync(p)) return { ok: false, error: `missing tool: ${p}` };
    }
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, `original.${ext}`), Buffer.from(photoBytes));

    // Grooming reads the ORIGINAL (hair intact); runs alongside the slow path.
    //
    // The outcome is written to groom.json because a failure here is otherwise
    // completely invisible: every path inside geminiPickGrooming swallows its
    // error and returns undefined, and friendlyStage maps the 'groom' stage to
    // null on purpose so the parallel read cannot steal the main status label.
    // The result is a character that quietly spawns with no hair and no colour
    // and nothing anywhere saying why. The file records whether catalogs even
    // arrived, which separates "the renderer sent nothing" from "the model call
    // failed".
    const groomPromise = (catalogs
      ? geminiPickGrooming(win, photoBytes, mime as 'image/jpeg' | 'image/png', catalogs)
      : Promise.resolve(undefined)
    ).then((pick) => {
      try {
        fs.writeFileSync(path.join(workDir, 'groom.json'), JSON.stringify({
          ok: !!pick,
          catalogs: catalogs
            ? { hairs: catalogs.hairs.length, brows: catalogs.brows.length, lashes: catalogs.lashes.length }
            : null,
          pick: pick ?? null,
        }, null, 2));
      } catch { /* diagnostics must never cost a character */ }
      return pick;
    });

    const cleanBytes = await geminiRemoveHair(win, photoBytes, mime as 'image/jpeg' | 'image/png', aspectOf(photoBytes));
    const cleanPath = path.join(workDir, 'clean.jpg');
    fs.writeFileSync(cleanPath, Buffer.from(cleanBytes));

    // Basecolor reads the CLEANED photo, not the original. The original still
    // carries beard, brows and lashes, and any of it that survives into the
    // texture fights the 3D grooms layered on top. The old comment here claimed
    // the clean pass shifts skin tone; measured on two characters it moves the
    // face median by 2-3 L, which is nothing, so that concern does not hold.
    //
    // Still concurrent with Rodin, which is the long pole, so moving it after
    // the cleanup costs no wall-clock. Swallows its own failure so a texture
    // problem never costs the user a character.
    const basecolorPromise = geminiGenerateBasecolor(win, cleanBytes, 'image/jpeg')
      .then((bytes) => {
        const p = path.join(workDir, 'basecolor.jpg');
        fs.writeFileSync(p, Buffer.from(bytes));
        return p;
      })
      .catch((e) => {
        progress(win, 'basecolor', `skipped: ${e instanceof Error ? e.message : e}`);
        return undefined;
      });

    const bust = await rodinGenerateBust(win, cleanBytes, workDir, 'bust.glb');

    // Normalize: canonical orientation + scale, and the bust cut. QC gates here
    // are the earliest honest place to reject a bad photo.
    const normDir = path.join(workDir, 'norm');
    await runProc(win, 'normalize', P1_PY, [NORMALIZE, bust, '--out', normDir],
      process.env, 10 * 60 * 1000);
    const normBust = path.join(normDir, 'normalized_bust.glb');
    if (!fs.existsSync(normBust)) return { ok: false, error: 'normalize produced no normalized_bust.glb' };

    // Track shot: the rendered view + camera the in-UE landmark tracker solves against.
    const shotDir = path.join(workDir, 'shot');
    await runProc(win, 'trackshot', P1_PY, [TRACKSHOT, normBust, shotDir],
      process.env, 10 * 60 * 1000);
    if (!fs.existsSync(path.join(shotDir, 'camera.json'))) {
      return { ok: false, error: 'trackshot produced no camera.json' };
    }

    // Headless UE: conform (auto-solve) -> pin 30 constraints to neutral ->
    // autorig JOINTS_ONLY -> export .dna + .ujnt. One boot.
    const name = 'C' + localId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    await runProc(win, 'identity', UE_CMD,
      [WORKER_UPROJECT, `-ExecCmds=py ${BUST_TO_DNA}`, '-unattended', '-nosplash', '-RenderOffScreen'],
      { ...process.env, UC_GLB: normBust, UC_SHOT: shotDir, UC_NAME: name, UC_OUT: workDir, UC_QUIT: '1' },
      30 * 60 * 1000);

    let dnaPath = '', jointsPath = '';
    try {
      const r = JSON.parse(fs.readFileSync(path.join(workDir, 'bust_to_dna_result.json'), 'utf8'));
      dnaPath = r.dnaPath ?? '';
      jointsPath = r.jointsPath ?? '';
      if (!dnaPath) {
        const failed = (r.steps ?? []).filter((s: { ok: boolean }) => !s.ok)
          .map((s: { step: string }) => s.step).join(',');
        return { ok: false, error: `UE job produced no .dna (failed: ${failed || 'unknown'})` };
      }
    } catch (e) {
      return { ok: false, error: `UE job wrote no result json: ${e instanceof Error ? e.message : e}` };
    }

    // Sandboxed UE cannot read userData; stage into its container and hand back
    // the CONTAINER paths, not the ones the pipeline wrote.
    // MetaHuman Creator bakes its own skin-detail normal during the headless job
    // and run_bust_to_dna.py writes it out here. Optional by design: the step is
    // failure-isolated over there, and without it the face simply keeps the
    // shipped base normal, which is what every character used before this.
    // `T_Face_Normal`, not `T_Head_LOD1_N_VT`: RequestTextureSources downloads
    // the SOURCE texture set, and ExportMaterials writes those, not the baked
    // per-LOD maps. Guessing the baked name meant the file never matched and the
    // injection skipped in silence.
    const mhcNormal = path.join(workDir, 'mhc_textures', 'T_Face_Normal.png');
    const staged = stageForUE(localId, {
      dna: dnaPath, ujnt: jointsPath, basecolor: await basecolorPromise,
      normal: fs.existsSync(mhcNormal) ? mhcNormal : undefined,
    });
    progress(win, 'done', `character ready: ${path.basename(staged.dnaPath)}`);
    return {
      ok: true,
      dnaPath: staged.dnaPath,
      jointsPath: staged.jointsPath,
      tablePath: staged.tablePath,
      bustPath: bust, cleanImagePath: cleanPath,
      baseColorPath: staged.baseColorPath,
      normalPath: staged.normalPath,
      grooming: await groomPromise,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Log the RAW failure in main. The renderer only shows a friendly line, and
    // a Gemini refusal, a 429 and a network drop all collapse to the same
    // sentence there, which makes them indistinguishable without this.
    console.error('[h3d] pipeline failed:', msg);
    progress(win, 'error', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Regenerate ONLY the skin texture for a character that already exists.
 *
 * The basecolor is the one stage worth iterating on: the geometry, the rig and
 * the garment tables are settled after the first run, but the texture is a
 * generative result that may want another roll of the dice or a prompt change.
 * Re-running the whole chain to get one costs a Rodin credit, several minutes
 * and a headless UE boot, for a stage that takes seconds.
 *
 * Reads the ORIGINAL photo already stored with the character, so nothing has to
 * be re-uploaded and the result is comparable with what came before.
 */
export interface SkinOption { path: string; label: string }

/** Every basecolor generated for this character, oldest first. The first is the
 *  one the original chain produced; later ones are re-rolls. Nothing is ever
 *  overwritten: a generative result the user liked should not be destroyed by
 *  the next attempt, and comparing attempts is the whole point of re-rolling. */
export function listBasecolors(localId: string, workDir: string): SkinOption[] {
  const dir = path.join(ueContainerSavedDir(), 'Identity', localId);
  const out: SkinOption[] = [];
  const push = (file: string, label: string) => {
    const staged = path.join(dir, file);
    if (fs.existsSync(staged)) out.push({ path: staged, label });
  };
  push('basecolor.jpg', 'Skin 1');
  let n = 2;
  for (;;) {
    const f = `basecolor_${n}.jpg`;
    if (!fs.existsSync(path.join(dir, f))) break;
    push(f, `Skin ${n}`);
    n += 1;
  }
  void workDir;
  return out;
}

/**
 * Generate ANOTHER skin texture for a character that already exists.
 *
 * The basecolor is the one stage worth iterating on: geometry, rig and garment
 * tables are settled after the first run, but the texture is a generative
 * result that may want another roll or a prompt change. Re-running the whole
 * chain costs a 3D credit, several minutes and a headless engine boot, for a
 * stage that takes seconds.
 *
 * Additive by design. Each attempt lands beside the last as basecolor_N.jpg so
 * the user can go back to one they preferred; a re-roll that destroyed the
 * previous result would make trying again feel risky.
 */
export async function regenerateBasecolor(
  win: BrowserWindow | null,
  localId: string,
  workDir: string,
): Promise<{ ok: boolean; baseColorPath?: string; skins?: SkinOption[]; error?: string }> {
  try {
    const original = ['jpg', 'jpeg', 'png']
      .map((e) => path.join(workDir, `original.${e}`))
      .find((f) => fs.existsSync(f));
    if (!original) return { ok: false, error: 'no original photo stored for this character' };

    const bytes = new Uint8Array(fs.readFileSync(original));
    const out = await geminiGenerateBasecolor(win, bytes, 'image/jpeg');

    const dir = path.join(ueContainerSavedDir(), 'Identity', localId);
    fs.mkdirSync(dir, { recursive: true });

    // Next free slot, so nothing is ever clobbered.
    let n = 2;
    while (fs.existsSync(path.join(dir, `basecolor_${n}.jpg`))) n += 1;
    const name = fs.existsSync(path.join(dir, 'basecolor.jpg')) ? `basecolor_${n}.jpg` : 'basecolor.jpg';

    fs.writeFileSync(path.join(workDir, name), Buffer.from(out));
    const staged = path.join(dir, name);
    fs.copyFileSync(path.join(workDir, name), staged);

    progress(win, 'basecolor', 'new skin ready');
    return { ok: true, baseColorPath: staged, skins: listBasecolors(localId, workDir) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[h3d] basecolor regen failed:', msg);
    return { ok: false, error: msg };
  }
}
