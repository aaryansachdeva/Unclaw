// First-run setup coordinator, the Mac equivalent of the Windows
// installer's setup.pyd pipeline. Provisions the runtime under
// `~/Library/Application Support/Unclaw/runtime/` so the user can
// double-click Unclaw.app and have everything Just Work without
// touching a terminal.
//
// Stages (each is idempotent + resumable):
//   1. preflight, disk space, arm64 check, uv on PATH
//   2. runtime  , uv venv + pip install -r requirements-mac.txt
//   3. unreal   , fetch + extract + de-quarantine UE Shipping .app
//   4. models   , fetch + extract lipsync/t2f source + checkpoints
//                  + Core ML mlpackages (the "runtime assets" bundle)
//
// On success a `.setup-complete` file is written with the release tag.
// soulSupervisor.ts checks for this before auto-spawning soul, if
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
import { getRuntimeDir, getSoulDataDir, startSoul } from './soulSupervisor';

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
  /** Optional sub-line, bytes downloaded, package being installed, etc. */
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
 * Seed the updater's version ledger (<runtime>/.installed-versions.json) with
 * the bundle versions the wizard just provisioned. Without this, the first
 * post-setup update pass reads an empty ledger and redundantly re-downloads
 * the ~1.9 GB UE + ~1.2 GB assets the wizard already fetched. Merge-MAX with
 * any existing ledger (date-tags sort lexicographically) so a newer
 * updater-installed version is never clobbered by an older DMG baseline on a
 * releaseTag re-run, and so unrelated keys (soul, soul_requirements_sha) are
 * preserved. Schema mirrors InstalledVersions in updateManifest.ts.
 */
