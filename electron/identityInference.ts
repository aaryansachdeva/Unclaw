// Local photo->identity inference (DEV, Mac-only). Runs the same two-stage
// chain the cloud worker will run, on this machine:
//   1. iphone_take.py       capture.zip (UnclawScan depth set) -> fabricated take
//   2. run_identity_job.py  take -> conform -> autorig -> build -> identity.dna
//                           + identity.ulmb (headless UE, UnclawCharWorker project)
// then stages the artifacts into the sandboxed UE container (like pak staging:
// sandboxed UE can only read inside its own container) and returns the
// container-side paths for the applyIdentity descriptor.
//
// DEV-ONLY paths by design: this runner exists so the full loop can be tested
// locally before the Modal port; the packaged app will download artifacts from
// the cloud instead of producing them.

import { BrowserWindow, app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const UE_CMD = '/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor-Cmd';
const WORKER_UPROJECT = '/Users/foton/Documents/Unreal Projects/UnclawCharWorker/UnclawCharWorker.uproject';
const JOB_SCRIPT = '/Users/foton/Documents/Unreal Projects/UnclawCharWorker/Scripts/run_identity_job.py';
/** Shared, identity-independent vertex table for the DNA-native apply path.
 *  DEV path like the rest of this file; the packaged app ships it via
 *  runtimeAssets instead of producing it. */
const FACE_TABLE_SRC =
  '/Users/foton/Documents/Unreal Projects/AudioTestProject02_58/RuntimeData/base_face.udvt';
const P1_DIR = '/Users/foton/Documents/Unclaw-Mac/modal-mh/p1';
const TAKE_SCRIPT = `${P1_DIR}/iphone_take.py`;
const TAKE_PYTHON = `${P1_DIR}/venv/bin/python`;
const SAPIENS_PYTHON = `${P1_DIR}/venv-sapiens/bin/python`;

export interface GroomOption { index: number; name: string }

export interface GroomArgs {
  photoBytes: Uint8Array;   // upright JPEG of the user
  hairs: GroomOption[];
  brows: GroomOption[];
  lashes: GroomOption[];
}

// The PIPELINE's OpenAI credential (same account as the gen-basecolor calls),
// not the user's BYOK chat key. Lives outside any git repo, chmod 600.
const OPENAI_KEY_FILE = `${P1_DIR}/secrets/openai_key.txt`;
// Solid image-assessment model at reasonable cost; bump when the family moves.
const GROOM_MODEL = 'gpt-5';

export interface GroomPick {
  gender: 'm' | 'f';
  hairIndex: number;
  browIndex: number;
  lashIndex: number;
}

export interface IdentityInferenceResult {
  ok: boolean;
  dnaPath?: string;
  blobPath?: string;
  baseColorPath?: string;
  /** UJNT joint sidecar (eye/jaw bind placement) for the DNA-native path. */
  jointsPath?: string;
  /** base_face.udvt, staged beside the .dna. */
  tablePath?: string;
  /** Vision-picked default grooming (hair/brow/lash catalog indices). */
  grooming?: GroomPick;
  error?: string;
}

function progress(win: BrowserWindow | null, stage: string, line: string) {
  try {
    win?.webContents.send('identity:progress', { stage, line });
  } catch { /* window gone */ }
}

function run(win: BrowserWindow | null, stage: string, cmd: string, args: string[],
             env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    progress(win, stage, `$ ${path.basename(cmd)} ${args.join(' ').slice(0, 200)}`);
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
      reject(new Error(`${stage} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const feed = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) {
        const t = line.trim();
        if (t) progress(win, stage, t.slice(0, 300));
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${stage} exited with code ${code}`));
    });
  });
}

/** Vision grooming pick: show the user's photo to the configured OpenAI model
 *  with the wardrobe catalogs and get structured hair/brow/lash choices, so a
 *  fresh character spawns with grooming that resembles the photo. Best-effort:
 *  any failure returns undefined and the authored defaults stand. */
