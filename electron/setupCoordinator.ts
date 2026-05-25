// First-run setup coordinator — the Mac equivalent of the Windows
// installer's setup.pyd pipeline. Provisions the runtime under
// `~/Library/Application Support/Unclaw/runtime/` so the user can
// double-click Unclaw.app and have everything Just Work without
// touching a terminal.
//
// Stages (each is idempotent + resumable):
//   1. preflight — disk space, arm64 check, uv on PATH
//   2. runtime   — uv venv + pip install -r requirements-mac.txt
//   3. unreal    — fetch + extract + de-quarantine UE Shipping .app
//   4. models    — fetch + extract lipsync/t2f source + checkpoints
//                  + Core ML mlpackages (the "runtime assets" bundle)
//
// On success a `.setup-complete` file is written with the release tag.
// soulSupervisor.ts checks for this before auto-spawning soul — if
// missing, it stays its hand and lets this coordinator run instead.
//
// All progress events stream to the renderer over IPC ('setup:progress')
// so the wizard UI can render a live log + progress arc. The same ring
// buffer pattern as soulSupervisor keeps the last 200 log lines for
// renderer hydration on mount/refresh.

import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import { MANIFEST, type RemoteAsset } from './setupManifest';
import { getRuntimeDir, startSoul } from './soulSupervisor';

// ----------------------------------------------------------------------
// Types + module-scope state
// ----------------------------------------------------------------------

export type SetupStageId =
  | 'preflight'
  | 'runtime'
  | 'unreal'
  | 'models'
  | 'complete'
  | 'failed';

export interface SetupStageState {
  id: SetupStageId;
  /** 0..1, or null when indeterminate (uv pip install can take minutes
   *  with no measurable progress until each package lands). */
  progress: number | null;
  /** One-line headline shown above the progress arc in the wizard. */
  headline: string;
  /** Optional sub-line — bytes downloaded, package being installed, etc. */
  detail?: string;
}

export interface SetupLogLine {
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
}

export interface SetupSnapshot {
  isComplete: boolean;
  releaseTag: string;
  stage: SetupStageState;
  recentLogs: SetupLogLine[];
  lastError: string | null;
}

const RECENT_LOG_BUFFER = 200;
const recentLogs: SetupLogLine[] = [];
let currentStage: SetupStageState = {
  id: 'preflight',
  progress: 0,
  headline: 'Preparing first-run setup…',
};
let lastError: string | null = null;
let setupInFlight = false;

function emit(window: BrowserWindow | null, channel: string, payload?: unknown): void {
  if (!window || window.isDestroyed()) return;
  if (payload === undefined) {
    window.webContents.send(channel);
  } else {
    window.webContents.send(channel, payload);
  }
}

function pushLog(
  window: BrowserWindow | null,
  stream: SetupLogLine['stream'],
  line: string,
): void {
  const entry = { stream, line };
  recentLogs.push(entry);
  if (recentLogs.length > RECENT_LOG_BUFFER) recentLogs.shift();
  emit(window, 'setup:log', entry);
}

function setStage(
  window: BrowserWindow | null,
  stage: SetupStageState,
): void {
  currentStage = stage;
  emit(window, 'setup:stage', stage);
}

// ----------------------------------------------------------------------
// Path helpers (single source of truth for the runtime layout)
// ----------------------------------------------------------------------

function runtimePaths() {
  const root = getRuntimeDir();
  return {
    root,
    pythonEnv: path.join(root, 'python-env'),
    assets: path.join(root, 'assets'),
    unreal: path.join(root, 'unreal'),
    data: path.join(root, 'data'),
    cache: path.join(root, 'cache'),
    completionMarker: path.join(root, '.setup-complete'),
  };
}

function packagedSoulSrcDir(): string {
  return path.join(process.resourcesPath, 'soul-src');
}

/**
 * Resolve uv: prefer the bundled binary inside the .app's Resources/
 * (zero user-side install requirement); fall back to system `uv` only
 * in dev / unpackaged renderers.
 *
 * We bundle uv (~47 MB) because requiring users to run a curl-bash
 * install step before opening Unclaw breaks the "double-click and go"
 * promise. The bundled binary is the same release Astral publishes; it
 * inherits our Developer ID signature via electron-builder's --deep
 * pass and runs fine under hardened runtime (cs.disable-library-
 * validation entitlement covers its dynamic loads).
 */