function seedUpdaterLedger(root: string): void {
  const ledgerPath = path.join(root, '.installed-versions.json');
  let ledger: Record<string, string> = {};
  try {
    if (fs.existsSync(ledgerPath)) {
      ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')) as Record<string, string>;
    }
  } catch {
    ledger = {};
  }
  const seed = (key: string, version: string | undefined) => {
    if (!version) return;
    const cur = ledger[key];
    if (cur == null || version > cur) ledger[key] = version;
  };
  seed('app', app.getVersion());
  seed('unreal', MANIFEST.unreal.version);
  seed('assets', MANIFEST.runtimeAssets.version);
  try {
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  } catch {
    /* non-fatal: worst case the updater re-checks (and may re-download) next launch */
  }
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
 * A completion marker from a prior release counts as incomplete, the
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
 * Run the full setup pipeline. Safe to call multiple times, each
 * stage skips if its idempotent marker is already in place.
 *
 * Resolves with true on success, false on failure. Either way the
 * setup:stage IPC has already broadcast the terminal state, so the
 * renderer wizard knows what to display.
 */
export async function runSetup(window: BrowserWindow): Promise<boolean> {
  if (setupInFlight) {
    pushLog(window, 'meta', '[setup] already in progress, ignoring duplicate request');
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

    // Seed the updater ledger so the first post-setup update pass doesn't
    // re-download the multi-GB UE + assets bundles we just provisioned.
    seedUpdaterLedger(paths.root);

    setStage(window, {
      id: 'complete',
      progress: 1,
      headline: 'All set.',
      detail: 'Launching Unclaw…',
    });
    pushLog(window, 'meta', '[setup] complete');

    // Now that the runtime is provisioned, spawn soul. The supervisor's
    // auto-start at app launch bailed (no .setup-complete yet), this is
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

  // uv is our Python environment + package manager, bootstraps a
  // standalone CPython and runs `pip install` with reliable resolution.
  // Bundled inside Resources/uv/uv in packaged builds; falls back to
  // system uv in dev. Either way, if we can't find one, fail fast with
  // a clear message rather than hitting a confusing ENOENT later.
  const uvPath = await resolveUvPath();
  if (!uvPath) {
    throw new Error(
      'The bundled `uv` binary is missing from Resources/uv/uv (and not on PATH). ' +
      'This is a packaging bug. Please report it.',
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
    // ~200 MB CPython download; 10 min is generous for a slow link but bounds
    // a truly stalled fetch.
    { stream: true, extraEnv: uvEnv, timeoutMs: 10 * 60_000 },
  );

  // 2. Create the venv (idempotent, uv venv is a no-op if it exists
  //    with the same python version).
  const venvExists = fs.existsSync(venvPythonPath(paths.pythonEnv));
  if (!venvExists) {
    await runCommand(
      window,
      uv,
      ['venv', paths.pythonEnv, '--python', MANIFEST.pythonVersion],
      { stream: true, extraEnv: uvEnv, timeoutMs: 3 * 60_000 },
    );
  } else {
    pushLog(window, 'meta', '[runtime] venv already exists, skipping create');
  }

  // 3. pip install requirements into the venv. --index-strategy
  //    unsafe-best-match is the same flag we set on Windows after
  //    discovering uv's first-index-wins behavior refuses to pull
  //    cross-index transitive deps.
  setStage(window, {
    id: 'runtime',
    progress: null,
    headline: 'Installing Python packages…',
    detail: 'This is the slowest step, ~2 minutes on a fast connection',
  });

  const requirementsFile = path.join(packagedSoulSrcDir(), requirementsFileName());
  if (!fs.existsSync(requirementsFile)) {
    throw new Error(`${requirementsFileName()} missing from packaged Resources: ${requirementsFile}`);
  }

  await runCommand(
    window,
    uv,
    [
      'pip', 'install',
      '--python', venvPythonPath(paths.pythonEnv),
      '-r', requirementsFile,
      '--index-strategy', 'unsafe-best-match',
    ],
    // The slowest step (multi-hundred-MB wheel set). 20 min bounds a hung
    // PyPI socket while leaving ample headroom for a genuinely slow install.
    { stream: true, extraEnv: uvEnv, timeoutMs: 20 * 60_000 },
  );

  setStage(window, {
    id: 'runtime',
    progress: 1,
    headline: 'Python runtime ready.',
  });
}


// ----------------------------------------------------------------------
// Public helper: re-sync the existing venv against an updated
// requirements-mac.txt. Called from `updateCoordinator.installCategory`
// after a `soul` overlay extraction succeeds, so a soul update that
// added/upgraded pip deps lands the new packages without forcing a
// full setup-wizard re-run.
//
// Design rationale (see "do all the things get redownloaded" Q on
// 2026-05-27): each manifest category is independent. A `soul` bump
// only ships the source overlay; before this helper existed, a new
// pip dep (e.g. mlx-whisper replacing useful-moonshine-onnx) would
// land in the source but never get installed, breaking
// `import mlx_whisper` at runtime. Bumping `UNCLAW_RELEASE_TAG` to
// trigger a full setup-wizard re-run would work but re-pulls 2 GB
// of UE + 700 MB of assets, neither of which changed. This helper
// is the surgical fix: pip-sync only, ~5 s when nothing changed.
//
// SHA-gated: the caller passes the previously-installed
// requirements-mac.txt SHA. If it matches the SHA of the new
// file, we no-op (pip install would be a multi-second wasted
// command). When it differs, we run `uv pip install -r ...` against
// the existing venv path.
// ----------------------------------------------------------------------

export async function syncSoulVenv(
  window: BrowserWindow | null,
  soulOverlayDir: string,
  lastInstalledSha: string | null,
): Promise<{ ran: boolean; sha: string | null }> {
  const paths = runtimePaths();
  const requirementsFile = path.join(soulOverlayDir, requirementsFileName());

  if (!fs.existsSync(requirementsFile)) {
    // The new soul overlay didn't ship a requirements file, that's
    // weird but not necessarily fatal (a malformed overlay would have
    // failed extraction earlier). Skip pip-sync, keep the previously
    // recorded SHA so we don't churn on every update cycle.
    pushLog(window, 'meta',
      `[venv-sync] ${requirementsFileName()} missing in overlay; skipping pip-install`);
    return { ran: false, sha: lastInstalledSha };
  }

  // SHA-256 the new requirements file. Cheap (~2 ms on a 1 KB file)
  // compared to launching uv (~200 ms) + an empty pip install (~3 s).
  const newSha = crypto.createHash('sha256')
    .update(fs.readFileSync(requirementsFile))
    .digest('hex');
  if (lastInstalledSha && lastInstalledSha === newSha) {
    // Requirements haven't changed since the last install. Skip the
    // pip-sync entirely, the venv is already in lock-step with this
    // soul overlay's deps.
    pushLog(window, 'meta',
      `[venv-sync] requirements unchanged (sha=${newSha.slice(0, 8)}); skipping pip-install`);
    return { ran: false, sha: newSha };
  }

  pushLog(window, 'meta',
    `[venv-sync] requirements changed (${
      lastInstalledSha ? lastInstalledSha.slice(0, 8) : '(none)'
    } → ${newSha.slice(0, 8)}); running uv pip install`);

  // Sanity-check the venv exists. If it doesn't, the user is in a
  // weird state (manual rm of the venv, or a half-finished setup);
  // we can't pip-install into a non-existent venv. Caller logs the
  // skip; STT/whatever new dep was supposed to land will lazy-fail
  // at runtime.
  const venvPython = venvPythonPath(paths.pythonEnv);
  if (!fs.existsSync(venvPython)) {
    pushLog(window, 'meta',
      `[venv-sync] venv missing at ${venvPython}; skipping pip-install`);
    return { ran: false, sha: lastInstalledSha };
  }

  const uv = (await resolveUvPath()) ?? 'uv';
  const uvEnv: NodeJS.ProcessEnv = {
    UV_PYTHON_INSTALL_DIR: path.join(paths.root, 'python'),
    UV_CACHE_DIR: path.join(paths.cache, 'uv'),
  };

  await runCommand(
    window!,
    uv,
    [
      'pip', 'install',
      '--python', venvPython,
      '-r', requirementsFile,
      '--index-strategy', 'unsafe-best-match',
    ],
    { stream: true, extraEnv: uvEnv },
  );
  pushLog(window, 'meta',
    `[venv-sync] pip install complete; new sha=${newSha.slice(0, 8)}`);
  return { ran: true, sha: newSha };
}


// ----------------------------------------------------------------------
// Stage 3: Unreal game
// ----------------------------------------------------------------------

async function runStageUnreal(
  window: BrowserWindow,
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  // macOS ships a `.app` bundle; the Windows packaged build extracts as a
  // plain folder (AudioTestProject02/ + launcher exe), so the install root IS
  // the unreal dir. Quarantine-strip below no-ops off macOS regardless.
  const installedApp = process.platform === 'win32'
    ? paths.unreal
    : path.join(paths.unreal, 'Unclaw Character.app');
  // Per-asset version sentinel, separate from the .setup-complete marker
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
    pushLog(window, 'meta', `[unreal] already at ${wantSha.slice(0, 12)}, skipping`);
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
      `manifest ${wantSha.slice(0, 12)}, wiping for re-extract`);
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
  await extractZip(window, zipPath, paths.unreal);
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
  await stripQuarantineMac(window, installedApp);

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

  // We treat the assets dir as a single unit, if any required sub-tree
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
    pushLog(window, 'meta', `[models] already at ${wantSha.slice(0, 12)}, skipping`);
    setStage(window, {
      id: 'models',
      progress: 1,
      headline: 'Models ready.',
    });
    return;
  }

  // Mismatch or partial install, wipe the asset tree (preserving the
  // dir itself so the extract below lands in place) and re-fetch.
  if (allPresent) {
    pushLog(window, 'meta',
      `[models] installed ${installedSha?.slice(0, 12) ?? '(unstamped)'} ≠ ` +
      `manifest ${wantSha.slice(0, 12)}, wiping for re-extract`);
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
  await extractZip(window, zipPath, paths.assets);
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

export async function downloadWithResumeAndVerify(
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
    // Stale partial / corrupted, wipe and re-fetch.
    fs.unlinkSync(destPath);
  }

  const partialPath = `${destPath}.partial`;
  let attempt = 0;
  let lastErr: Error | null = null;
  while (attempt < DOWNLOAD_RETRIES) {
    attempt += 1;
    try {
      await downloadOnce(window, asset.url, destPath, asset.sizeBytes, onProgress);
      if (asset.sha256) {
        const sha = await sha256File(destPath);
        if (sha !== asset.sha256) {
          // Known-bad bytes (CDN served a stale cached body, truncated
          // transfer, a Range-ignored resume that slipped through). Remove
          // the final file AND any lingering partial so the retry starts
          // clean instead of resuming onto the corrupt tail.
          try { fs.unlinkSync(destPath); } catch { /* ok */ }
          try { fs.unlinkSync(partialPath); } catch { /* ok */ }
          throw new Error(
            `SHA-256 mismatch on ${path.basename(destPath)}: ` +
            `expected ${asset.sha256}, got ${sha}`,
          );
        }
        pushLog(window, 'meta', `[download] SHA-256 verified: ${path.basename(destPath)}`);
      } else if (app.isPackaged) {
        throw new Error(
          `Asset ${asset.url} has no SHA-256 declared in setupManifest.ts, ` +
          `refusing to install unverified bytes in a packaged build.`,
        );
      } else {
        pushLog(window, 'meta',
          `[download] no SHA declared, skipping verify (dev build only)`);
      }
      return;
    } catch (err) {
      lastErr = err as Error;
      pushLog(window, 'meta',
        `[download] attempt ${attempt}/${DOWNLOAD_RETRIES} failed: ${lastErr.message}`);
      // 4xx (bad URL, WAF block, expired presigned URL) won't heal on retry.
      // Fail fast instead of burning the whole backoff schedule on it.
      if ((lastErr as Error & { fatal?: boolean }).fatal) {
        pushLog(window, 'meta', `[download] not retrying (client error): ${lastErr.message}`);
        break;
      }
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
  redirectsLeft = 5,
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
      // Follow redirects manually (R2 + Cloudflare may issue them). Cap the
      // depth so a misconfigured redirect loop rejects instead of recursing
      // until the stack overflows.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`too many redirects fetching ${path.basename(destPath)}`));
          return;
        }
        downloadOnce(window, res.headers.location, destPath, expectedSize, onProgress, redirectsLeft - 1)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode === 416) {
        // Range not satisfiable, partial file is already full. Move
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

      // Range-ignored guard. We asked to resume (sent a Range header) but the
      // server answered 200 (full body) instead of 206 (partial content) ,
      // common when a CDN/presigned URL ignores Range. Appending that full
      // body onto our existing partial bytes yields a corrupt partial+full
      // file, previously caught only by the SHA check after a fully wasted
      // download. Detect it and restart the file from byte 0 instead.
      let startAt = resumeFrom;
      if (resumeFrom > 0 && res.statusCode === 200) {
        pushLog(window, 'meta',
          `[download] server ignored Range (200 not 206), restarting ` +
          `${path.basename(destPath)} from the beginning`);
        startAt = 0;
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      const total = expectedSize > 0
        ? expectedSize
        : (startAt + contentLength);

      const out = fs.createWriteStream(partialPath, {
        flags: startAt > 0 ? 'a' : 'w',
      });

      let received = startAt;
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

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ----------------------------------------------------------------------
// Character pak download. Used by the store: a purchased + entitlement-
// checked character pak is fetched on demand from the store Worker's
// short-lived presigned URL, verified by SHA-256, and extracted into the
// runtime so UE can mount it and soul can find its voices.
//
// `asset.url` is the live (presigned) URL handed back by the store Worker,
// NOT the manifest reference URL. sha256/sizeBytes come from the client
// manifest (setupManifest.characterPaks[id]) so we verify the exact bytes.
//
// Layout (so UE pak mounting + soul voice lookup both have a stable home):
//   runtime/characters/<id>/        <- extracted pak contents
// The UE-side mount path + soul voice symlink/copy is finished by the pak
// pipeline (the pak format is still being finalized); this function owns
// the download + verify + extract half.
// ----------------------------------------------------------------------
function assertSafeCharacterId(characterId: string): void {
  // Hard guard: characterId is renderer-supplied and gets joined into paths we
  // later rm -rf + extract into. Reject anything that isn't a plain id so a
  // value like `../../foo` can never escape the runtime dir.
  if (!/^[a-z0-9_-]+$/i.test(characterId)) {
    throw new Error(`invalid characterId: ${characterId}`);
  }
}

export function characterPakDir(characterId: string): string {
  assertSafeCharacterId(characterId);
  return path.join(getRuntimeDir(), 'characters', characterId);
}

/** Flat dir of owned `*.pak` files. Passed to run_soul.sh as
 *  UNCLAW_CHARACTERS_SRC; on every launch run_soul stages these into the UE
 *  sandbox container's Saved/Paks so UE boot-mounts them before BeginPlay. This
 *  is the canonical, survives-everything home for purchased paks. */
export function characterPaksStageDir(): string {
  return path.join(getRuntimeDir(), 'character-paks');
}

/** UE's readable Saved/Paks dir, for a MID-SESSION mount (no relaunch): the pak
 *  is copied here, then mounted via the `mountCharacterPak` descriptor. Must
 *  match the dir run_soul stages into. Best-effort — if it doesn't resolve, the
 *  boot-mount path via UNCLAW_CHARACTERS_SRC still mounts on next launch.
 *
 *  macOS: UE is sandboxed, so this is its container Saved/Paks.
 *  Windows: UE is NOT sandboxed; it reads from the packaged build's
 *  ProjectSavedDir/Paks (the Windows UE bundle extracts under runtime/unreal/). */
export function ueContainerPaksDir(): string {
  if (process.platform === 'win32') {
    return path.join(getRuntimeDir(), 'unreal', 'AudioTestProject02', 'Saved', 'Paks');
  }
  return path.join(
    app.getPath('home'),
    'Library/Containers/com.YourCompany.AudioTestProject02/Data/Library',
    'Application Support/Epic/AudioTestProject02/Saved/Paks',
  );
}

export interface InstalledPak {
  /** Where the pak was extracted (debug / cleanup). */
  extractDir: string;
  /** Canonical owned copy under runtime/character-paks/<id>.pak. */
  stagedPak: string;
  /** Copy inside the UE sandbox container, or null if the container wasn't
   *  reachable (UE not launched yet). null => no mid-session mount; the pak
   *  still boot-mounts on the next launch via UNCLAW_CHARACTERS_SRC. */
  containerPak: string | null;
}

/** Sidecar that records which manifest version of a pak is staged, so the
 *  provisioning pass can tell an OUTDATED pak from a current one and re-download
 *  on drift (not just when missing). Lives next to <id>.pak in the stage dir. */
function pakVersionFile(characterId: string): string {
  return path.join(characterPaksStageDir(), `${characterId}.version`);
}

/** Map of staged characterId -> installed pak version (from the sidecar).
 *  Missing sidecar => 'unknown', which never equals a real manifest version, so
 *  a pak staged before versioning existed is treated as drifted and refreshed. */
export function installedPakVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const dir = characterPaksStageDir();
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.pak')) continue;
      const id = f.replace(/\.pak$/i, '');
      let version = 'unknown';
      try {
        const v = fs.readFileSync(path.join(dir, `${id}.version`), 'utf8').trim();
        if (v) version = v;
      } catch { /* no sidecar => unknown */ }
      out[id] = version;
    }
  } catch { /* ignore */ }
  return out;
}

export async function downloadAndExtractCharacterPak(
  window: BrowserWindow,
  characterId: string,
  asset: { url: string; sha256: string | null; sizeBytes: number; version?: string },
  onProgress: (downloaded: number, total: number) => void,
): Promise<InstalledPak> {
  assertSafeCharacterId(characterId);
  const root = getRuntimeDir();
  const destDir = characterPakDir(characterId);
  const zipPath = path.join(root, `char-${characterId}-download.zip`);

  // Reuse the resumable, SHA-verified downloader the base bundles use.
  await downloadWithResumeAndVerify(window, asset, zipPath, onProgress);

  // Fresh extract: nuke any partial/previous install first.
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  await extractZip(window, zipPath, destDir);
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

  // Strip quarantine on any extracted binaries/content, same as the base
  // bundle, so Gatekeeper never blocks pak content on first mount. No-op on
  // Windows.
  await stripQuarantineMac(window, destDir);

  // The zip carries exactly one `.pak` (named <id>.pak at upload time). Find it
  // defensively rather than assuming the name, so a re-cook with a different
  // internal name still installs.
  const pakName = fs.readdirSync(destDir).find((f) => f.toLowerCase().endsWith('.pak'));
  if (!pakName) {
    throw new Error(`no .pak found in extracted character bundle for ${characterId}`);
  }
  const srcPak = path.join(destDir, pakName);
  // Normalize the staged filename to <id>.pak so run_soul + mount paths are
  // deterministic regardless of the cook's chunk name.
  const stagedName = `${characterId}.pak`;

  // (1) Canonical owned copy → UNCLAW_CHARACTERS_SRC (boot-mount source).
  const stageDir = characterPaksStageDir();
  fs.mkdirSync(stageDir, { recursive: true });
  const stagedPak = path.join(stageDir, stagedName);
  fs.copyFileSync(srcPak, stagedPak);
  // Stamp the staged version so a later provisioning pass can detect drift.
  // Written AFTER the copy so a crash mid-copy leaves no false "current" mark.
  try {
    if (asset.version) fs.writeFileSync(pakVersionFile(characterId), asset.version);
    else { try { fs.unlinkSync(pakVersionFile(characterId)); } catch { /* none */ } }
  } catch { /* non-fatal: worst case it re-downloads next launch */ }

  // (2) Best-effort copy into the UE sandbox container for an immediate
  // mid-session mount. Fails softly when the container doesn't exist yet (UE
  // never launched) — the boot-mount path covers that case on next launch.
  let containerPak: string | null = null;
  try {
    const containerDir = ueContainerPaksDir();
    fs.mkdirSync(containerDir, { recursive: true });
    containerPak = path.join(containerDir, stagedName);
    fs.copyFileSync(srcPak, containerPak);
  } catch (err) {
    console.warn(`[pak] container stage skipped for ${characterId}: ${(err as Error).message}`);
    containerPak = null;
  }

  return { extractDir: destDir, stagedPak, containerPak };
}

// ----------------------------------------------------------------------
// Character voice install. A paid character's cloned voice (supertonic JSON +
// kokoro safetensors) lives in the same private, entitlement-gated bucket as
// the pak. The renderer fetches short-lived presigned URLs from the store
// Worker (it holds the auth token) and hands them here; we drop each file into
// the soul data dir soul actually reads, so the avatar speaks in its cloned
// voice instead of the generic F1 fallback. soul needs no change: _resolve_voice
// loads <id>.json straight off disk when present.
//
//   supertonic -> <SOUL_DATA>/supertonic/voices/<id>.json
//   kokoro     -> <SOUL_DATA>/kokoro/voices/<id>_kokoro.safetensors
// ----------------------------------------------------------------------
function soulVoicesDir(engine: 'supertonic' | 'kokoro'): string {
  // getSoulDataDir() resolves SOUL_DATA_DIR exactly like run_soul, so this lands
  // where soul reads in BOTH packaged (<runtime>/data) and dev. On Windows dev,
  // getSoulDataDir() -> resolveSoulScript().cwd/data, and resolveSoulScript
  // honors UNCLAW_SOUL_REPO, so it resolves to E:\UnClaw\soul\data (next to
  // grace.json) — not a runtime dir nothing reads in dev.
  return path.join(getSoulDataDir(), engine, 'voices');
}

/** Expected on-disk voice filenames for a character, by engine. Kept in lockstep
 *  with src/characters/<id>.ts (supertonic stem `<id>`, kokoro stem `<id>_kokoro`)
 *  and the store Worker's /voice key layout. */
function voiceFileNames(characterId: string): { supertonic: string; kokoro: string } {
  assertSafeCharacterId(characterId);
  return { supertonic: `${characterId}.json`, kokoro: `${characterId}_kokoro.safetensors` };
}

/** Which of a character's voice files are already present on disk (non-empty).
 *  Lets the renderer skip a gated fetch when nothing is missing. */
export function characterVoicesPresent(characterId: string): { supertonic: boolean; kokoro: boolean } {
  const names = voiceFileNames(characterId);
  const ok = (engine: 'supertonic' | 'kokoro', name: string): boolean => {
    try {
      const st = fs.statSync(path.join(soulVoicesDir(engine), name));
      return st.isFile() && st.size > 0;
    } catch { return false; }
  };
  return {
    supertonic: ok('supertonic', names.supertonic),
    kokoro: ok('kokoro', names.kokoro),
  };
}

export interface VoiceDownloadFile {
  kind: 'supertonic' | 'kokoro';
  filename: string;
  url: string;
}

/** Download a character's presigned voice files into the soul voices dirs.
 *  Best-effort and idempotent: writes atomically (temp + rename), routes by
 *  `kind`, and ignores unknown kinds. Returns the count actually written. A
 *  failure here never blocks the pak: the avatar just falls back to F1 until
 *  the next attempt. */
export async function downloadCharacterVoices(
  characterId: string,
  files: VoiceDownloadFile[],
): Promise<number> {
  assertSafeCharacterId(characterId);
  const names = voiceFileNames(characterId);
  let written = 0;
  for (const f of files) {
    if (f.kind !== 'supertonic' && f.kind !== 'kokoro') continue;
    // Force the destination name from the trusted id, never the server-supplied
    // filename, so a rogue presign response can't write outside the voices dir.
    const destName = f.kind === 'supertonic' ? names.supertonic : names.kokoro;
    const dir = soulVoicesDir(f.kind);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, destName);
    const tmp = `${dest}.part`;
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      written += 1;
      console.log(`[voice] installed ${characterId} ${f.kind} -> ${dest} (${buf.length} B)`);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      console.warn(`[voice] ${characterId} ${f.kind} failed: ${(err as Error).message}`);
    }
  }
  return written;
}