async function pickGrooming(win: BrowserWindow | null, g: GroomArgs): Promise<GroomPick | undefined> {
  try {
    let apiKey = '';
    try {
      apiKey = fs.readFileSync(OPENAI_KEY_FILE, 'utf8').trim();
    } catch { /* no key file */ }
    if (!apiKey) {
      progress(win, 'groom', 'no pipeline OpenAI key, skipping grooming match');
      return undefined;
    }
    progress(win, 'groom', `asking ${GROOM_MODEL} to match hair/brows/lashes`);
    const list = (opts: GroomOption[]) => opts.map((o) => `${o.index}: ${o.name}`).join('; ');
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['gender', 'hairIndex', 'browIndex', 'lashIndex'],
      properties: {
        gender: { type: 'string', enum: ['m', 'f'], description: 'the person\'s gender presentation' },
        hairIndex: { type: 'integer', description: 'index of the closest hairstyle' },
        browIndex: { type: 'integer', description: 'index of the closest eyebrow style' },
        lashIndex: { type: 'integer', description: 'index of the closest eyelash style' },
      },
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROOM_MODEL,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'grooming_pick', strict: true, schema },
        },
        messages: [
          {
            role: 'system',
            content:
              'You match a person\'s photo to the closest grooming presets from fixed catalogs. ' +
              'FIRST determine the person\'s gender presentation (m or f). ' +
              'THEN pick the hairstyle: it MUST be tagged for that gender or (unisex); ' +
              'judge by length, texture (straight/wavy/curly/coily), and style. ' +
              'Eyebrows: judge thickness and shape. ' +
              'Eyelashes: judge length and density; males typically read shorter/finer, ' +
              'females typically longer/fuller -- but trust what the photo shows. ' +
              'Always answer with catalog indices from the provided lists only.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `HAIRSTYLES: ${list(g.hairs)}\n` +
                  `EYEBROWS: ${list(g.brows)}\n` +
                  `EYELASHES: ${list(g.lashes)}\n` +
                  'The character is MALE; the hairstyle list is already limited to male-appropriate styles. ' +
                  'Pick the closest match of each for the person in this photo.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${Buffer.from(g.photoBytes).toString('base64')}` },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      progress(win, 'groom', `vision pick failed: HTTP ${res.status}`);
      return undefined;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const pick = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as Partial<GroomPick>;
    const clamp = (v: unknown, max: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max - 1, Math.floor(v))) : 0;
    const out = {
      gender: (pick.gender === 'f' ? 'f' : 'm') as 'm' | 'f',
      hairIndex: clamp(pick.hairIndex, g.hairs.length),
      browIndex: clamp(pick.browIndex, g.brows.length),
      lashIndex: clamp(pick.lashIndex, g.lashes.length),
    };
    progress(win, 'groom',
      `picked gender=${out.gender} hair=${g.hairs.find((h) => h.index === out.hairIndex)?.name} ` +
      `brows=${g.brows[out.browIndex]?.name} lashes=${g.lashes[out.lashIndex]?.name}`);
    return out;
  } catch (err) {
    progress(win, 'groom', `vision pick failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** The sandboxed UE container's Saved dir (macOS dev + packaged both use it). */
export function ueContainerSavedDir(): string {
  return path.join(
    app.getPath('home'),
    'Library/Containers/com.YourCompany.AudioTestProject02/Data/Library',
    'Application Support/Epic/AudioTestProject02/Saved',
  );
}

export async function runLocalIdentityInference(
  win: BrowserWindow | null,
  sessionId: string,
  zipBytes: Uint8Array,
  groom?: GroomArgs,
): Promise<IdentityInferenceResult> {
  try {
    if (!/^cs_[a-f0-9]{32}$/.test(sessionId)) return { ok: false, error: 'bad_session_id' };
    if (process.platform !== 'darwin') return { ok: false, error: 'local inference is mac-dev only' };
    for (const p of [UE_CMD, WORKER_UPROJECT, JOB_SCRIPT, TAKE_SCRIPT, TAKE_PYTHON]) {
      if (!fs.existsSync(p)) return { ok: false, error: `missing tool: ${p}` };
    }

    const workDir = path.join(app.getPath('userData'), 'identities', sessionId);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const zipPath = path.join(workDir, 'capture.zip');
    fs.writeFileSync(zipPath, Buffer.from(zipBytes));
    progress(win, 'prep', `capture.zip staged (${zipBytes.length} bytes)`);

    // 1. Fabricate the take from the depth-set bundle.
    const takeDir = path.join(workDir, 'take');
    await run(win, 'take', TAKE_PYTHON, [TAKE_SCRIPT, zipPath, '--out', takeDir],
      process.env, 5 * 60 * 1000);
    if (!fs.existsSync(path.join(takeDir, 'calib.mhaical'))) {
      return { ok: false, error: 'take fabrication produced no calib.mhaical' };
    }

    // Grooming pick runs concurrently with the (much longer) UE job.
    const groomPromise = groom ? pickGrooming(win, groom) : Promise.resolve(undefined);
    const result = await runUEJobAndStage(win, workDir, takeDir, sessionId);
    result.grooming = await groomPromise;
    fs.writeFileSync(path.join(workDir, 'groom.json'),
      JSON.stringify(result.grooming ?? { skipped: true }, null, 1));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    progress(win, 'error', msg);
    return { ok: false, error: msg };
  }
}

/** Shared tail: headless UE identity job on a fabricated take, then stage the
 *  artifacts into the sandboxed UE container. */
async function runUEJobAndStage(
  win: BrowserWindow | null,
  workDir: string,
  takeDir: string,
  stageKey: string,
): Promise<IdentityInferenceResult> {
  await run(win, 'identity', UE_CMD,
    [WORKER_UPROJECT, `-ExecCmds=py ${JOB_SCRIPT}`, '-unattended', '-nosplash', '-RenderOffScreen'],
    { ...process.env, UC_TAKE: takeDir, UC_OUT: workDir, UC_NAME: 'LocalChar' },
    30 * 60 * 1000);

  const dnaSrc = path.join(workDir, 'identity.dna');
  const blobSrc = path.join(workDir, 'identity.ulmb');
  if (!fs.existsSync(dnaSrc) || !fs.existsSync(blobSrc)) {
    // job_result.json carries the per-step trail for debugging.
    let detail = '';
    try {
      const steps = JSON.parse(fs.readFileSync(path.join(workDir, 'job_result.json'), 'utf8')).steps;
      detail = steps.filter((s: { ok: boolean }) => !s.ok).map((s: { step: string }) => s.step).join(',');
    } catch { /* no result file */ }
    return { ok: false, error: `UE job produced no artifacts (failed: ${detail || 'unknown'})` };
  }

  const stageDir = path.join(ueContainerSavedDir(), 'Identity', stageKey);
  fs.mkdirSync(stageDir, { recursive: true });
  const dnaPath = path.join(stageDir, 'identity.dna');
  const blobPath = path.join(stageDir, 'identity.ulmb');
  fs.copyFileSync(dnaSrc, dnaPath);
  fs.copyFileSync(blobSrc, blobPath);

  // DNA-native (v2) companions, both optional so this never breaks the v1 blob
  // path. The joint sidecar carries eye/jaw placement the .dna cannot express
  // portably; base_face.udvt is the shared, identity-independent vertex table.
  // Both are staged BESIDE identity.dna because ResolveIdentityTablePath checks
  // the .dna's own directory first, so no descriptor field is required for it.
  let jointsPath: string | undefined;
  const ujntSrc = path.join(workDir, 'identity.ujnt');
  if (fs.existsSync(ujntSrc)) {
    jointsPath = path.join(stageDir, 'identity.ujnt');
    fs.copyFileSync(ujntSrc, jointsPath);
  } else {
    progress(win, 'done', 'no identity.ujnt from the UE job (v1 blob path only)');
  }

  let tablePath: string | undefined;
  if (fs.existsSync(FACE_TABLE_SRC)) {
    tablePath = path.join(stageDir, path.basename(FACE_TABLE_SRC));
    fs.copyFileSync(FACE_TABLE_SRC, tablePath);
  }

  progress(win, 'done', `artifacts staged at ${stageDir}`);
  return { ok: true, dnaPath, blobPath, jointsPath, tablePath };
}

/** Photo-only tier: any flat JPEG/PNG, depth synthesized by the ML stack
 *  (MoGe-2 intrinsics + Sapiens2 pointmap/normals, screened-Poisson fusion --
 *  the P1b pipeline, measured conform-equivalent to TrueDepth within 1.6mm). */
export async function runLocalPhotoInference(
  win: BrowserWindow | null,
  localId: string,
  photoBytes: Uint8Array,
  ext: 'jpg' | 'png',
  groom?: GroomArgs,
): Promise<IdentityInferenceResult> {
  try {
    if (!/^ph_[a-f0-9]{8,32}$/.test(localId)) return { ok: false, error: 'bad_local_id' };
    if (process.platform !== 'darwin') return { ok: false, error: 'local inference is mac-dev only' };
    for (const p of [UE_CMD, WORKER_UPROJECT, JOB_SCRIPT, TAKE_PYTHON, SAPIENS_PYTHON]) {
      if (!fs.existsSync(p)) return { ok: false, error: `missing tool: ${p}` };
    }

    const workDir = path.join(app.getPath('userData'), 'identities', localId);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const photoPath = path.join(workDir, `photo.${ext}`);
    fs.writeFileSync(photoPath, Buffer.from(photoBytes));
    progress(win, 'prep', `photo staged (${photoBytes.length} bytes)`);

    // 1. MoGe-2 intrinsics + matte (rgb.png / matte.npy / meta.json).
    await run(win, 'photo-prep', TAKE_PYTHON, [`${P1_DIR}/photo_prep.py`, photoPath, workDir],
      process.env, 15 * 60 * 1000);
    // 2. Synthesized geometry: Sapiens2 pointmap (depth_m.npy) + normals.
    const rgbPath = path.join(workDir, 'rgb.png');
    await run(win, 'depth', SAPIENS_PYTHON, [`${P1_DIR}/run_sapiens2_pointmap.py`, rgbPath, workDir],
      process.env, 20 * 60 * 1000);
    await run(win, 'normals', SAPIENS_PYTHON, [`${P1_DIR}/run_sapiens2_normal.py`, rgbPath, workDir],
      process.env, 20 * 60 * 1000);
    // 3. Fusion + fabricated take (screened Poisson, IPD rescale, FAR clamp).
    await run(win, 'fuse', TAKE_PYTHON, [`${P1_DIR}/portrait_take.py`, workDir],
      process.env, 10 * 60 * 1000);
    const takeDir = path.join(workDir, 'take');
    if (!fs.existsSync(path.join(takeDir, 'calib.mhaical'))) {
      return { ok: false, error: 'photo fusion produced no take' };
    }

    const groomPromise = groom ? pickGrooming(win, groom) : Promise.resolve(undefined);
    const result = await runUEJobAndStage(win, workDir, takeDir, localId);
    result.grooming = await groomPromise;
    fs.writeFileSync(path.join(workDir, 'groom.json'),
      JSON.stringify(result.grooming ?? { skipped: true }, null, 1));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    progress(win, 'error', msg);
    return { ok: false, error: msg };
  }
}