async function resolveUvPath(): Promise<string | null> {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'uv', 'uv');
    if (fs.existsSync(bundled)) return bundled;
    // Fall through to system uv as a recovery path if the bundle is
    // missing for some reason (shouldn't happen).
  }
  return which('uv');
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

/**
 * Snapshot for the renderer. SetupWizard calls this on mount so it
 * hydrates with current state instead of waiting for events that may
 * have already fired (same pattern as getSoulSnapshot).
 */
export function getSetupSnapshot(): SetupSnapshot {
  return {
    isComplete: isSetupComplete(),
    releaseTag: MANIFEST.releaseTag,
    stage: currentStage,
    recentLogs: recentLogs.slice(),
    lastError,
  };
}

/**
 * Has setup successfully finished for the current MANIFEST.releaseTag?
 * A completion marker from a prior release counts as incomplete — the
 * wizard re-runs to fetch new artifacts when we ship updates.
 */
export function isSetupComplete(): boolean {
  if (!app.isPackaged) return true; // dev runs use the sibling repos
  const { completionMarker } = runtimePaths();
  try {
    if (!fs.existsSync(completionMarker)) return false;
    const stamp = JSON.parse(fs.readFileSync(completionMarker, 'utf-8'));
    return stamp.releaseTag === MANIFEST.releaseTag;
  } catch {
    return false;
  }
}

/**
 * Run the full setup pipeline. Safe to call multiple times — each
 * stage skips if its idempotent marker is already in place.
 *
 * Resolves with true on success, false on failure. Either way the
 * setup:stage IPC has already broadcast the terminal state, so the
 * renderer wizard knows what to display.
 */
export async function runSetup(window: BrowserWindow): Promise<boolean> {
  if (setupInFlight) {
    pushLog(window, 'meta', '[setup] already in progress — ignoring duplicate request');
    return false;
  }
  setupInFlight = true;
  lastError = null;

  try {
    const paths = runtimePaths();
    fs.mkdirSync(paths.root, { recursive: true });
    fs.mkdirSync(paths.data, { recursive: true });
    fs.mkdirSync(paths.cache, { recursive: true });

    await runStagePreflight(window, paths);
    await runStageRuntime(window, paths);
    await runStageUnreal(window, paths);
    await runStageModels(window, paths);

    fs.writeFileSync(
      paths.completionMarker,
      JSON.stringify({
        releaseTag: MANIFEST.releaseTag,
        completedAt: new Date().toISOString(),
      }, null, 2),
    );

    setStage(window, {
      id: 'complete',
      progress: 1,
      headline: 'All set.',
      detail: 'Launching Unclaw…',
    });
    pushLog(window, 'meta', '[setup] complete');

    // Now that the runtime is provisioned, spawn soul. The supervisor's
    // auto-start at app launch bailed (no .setup-complete yet) — this is
    // the catch-up call so the renderer's transition from wizard to
    // SoulBootScreen lands on a live soul process.
    pushLog(window, 'meta', '[setup] starting soul');
    await startSoul(window).catch((err) => {
      pushLog(window, 'meta', `[setup] startSoul failed: ${(err as Error).message}`);
    });

    return true;
  } catch (err) {
    lastError = (err as Error).message || String(err);
    pushLog(window, 'meta', `[setup] FAILED: ${lastError}`);
    setStage(window, {
      id: 'failed',
      progress: null,
      headline: 'Setup ran into a problem.',
      detail: lastError,
    });
    return false;
  } finally {
    setupInFlight = false;
  }
}

// ----------------------------------------------------------------------
// Stage 1: preflight
// ----------------------------------------------------------------------