// ----------------------------------------------------------------------
// Subprocess helper, uv, ditto, xattr all go through here so log
// streaming + non-zero-exit handling stays consistent.
// ----------------------------------------------------------------------

export interface RunCommandOpts {
  stream: boolean;
  ignoreNonZeroExit?: boolean;
  /** Extra env vars merged into the child process env. Used to scope
   *  uv's downloaded CPython + cache under our runtime dir. */
  extraEnv?: NodeJS.ProcessEnv;
  /** Hard wall-clock cap. If the child hasn't exited by then it's killed
   *  and the promise rejects with a clear "timed out" error. Without this a
   *  wedged `uv pip install` (a stalled PyPI socket) hangs the setup stage
   *  forever behind the indeterminate progress arc. Omit for no timeout. */
  timeoutMs?: number;
}

export function runCommand(
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
        // On macOS prepend the Homebrew bins (GUI apps launched from Finder
        // don't inherit a login shell PATH). On Windows there's no Homebrew
        // and the separator is ';', so just pass the inherited PATH through.
        PATH: process.platform === 'win32'
          ? (process.env.PATH ?? '')
          : ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? '']
              .filter(Boolean).join(':'),
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
    // Optional wall-clock watchdog. Kills a wedged child (SIGKILL after a
    // SIGTERM grace) and rejects so the stage surfaces a real error instead
    // of hanging behind the indeterminate progress arc forever.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill('SIGTERM'); } catch { /* already gone */ }
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
      }, opts.timeoutMs);
    }
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

    proc.stdout?.on('data', onChunk('stdout'));
    proc.stderr?.on('data', onChunk('stderr'));
    proc.on('error', (err) => { clearTimer(); reject(err); });
    proc.on('exit', (code) => {
      clearTimer();
      if (timedOut) {
        reject(new Error(
          `${path.basename(cmd)} timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s`));
      } else if (code === 0 || opts.ignoreNonZeroExit) {
        resolve();
      } else {
        reject(new Error(`${path.basename(cmd)} exited with code ${code}`));
      }
    });
  });
}

