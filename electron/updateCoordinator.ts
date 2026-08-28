// Runtime auto-updater. Runs on every Unclaw launch AFTER setupCoordinator
// has confirmed the first-run baseline is provisioned. Compares versions in
// the locally-stored ledger (.installed-versions.json) against a remote
// manifest hosted on R2; downloads + verifies + atomically swaps any
// categories that have drifted.
//
// Designed to be NON-BLOCKING for the user:
//   * If no updates are available, returns immediately (~1 round-trip
//     latency to fetch the manifest).
//   * If an update is available, the UpdateOverlay UI shows progress and
//     the user can defer ("Update later"), only `app` updates are forced.
//   * If the remote manifest can't be fetched (offline, R2 outage), we
//     log + skip update, never block launch.
//
// Atomicity: every category write is download-to-staging → atomic rename →
// remove-old. A power cut mid-update leaves either the old version intact
// (rename hasn't happened) or the new one fully in place (rename happened).
// Never a half-written overlay.
//
// See updateManifest.ts for the category taxonomy + remote manifest schema.

import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import {
  UpdateManifest,
  UpdateCategoryId,
  InstalledVersions,
  CategoryEntry,
  FALLBACK_MANIFEST,
  REMOTE_MANIFEST_URL,
} from './updateManifest';
import {
  downloadWithResumeAndVerify,
  extractZip,
  formatBytes,
  syncSoulVenv,
} from './setupCoordinator';
import { getRuntimeDir } from './soulSupervisor';
import {
  startAppShellUpdater,
  subscribeAppShell,
  getAppShellState,
  AppShellState,
} from './appShellUpdater';

// ----------------------------------------------------------------------
// Types, IPC contract with the renderer's UpdateOverlay
// ----------------------------------------------------------------------

export interface UpdateCategoryProgress {
  id: UpdateCategoryId;
  /** 'pending' before download starts, 'downloading' / 'applying' during,
   *  'ready' when installed but waiting on the next restart, 'failed' on
   *  error. 'up-to-date' if the manifest matched the installed version
   *  and no work was needed. */
  state: 'pending' | 'downloading' | 'applying' | 'ready' | 'failed' | 'up-to-date';
  /** 0..1, or null when indeterminate (e.g. during the extract step). */
  progress: number | null;
  /** Human-readable subline. Bytes-out-of-total during download, error
   *  message on failure, etc. */
  detail?: string;
  /** Old version → new version, for the changelog row. */
  from: string | null;
  to: string;
}

export interface UpdateSnapshot {
  /** Has the post-launch update check finished? false while still
   *  fetching manifest / downloading / applying. */
  done: boolean;
  /** Per-category progress. Empty until we've fetched the manifest. */
  categories: UpdateCategoryProgress[];
  /** Set when the user must restart Unclaw to apply updates that have
   *  been downloaded but can't hot-swap (currently: all of them). */
  restartRequired: boolean;
  /** Top-line error message if the whole check bombed (e.g. no network
   *  AND no cached manifest). null on success or partial failure. */
  fatalError: string | null;
}

// ----------------------------------------------------------------------
// Module-scope state, last update result, surfaced via IPC snapshot.
// ----------------------------------------------------------------------

let snapshot: UpdateSnapshot = {
  done: false,
  categories: [],
  restartRequired: false,
  fatalError: null,
};
let inFlight = false;

function emit(window: BrowserWindow | null, channel: string, payload?: unknown): void {
  if (!window || window.isDestroyed()) return;
  if (payload === undefined) {
    window.webContents.send(channel);
  } else {
    window.webContents.send(channel, payload);
  }
}

function publish(window: BrowserWindow | null): void {
  emit(window, 'update:snapshot', snapshot);
}

export function getUpdateSnapshot(): UpdateSnapshot {
  return snapshot;
}

// ----------------------------------------------------------------------
// Paths
// ----------------------------------------------------------------------

interface UpdatePaths {
  root: string;
  ledger: string;
  staging: string;
  /** Where each category's installed artifacts live. */
  soul: string;
  unreal: string;
  assets: string;
}