async function runStagePreflight(
  window: BrowserWindow,
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  setStage(window, {
    id: 'preflight',
    progress: 0,
    headline: 'Running preflight checks…',
  });
  pushLog(window, 'meta', '[preflight] starting');

  // arm64 check. mlx-audio + Core ML are Apple-Silicon-only; running
  // the Mac DMG on a 2019-era Intel iMac would fail in confusing
  // ways during model inference. Better to fail upfront.
  if (process.arch !== 'arm64') {
    throw new Error(
      `Unclaw for Mac requires Apple Silicon (M-series), but this Mac is ${process.arch}. ` +
      `Visit https://unclaw.app for the Windows build if you have an Nvidia GPU available.`,
    );
  }
  pushLog(window, 'meta', `[preflight] arch=arm64 ✓`);

  // Disk space. Cheap fs.statfsSync existed before Node 18; we use the
  // safer (Node 20+) variant via a promise to keep the main thread free.
  try {
    const stats = await fs.promises.statfs(paths.root);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    pushLog(window, 'meta',
      `[preflight] free disk: ${Math.round(freeBytes / 1e9)} GB`);
    if (freeBytes < MANIFEST.minFreeDiskBytes) {
      throw new Error(
        `Need at least ${Math.round(MANIFEST.minFreeDiskBytes / 1e9)} GB free ` +
        `to install Unclaw, but only ${Math.round(freeBytes / 1e9)} GB is available.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Need at least')) throw err;
    pushLog(window, 'meta', `[preflight] disk check unavailable: ${(err as Error).message}`);
  }

  // uv is our Python environment + package manager — bootstraps a
  // standalone CPython and runs `pip install` with reliable resolution.
  // Bundled inside Resources/uv/uv in packaged builds; falls back to
  // system uv in dev. Either way, if we can't find one, fail fast with
  // a clear message rather than hitting a confusing ENOENT later.
  const uvPath = await resolveUvPath();
  if (!uvPath) {
    throw new Error(
      'The bundled `uv` binary is missing from Resources/uv/uv (and not on PATH). ' +
      'This is a packaging bug — please report it.',
    );
  }
  pushLog(window, 'meta', `[preflight] uv: ${uvPath}`);

  setStage(window, {
    id: 'preflight',
    progress: 1,
    headline: 'Preflight passed.',
  });
}

// ----------------------------------------------------------------------
// Stage 2: runtime (Python venv + pip install)
// ----------------------------------------------------------------------

async function runStageRuntime(
  window: BrowserWindow,
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  setStage(window, {
    id: 'runtime',
    progress: null,
    headline: 'Installing Python runtime…',
    detail: 'Downloading CPython + creating venv',
  });

  const uv = (await resolveUvPath()) ?? 'uv';

  // Keep uv's downloaded CPython + cache inside our runtime dir so:
  //   1. uninstall cleans everything in one rm -rf <userData>/runtime
  //   2. users who already have a system uv aren't surprised by Unclaw
  //      installing Python into their home dir
  const uvEnv: NodeJS.ProcessEnv = {
    UV_PYTHON_INSTALL_DIR: path.join(paths.root, 'python'),
    UV_CACHE_DIR: path.join(paths.cache, 'uv'),
  };

  // 1. Ensure the target CPython is installed in uv's managed cache.
  //    This is what triggers the python-build-standalone download.
  await runCommand(
    window,
    uv,
    ['python', 'install', MANIFEST.pythonVersion],
    { stream: true, extraEnv: uvEnv },
  );

  // 2. Create the venv (idempotent — uv venv is a no-op if it exists
  //    with the same python version).
  const venvExists = fs.existsSync(path.join(paths.pythonEnv, 'bin', 'python'));
  if (!venvExists) {
    await runCommand(
      window,
      uv,
      ['venv', paths.pythonEnv, '--python', MANIFEST.pythonVersion],
      { stream: true, extraEnv: uvEnv },
    );
  } else {
    pushLog(window, 'meta', '[runtime] venv already exists — skipping create');
  }

  // 3. pip install requirements into the venv. --index-strategy
  //    unsafe-best-match is the same flag we set on Windows after
  //    discovering uv's first-index-wins behavior refuses to pull
  //    cross-index transitive deps.
  setStage(window, {
    id: 'runtime',
    progress: null,
    headline: 'Installing Python packages…',
    detail: 'This is the slowest step — ~2 minutes on a fast connection',
  });

  const requirementsFile = path.join(packagedSoulSrcDir(), 'requirements-mac.txt');
  if (!fs.existsSync(requirementsFile)) {
    throw new Error(`requirements-mac.txt missing from packaged Resources: ${requirementsFile}`);
  }

  await runCommand(
    window,
    uv,
    [
      'pip', 'install',
      '--python', path.join(paths.pythonEnv, 'bin', 'python'),
      '-r', requirementsFile,
      '--index-strategy', 'unsafe-best-match',
    ],
    { stream: true, extraEnv: uvEnv },
  );

  setStage(window, {
    id: 'runtime',
    progress: 1,
    headline: 'Python runtime ready.',
  });
}

// ----------------------------------------------------------------------
// Stage 3: Unreal game
// ----------------------------------------------------------------------

async function runStageUnreal(
  window: BrowserWindow,
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  const installedApp = path.join(paths.unreal, 'Unclaw Character.app');
  // Per-asset version sentinel — separate from the .setup-complete marker
  // because the wizard may need to re-fetch this specific category without
  // re-running every stage. Holds the asset's SHA so a manifest bump
  // forces a clean re-extract instead of silently keeping the old build.
  const versionFile = path.join(paths.unreal, '.version');
  const installedSha = (() => {
    try { return fs.readFileSync(versionFile, 'utf-8').trim(); }
    catch { return null; }
  })();
  const wantSha = MANIFEST.unreal.sha256 ?? '';

  if (fs.existsSync(installedApp) && installedSha === wantSha && wantSha) {
    pushLog(window, 'meta', `[unreal] already at ${wantSha.slice(0, 12)} — skipping`);
    setStage(window, {
      id: 'unreal',
      progress: 1,
      headline: 'Character ready.',
    });
    return;
  }

  // Mismatch (or no version stamp from a pre-versioning install): wipe
  // the old .app so the extract below lands cleanly into a fresh dir.
  if (fs.existsSync(installedApp)) {
    pushLog(window, 'meta',
      `[unreal] installed ${installedSha?.slice(0, 12) ?? '(unstamped)'} ≠ ` +
      `manifest ${wantSha.slice(0, 12)} — wiping for re-extract`);
    fs.rmSync(installedApp, { recursive: true, force: true });
  }

  setStage(window, {
    id: 'unreal',
    progress: 0,
    headline: 'Downloading character…',
    detail: '~1.5 GB',
  });

  const zipPath = path.join(paths.root, 'unreal-download.zip');
  await downloadWithResumeAndVerify(
    window,
    MANIFEST.unreal,
    zipPath,
    (downloaded, total) => {
      setStage(window, {
        id: 'unreal',
        progress: total > 0 ? downloaded / total : null,
        headline: 'Downloading character…',
        detail: `${formatBytes(downloaded)} / ${formatBytes(total)}`,
      });
    },
  );

  setStage(window, {
    id: 'unreal',
    progress: null,
    headline: 'Unpacking character…',
  });
  fs.mkdirSync(paths.unreal, { recursive: true });
  await runCommand(
    window,
    '/usr/bin/ditto',
    ['-x', '-k', zipPath, paths.unreal],
    { stream: true },
  );
  fs.unlinkSync(zipPath);

  // Strip the quarantine xattr that the OS applies to anything we
  // downloaded via curl/fetch. Without this, Gatekeeper would refuse
  // to launch the .app on first run with the unhelpful "is damaged
  // and can't be opened" dialog. Recursive so embedded frameworks
  // also get cleaned.
  setStage(window, {
    id: 'unreal',
    progress: null,
    headline: 'Authorizing character…',
  });
  await runCommand(
    window,
    '/usr/bin/xattr',
    ['-dr', 'com.apple.quarantine', installedApp],
    { stream: true, ignoreNonZeroExit: true },
  );

  // Stamp the asset SHA so the next launch can compare and skip vs re-fetch.
  if (wantSha) fs.writeFileSync(versionFile, wantSha);

  setStage(window, {
    id: 'unreal',
    progress: 1,
    headline: 'Character ready.',
  });
}

// ----------------------------------------------------------------------
// Stage 4: model assets (lipsync + t2f source + checkpoints + mlpackages)
// ----------------------------------------------------------------------

async function runStageModels(
  window: BrowserWindow,
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  // Same per-asset version-stamp pattern as the unreal stage. Sentinel
  // sits at <assets>/.version. If the SHA matches, skip; if it changed,
  // wipe and re-extract.
  const versionFile = path.join(paths.assets, '.version');
  const installedSha = (() => {
    try { return fs.readFileSync(versionFile, 'utf-8').trim(); }
    catch { return null; }
  })();
  const wantSha = MANIFEST.runtimeAssets.sha256 ?? '';

  // We treat the assets dir as a single unit — if any required sub-tree
  // is missing OR the version stamp mismatches, we re-extract the bundle.
  // Cheap to recheck; expensive to half-install on a network blip.
  const required = [
    'Audio2Lipsync/python/src',
    'ExpressModelv8/src',
    'soul-models/lipsync_v6_fp16.mlpackage',
    'soul-models/t2f_v8_fp16.mlpackage',
  ];
  const allPresent = required.every((rel) =>
    fs.existsSync(path.join(paths.assets, rel)),
  );
  if (allPresent && installedSha === wantSha && wantSha) {
    pushLog(window, 'meta', `[models] already at ${wantSha.slice(0, 12)} — skipping`);
    setStage(window, {
      id: 'models',
      progress: 1,
      headline: 'Models ready.',
    });
    return;
  }

  // Mismatch or partial install — wipe the asset tree (preserving the
  // dir itself so the extract below lands in place) and re-fetch.
  if (allPresent) {
    pushLog(window, 'meta',
      `[models] installed ${installedSha?.slice(0, 12) ?? '(unstamped)'} ≠ ` +
      `manifest ${wantSha.slice(0, 12)} — wiping for re-extract`);
    for (const child of fs.readdirSync(paths.assets)) {
      fs.rmSync(path.join(paths.assets, child), { recursive: true, force: true });
    }
  }

  setStage(window, {
    id: 'models',
    progress: 0,
    headline: 'Downloading models…',
    detail: '~700 MB',
  });

  const zipPath = path.join(paths.root, 'assets-download.zip');
  await downloadWithResumeAndVerify(
    window,
    MANIFEST.runtimeAssets,
    zipPath,
    (downloaded, total) => {
      setStage(window, {
        id: 'models',
        progress: total > 0 ? downloaded / total : null,
        headline: 'Downloading models…',
        detail: `${formatBytes(downloaded)} / ${formatBytes(total)}`,
      });
    },
  );

  setStage(window, {
    id: 'models',
    progress: null,
    headline: 'Unpacking models…',
  });
  fs.mkdirSync(paths.assets, { recursive: true });
  await runCommand(
    window,
    '/usr/bin/ditto',
    ['-x', '-k', zipPath, paths.assets],
    { stream: true },
  );
  fs.unlinkSync(zipPath);

  // Stamp the asset SHA so the next launch can compare and skip vs re-fetch.
  if (wantSha) fs.writeFileSync(versionFile, wantSha);

  setStage(window, {
    id: 'models',
    progress: 1,
    headline: 'Models ready.',
  });
}

// ----------------------------------------------------------------------
// Download with HTTP Range resume + SHA-256 verification
// ----------------------------------------------------------------------

const DOWNLOAD_USER_AGENT = 'Unclaw-Mac-Setup/1.0 (+https://unclaw.app)';
const DOWNLOAD_RETRIES = 3;

async function downloadWithResumeAndVerify(
  window: BrowserWindow,
  asset: RemoteAsset,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  // If a previous run produced a fully verified destination file
  // already, short-circuit.
  if (fs.existsSync(destPath) && asset.sha256) {
    const sha = await sha256File(destPath);
    if (sha === asset.sha256) {
      pushLog(window, 'meta', `[download] already verified: ${path.basename(destPath)}`);
      return;
    }
    // Stale partial / corrupted — wipe and re-fetch.
    fs.unlinkSync(destPath);
  }

  let attempt = 0;
  let lastErr: Error | null = null;
  while (attempt < DOWNLOAD_RETRIES) {
    attempt += 1;
    try {
      await downloadOnce(window, asset.url, destPath, asset.sizeBytes, onProgress);
      if (asset.sha256) {
        const sha = await sha256File(destPath);
        if (sha !== asset.sha256) {
          throw new Error(
            `SHA-256 mismatch on ${path.basename(destPath)}: ` +
            `expected ${asset.sha256}, got ${sha}`,
          );
        }
        pushLog(window, 'meta', `[download] SHA-256 verified: ${path.basename(destPath)}`);
      } else if (app.isPackaged) {
        throw new Error(
          `Asset ${asset.url} has no SHA-256 declared in setupManifest.ts — ` +
          `refusing to install unverified bytes in a packaged build.`,
        );
      } else {
        pushLog(window, 'meta',
          `[download] no SHA declared — skipping verify (dev build only)`);
      }
      return;
    } catch (err) {
      lastErr = err as Error;
      pushLog(window, 'meta',
        `[download] attempt ${attempt}/${DOWNLOAD_RETRIES} failed: ${lastErr.message}`);
      const backoff = Math.pow(2, attempt - 1) * 1000;
      await sleep(backoff);
    }
  }
  throw new Error(`download failed after ${DOWNLOAD_RETRIES} attempts: ${lastErr?.message}`);
}

function downloadOnce(
  window: BrowserWindow,
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const partialPath = `${destPath}.partial`;
    let resumeFrom = 0;
    if (fs.existsSync(partialPath)) {
      resumeFrom = fs.statSync(partialPath).size;
      pushLog(window, 'meta',
        `[download] resuming ${path.basename(destPath)} from byte ${resumeFrom}`);
    }

    const headers: Record<string, string> = { 'User-Agent': DOWNLOAD_USER_AGENT };
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

    const req = https.get(url, { headers }, (res) => {
      // Follow redirects manually (R2 + Cloudflare may issue them).
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadOnce(window, res.headers.location, destPath, expectedSize, onProgress)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode === 416) {
        // Range not satisfiable — partial file is already full. Move
        // it into place and let the SHA verify decide if it's good.
        res.resume();
        fs.renameSync(partialPath, destPath);
        resolve();
        return;
      }
      // 4xx = surface immediately (bad URL / WAF block), 5xx = retry.
      if (res.statusCode && res.statusCode >= 400) {
        const fatal = res.statusCode < 500;
        res.resume();
        const err = new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim());
        if (fatal) (err as Error & { fatal: boolean }).fatal = true;
        reject(err);
        return;
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      const total = expectedSize > 0
        ? expectedSize
        : (resumeFrom + contentLength);

      const out = fs.createWriteStream(partialPath, {
        flags: resumeFrom > 0 ? 'a' : 'w',
      });

      let received = resumeFrom;
      let lastEmit = 0;
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        // Throttle progress emits to ~10/sec to keep the IPC channel
        // from saturating on a fast connection.
        const now = Date.now();
        if (now - lastEmit > 100) {
          lastEmit = now;
          onProgress(received, total);
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close();
        fs.renameSync(partialPath, destPath);
        onProgress(received, total);
        resolve();
      });
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error('download timeout after 60s'));
    });
  });
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ----------------------------------------------------------------------
// Subprocess helper — uv, ditto, xattr all go through here so log
// streaming + non-zero-exit handling stays consistent.
// ----------------------------------------------------------------------

interface RunCommandOpts {
  stream: boolean;
  ignoreNonZeroExit?: boolean;
  /** Extra env vars merged into the child process env. Used to scope
   *  uv's downloaded CPython + cache under our runtime dir. */
  extraEnv?: NodeJS.ProcessEnv;
}

function runCommand(
  window: BrowserWindow,
  cmd: string,
  args: string[],
  opts: RunCommandOpts,
): Promise<void> {
  return new Promise((resolve, reject) => {
    pushLog(window, 'meta', `[exec] ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
      env: {
        ...process.env,
        PATH: [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          process.env.PATH ?? '',
        ].filter(Boolean).join(':'),
        ...(opts.extraEnv ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onChunk = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (!opts.stream) return;
      for (const raw of chunk.toString('utf-8').split(/\r?\n/)) {
        const line = raw.replace(/\r/g, '');
        if (line) pushLog(window, stream, line);
      }
    };
    proc.stdout?.on('data', onChunk('stdout'));
    proc.stderr?.on('data', onChunk('stderr'));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0 || opts.ignoreNonZeroExit) {
        resolve();
      } else {
        reject(new Error(`${path.basename(cmd)} exited with code ${code}`));
      }
    });
  });
}

async function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('/usr/bin/which', [cmd], {
      env: {
        ...process.env,
        PATH: [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          process.env.PATH ?? '',
        ].filter(Boolean).join(':'),
      },
    });
    let out = '';
    proc.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    proc.on('exit', (code) => {
      resolve(code === 0 ? out.trim() : null);
    });
    proc.on('error', () => resolve(null));
  });
}

// ----------------------------------------------------------------------
// Tiny utilities
// ----------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}