async function which(cmd: string): Promise<string | null> {
  const isWin = process.platform === 'win32';
  // Windows: `where.exe` (System32); POSIX: `/usr/bin/which`. `where` can
  // print multiple lines — take the first.
  const finder = isWin ? 'where.exe' : '/usr/bin/which';
  return new Promise((resolve) => {
    const proc = spawn(finder, [cmd], {
      env: {
        ...process.env,
        PATH: isWin
          ? (process.env.PATH ?? '')
          : ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? '']
              .filter(Boolean).join(':'),
      },
    });
    let out = '';
    proc.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    proc.on('exit', (code) => {
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(code === 0 && first ? first : null);
    });
    proc.on('error', () => resolve(null));
  });
}

// ----------------------------------------------------------------------
// Cross-platform archive + filesystem helpers. macOS uses the system
// `ditto`/`xattr`; Windows uses bundled-in OS tooling (`tar.exe`, which is
// bsdtar on Windows 10 1803+, extracts .zip too). Centralized so every
// extraction/quarantine site stays platform-correct.
// ----------------------------------------------------------------------

/** Extract a .zip into destDir, cross-platform. destDir is created if absent. */
export async function extractZip(
  window: BrowserWindow,
  zipPath: string,
  destDir: string,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // bsdtar (tar.exe) ships in Windows 10 1803+ and reads .zip. Faster and
    // far more robust on multi-GB archives than PowerShell Expand-Archive.
    await runCommand(window, 'tar.exe', ['-xf', zipPath, '-C', destDir], { stream: true });
  } else {
    await runCommand(window, '/usr/bin/ditto', ['-x', '-k', zipPath, destDir], { stream: true });
  }
}

/** Strip the macOS Gatekeeper quarantine xattr. No-op off macOS (Windows has
 *  no equivalent — Mark-of-the-Web doesn't block our own runtime files). */
async function stripQuarantineMac(window: BrowserWindow, target: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  await runCommand(
    window,
    '/usr/bin/xattr',
    ['-dr', 'com.apple.quarantine', target],
    { stream: true, ignoreNonZeroExit: true },
  );
}

/** Path to the venv's python interpreter for this platform. Windows venvs put
 *  it at Scripts\python.exe; POSIX at bin/python. */
function venvPythonPath(pythonEnv: string): string {
  return process.platform === 'win32'
    ? path.join(pythonEnv, 'Scripts', 'python.exe')
    : path.join(pythonEnv, 'bin', 'python');
}

/** Platform-specific soul pip requirements filename. */
function requirementsFileName(): string {
  return process.platform === 'win32' ? 'requirements-windows.txt' : 'requirements-mac.txt';
}

// ----------------------------------------------------------------------
// Tiny utilities
// ----------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}