function updatePaths(): UpdatePaths {
  const root = getRuntimeDir();
  return {
    root,
    ledger: path.join(root, '.installed-versions.json'),
    staging: path.join(root, 'staging'),
    // `soul` overlay, soulSupervisor.resolveSoulScript prefers this
    // directory over the DMG-bundled Resources/soul-src when present.
    soul: path.join(root, 'soul'),
    // Same paths as the setup coordinator's runStageUnreal / runStageModels , 
    // updater writes to the same locations so no migration is needed.
    unreal: path.join(root, 'unreal'),
    assets: path.join(root, 'assets'),
  };
}

function readLedger(paths: UpdatePaths): InstalledVersions {
  try {
    if (!fs.existsSync(paths.ledger)) return {};
    return JSON.parse(fs.readFileSync(paths.ledger, 'utf-8'));
  } catch {
    // Corrupted ledger, treat as empty so we re-establish ground truth.
    return {};
  }
}

function writeLedger(paths: UpdatePaths, ledger: InstalledVersions): void {
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(paths.ledger, JSON.stringify(ledger, null, 2));
}

/**
 * Undo a swap interrupted between its two renames. installCategory does
 * `rename(destDir → staging/<id>-old-<ts>)` then `rename(newDir → destDir)`;
 * a crash between them leaves destDir MISSING with the old contents parked in
 * staging. On the next launch, if a category dir is gone but a matching backup
 * survives, move the newest backup back into place so the runtime isn't left
 * with a missing soul/assets/unreal dir (the offline-safe recovery; an online
 * machine would also re-download via the dir-exists up-to-date check). Runs
 * before the staging wipe so the backup is still there. Never throws.
 */
function recoverInterruptedSwaps(paths: UpdatePaths, window: BrowserWindow | null): void {
  if (!fs.existsSync(paths.staging)) return;
  const dests: Array<[UpdateCategoryId, string]> = [
    ['soul', paths.soul], ['unreal', paths.unreal], ['assets', paths.assets],
  ];
  let entries: string[];
  try { entries = fs.readdirSync(paths.staging); } catch { return; }
  for (const [id, destDir] of dests) {
    if (fs.existsSync(destDir)) continue; // dir intact, nothing to recover
    // Backups are named `<id>-old-<timestamp>`; newest timestamp wins.
    const backups = entries
      .filter((n) => n.startsWith(`${id}-old-`))
      .sort();
    const newest = backups[backups.length - 1];
    if (!newest) continue;
    try {
      fs.renameSync(path.join(paths.staging, newest), destDir);
      emit(window, 'update:log',
        `[updater/${id}] recovered interrupted swap: restored ${newest} → ${path.basename(destDir)}`);
    } catch (err) {
      emit(window, 'update:log',
        `[updater/${id}] could not restore interrupted swap: ${(err as Error).message}`);
    }
  }
}

// ----------------------------------------------------------------------
// Manifest fetch
// ----------------------------------------------------------------------

async function fetchRemoteManifest(window: BrowserWindow | null): Promise<UpdateManifest> {
  // Cache-bust with timestamp so a stale R2 edge entry never blocks us
  // from seeing a freshly-published manifest. Cheap.
  const url = `${REMOTE_MANIFEST_URL}?t=${Date.now()}`;
  const body = await new Promise<string>((resolve, reject) => {
    const req = https.get(url, { headers: {
      'User-Agent': `Unclaw-Mac-Updater/${app.getVersion()}`,
      'Cache-Control': 'no-cache',
    } }, (res) => {
      // Follow redirects (R2 may issue 301/302).
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const followUrl = res.headers.location;
        const follow = https.get(followUrl, (res2) => {
          if (res2.statusCode !== 200) {
            res2.resume();
            reject(new Error(`HTTP ${res2.statusCode} fetching manifest (after redirect)`));
            return;
          }
          let buf = '';
          res2.on('data', (c) => (buf += c.toString()));
          res2.on('end', () => resolve(buf));
          res2.on('error', reject);
        }).on('error', reject);
        // Same timeout the first leg has. Without it a stalled redirect
        // target left the promise unsettled forever: inFlight stayed true
        // and the update overlay never dismissed for the whole session.
        follow.setTimeout(15_000, () => follow.destroy(new Error('manifest fetch timeout (after redirect)')));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching manifest`));
        return;
      }
      let buf = '';
      res.on('data', (c) => (buf += c.toString()));
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error('manifest fetch timeout after 15s'));
    });
  });

  let parsed: UpdateManifest;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`manifest is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed.manifestVersion !== 'number' || !parsed.categories) {
    throw new Error('manifest missing required fields (manifestVersion, categories)');
  }
  emit(window, 'update:log',
    `[updater] manifest v${parsed.manifestVersion} fetched (` +
    `${Object.keys(parsed.categories).length} categories)`);
  return parsed;
}

// ----------------------------------------------------------------------
// Per-category install logic
// ----------------------------------------------------------------------

function setCategory(
  window: BrowserWindow | null,
  id: UpdateCategoryId,
  update: Partial<UpdateCategoryProgress>,
): void {
  const idx = snapshot.categories.findIndex((c) => c.id === id);
  if (idx < 0) return;
  snapshot.categories[idx] = { ...snapshot.categories[idx], ...update };
  publish(window);
}

/**
 * Translate Squirrel state into our per-category snapshot model. Called on
 * subscribe + on every electron-updater event so the `app` row reflects the
 * latest known state without duplicating logic.
 */
function mirrorAppShellIntoSnapshot(
  state: AppShellState,
  window: BrowserWindow | null,
): void {
  const mapped: UpdateCategoryProgress = {
    id: 'app',
    state:
      state.state === 'idle' || state.state === 'checking' ? 'pending'
      : state.state === 'available' || state.state === 'downloading' ? 'downloading'
      : state.state === 'ready' ? 'ready'
      : state.state === 'up-to-date' ? 'up-to-date'
      : 'failed',
    progress: state.progressPct,
    detail: state.detail ?? undefined,
    from: state.installedVersion,
    to: state.remoteVersion ?? state.installedVersion,
  };
  const existing = snapshot.categories.findIndex((c) => c.id === 'app');
  if (existing < 0) {
    snapshot.categories.unshift(mapped);
  } else {
    snapshot.categories[existing] = mapped;
  }
  // If Squirrel has staged an app-shell update, surface the global
  // restart prompt, the user clicking "Restart now" calls
  // autoUpdater.quitAndInstall() so Squirrel actually swaps the bundle.
  if (mapped.state === 'ready') {
    snapshot.restartRequired = true;
  }
  publish(window);
}

async function installCategory(
  window: BrowserWindow | null,
  paths: UpdatePaths,
  id: UpdateCategoryId,
  entry: CategoryEntry,
  ledger: InstalledVersions,
): Promise<{ soulRequirementsSha?: string }> {
  if (id === 'app') {
    // electron-updater owns the app shell category. The app-shell state
    // bridge (subscribed in runUpdateCheck) mirrors Squirrel's events
    // into the snapshot's `app` row, nothing for us to do here.
    return {};
  }

  const destDir = id === 'soul' ? paths.soul
    : id === 'unreal' ? paths.unreal
    : paths.assets;

  fs.mkdirSync(paths.staging, { recursive: true });
  const stagingZip = path.join(paths.staging, `${id}-${entry.version}.zip`);

  setCategory(window, id, { state: 'downloading', progress: 0 });
  await downloadWithResumeAndVerify(
    window!,
    {
      url: entry.url,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    },
    stagingZip,
    (downloaded, total) => {
      setCategory(window, id, {
        state: 'downloading',
        progress: total > 0 ? downloaded / total : null,
        detail: `${formatBytes(downloaded)} / ${formatBytes(total)}`,
      });
    },
  );

  setCategory(window, id, { state: 'applying', progress: null, detail: 'Unpacking…' });

  // Extract to a sibling staging dir, then atomically swap. Never extract
  // straight into destDir, a crash mid-extract would leave the install
  // half-written with the old contents partially overwritten.
  const newDir = path.join(paths.staging, `${id}-${entry.version}-extracted`);
  if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true });
  fs.mkdirSync(newDir, { recursive: true });

  await extractZip(window!, stagingZip, newDir);

  // Atomic swap. macOS rename(2) is atomic within a filesystem; both
  // directories are under the same userData volume so we're safe.
  const oldBackup = path.join(paths.staging, `${id}-old-${Date.now()}`);
  if (fs.existsSync(destDir)) {
    fs.renameSync(destDir, oldBackup);
  }
  try {
    fs.renameSync(newDir, destDir);
  } catch (err) {
    // Rollback: restore the old dir so we're not stranded.
    if (fs.existsSync(oldBackup)) fs.renameSync(oldBackup, destDir);
    throw err;
  }

  // Old version + downloaded zip → garbage. Best-effort; if cleanup
  // fails (file locked, etc.) we don't care, staging is wiped on next
  // launch anyway.
  try {
    if (fs.existsSync(oldBackup)) fs.rmSync(oldBackup, { recursive: true, force: true });
    if (fs.existsSync(stagingZip)) fs.unlinkSync(stagingZip);
  } catch (err) {
    emit(window, 'update:log',
      `[updater/${id}] cleanup warning: ${(err as Error).message}`);
  }

  // For the `soul` overlay, re-sync the venv against the newly-shipped
  // requirements-mac.txt. Cheap (~5s) when reqs unchanged, full pip
  // install when they did. Without this, a soul update that added a
  // pip dep (e.g. mlx-whisper replacing useful-moonshine-onnx in the
  // 2026-05-27 STT swap) would land the new source but never install
  // the new package, breaking `import mlx_whisper` at runtime.
  let soulRequirementsSha: string | undefined;
  if (id === 'soul') {
    setCategory(window, id, {
      state: 'applying',
      progress: null,
      detail: 'Syncing Python packages…',
    });
    try {
      const syncResult = await syncSoulVenv(
        window, destDir,
        ledger.soul_requirements_sha ?? null,
      );
      if (syncResult.sha) {
        soulRequirementsSha = syncResult.sha;
      }
    } catch (err) {
      // pip-sync failure is NOT fatal to the soul update, the new
      // source code is already installed. Surface the warning but
      // leave the ledger SHA un-updated so we retry on next cycle.
      // Runtime imports of the new dep will lazy-fail with a clear
      // ImportError until pip-sync succeeds.
      const msg = (err as Error).message;
      emit(window, 'update:log',
        `[updater/${id}] venv-sync warning: ${msg}, keeping previous requirements sha`);
    }
  }

  setCategory(window, id, {
    state: 'ready',
    progress: 1,
    detail: `Installed ${entry.version}. Restart Unclaw to apply.`,
  });
  return { soulRequirementsSha };
}

// ----------------------------------------------------------------------
// Entrypoint
// ----------------------------------------------------------------------

/**
 * Run the post-launch update check. Resolves with a snapshot describing
 * what (if anything) was installed and whether a restart is needed.
 *
 * Safe to call multiple times, second call returns the cached snapshot
 * if one is already in flight or done for this session.
 */
export async function runUpdateCheck(window: BrowserWindow | null): Promise<UpdateSnapshot> {
  if (!app.isPackaged) {
    // Dev runs always use the sibling repos, never auto-update.
    snapshot = {
      done: true, categories: [], restartRequired: false, fatalError: null,
    };
    publish(window);
    return snapshot;
  }
  if (inFlight) return snapshot;
  if (snapshot.done) return snapshot;
  inFlight = true;

  try {
    const paths = updatePaths();

    // Kick the electron-updater bridge. Squirrel runs its check in the
    // background and pushes state via the appShellUpdater subscription
    // below; we don't block on it here.
    startAppShellUpdater(window);
    let appShellSettled = false;
    const unsubAppShell = subscribeAppShell((state) => {
      mirrorAppShellIntoSnapshot(state, window);
      // Release the mirror only once Squirrel reaches a TERMINAL state, NOT on a
      // fixed timer. A >60s app-shell download used to get orphaned mid-
      // 'downloading' when the old 60s unsubscribe fired, freezing the `app` row
      // non-terminal so UpdateOverlay never dismissed (force-quit required).
      if (!appShellSettled &&
          (state.state === 'ready' || state.state === 'up-to-date' || state.state === 'failed')) {
        appShellSettled = true;
        unsubAppShell();
      }
    });
    // Seed the snapshot's `app` row immediately so the UI shows it as
    // 'checking' rather than missing entirely while Squirrel's first
    // event lands.
    mirrorAppShellIntoSnapshot(getAppShellState(), window);
    // Backstop so a silent Squirrel (network vanished mid-check, no terminal
    // event ever fires) can't leak the listener forever. Generous , this is a
    // safety net, not the primary release path (terminal-state is).
    setTimeout(() => {
      if (!appShellSettled) { appShellSettled = true; unsubAppShell(); }
    }, 30 * 60_000);

    // Recover from a swap that was interrupted between its two renames (dest →
    // backup, new → dest): the category dir is missing but its `<id>-old-<ts>`
    // backup still sits in staging. Restore the newest backup BEFORE we wipe
    // staging, so an offline machine (that can't re-download) isn't left with a
    // missing runtime dir. Must run before the wipe below or the backup is lost.
    recoverInterruptedSwaps(paths, window);

    // Wipe any stale staging from a prior partial update, a crash mid-
    // download/extract could have left junk that we don't need anymore
    // (atomic rename means whatever's in the dest dir is canonical; any
    // recoverable backup was just restored above).
    try {
      if (fs.existsSync(paths.staging)) {
        fs.rmSync(paths.staging, { recursive: true, force: true });
      }
    } catch (err) {
      emit(window, 'update:log',
        `[updater] staging cleanup warning: ${(err as Error).message}`);
    }

    let manifest: UpdateManifest;
    try {
      manifest = await fetchRemoteManifest(window);
    } catch (err) {
      const msg = (err as Error).message;
      emit(window, 'update:log',
        `[updater] manifest fetch failed: ${msg}, proceeding with installed versions`);
      manifest = FALLBACK_MANIFEST;
    }

    const ledger = readLedger(paths);
    // Reflect the current app shell version (Squirrel may have bumped it
    // since the last write) so the ledger stays accurate.
    ledger.app = app.getVersion();

    const work: Array<{ id: UpdateCategoryId; entry: CategoryEntry }> = [];
    // The app shell is owned EXCLUSIVELY by electron-updater (Squirrel). Its
    // snapshot row is driven by the app-shell state bridge, NOT the manifest.
    // Drop any `app` entry here so a stale/older `app` version in the remote
    // manifest can never be marked "pending" — that mismatch (installed app
    // newer than the manifest advertised) caused a permanent
    // "updates ready / restart required" loop.
    const cats = (Object.entries(manifest.categories) as Array<[UpdateCategoryId, CategoryEntry]>)
      .filter(([id]) => id !== 'app');
    for (const [id, entry] of cats) {
      const installed = ledger[id];
      const destDir = id === 'soul' ? paths.soul
        : id === 'unreal' ? paths.unreal
        : paths.assets;
      // Up to date when we already hold this exact version AND the artifacts are
      // actually on disk. The dir-exists check is the self-heal: if a prior swap
      // was interrupted between the two renames (dest moved to backup, new not
      // yet in place), the category dir is GONE but the ledger still reads
      // "installed" , without this we'd skip it forever and boot a runtime with a
      // missing soul/assets/unreal dir. Defensive on the version too: treat an
      // installed tag at/after the manifest's as current (date-style tags sort
      // lexicographically) so a stale manifest can't force perpetual re-download.
      const upToDate =
        installed != null && installed >= entry.version && fs.existsSync(destDir);
      snapshot.categories.push({
        id,
        state: upToDate ? 'up-to-date' : 'pending',
        progress: upToDate ? 1 : 0,
        from: installed ?? null,
        to: entry.version,
        detail: upToDate ? `Up to date (${entry.version})` : `Update available: ${entry.version}`,
      });
      if (!upToDate) work.push({ id, entry });
    }
    publish(window);

    // Install in priority order: app first (informational), then soul
    // (smallest, fastest), then assets, then unreal (biggest, slowest).
    // Lets the user see early progress quickly.
    const priority: UpdateCategoryId[] = ['app', 'soul', 'assets', 'unreal'];
    work.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));

    let needsRestart = false;
    for (const { id, entry } of work) {
      try {
        const result = await installCategory(window, paths, id, entry, ledger);
        ledger[id] = entry.version;
        if (result.soulRequirementsSha) {
          ledger.soul_requirements_sha = result.soulRequirementsSha;
        }
        writeLedger(paths, ledger);
        if (entry.globalRestartRequired) needsRestart = true;
      } catch (err) {
        const msg = (err as Error).message;
        emit(window, 'update:log',
          `[updater/${id}] install failed: ${msg}, keeping installed version ${ledger[id] ?? '(none)'}`);
        setCategory(window, id, {
          state: 'failed',
          progress: null,
          detail: msg,
        });
        // Don't abort, try the remaining categories. A failed unreal
        // shouldn't block a smaller soul update from landing.
      }
    }

    snapshot.restartRequired = needsRestart;
    snapshot.done = true;
    publish(window);
    return snapshot;
  } catch (err) {
    snapshot.fatalError = (err as Error).message;
    snapshot.done = true;
    publish(window);
    return snapshot;
  } finally {
    inFlight = false;
  }
}
