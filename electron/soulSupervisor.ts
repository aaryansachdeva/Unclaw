// Soul subprocess supervisor — the Electron main side of the
// "launching Unclaw also launches soul" flow.
//
// What this module does:
//   * On app start, check whether a soul instance is already serving
//     127.0.0.1:8765/health (e.g. the user is running it in a terminal
//     for dev). If yes, attach to it — don't spawn a duplicate.
//   * Otherwise spawn `bash run_soul.sh` as a child process. Set
//     start_new_session=True equivalent so killing soul also kills the
//     UE child it spawns.
//   * Stream every stdout/stderr line through IPC to the renderer
//     ('soul:log' channel) so the LoadingScreen can show real-time
//     boot progress (mlx model loads, MCP server connections, signaling
//     server startup, "[soul] READY" banner).
//   * Detect the "[soul] READY" marker line and fire 'soul:ready' once.
//     The renderer dismisses the LoadingScreen on that event and only
//     then mounts <usePixelStreaming>, which connects to soul's
//     signaling endpoint at ws://localhost:8080.
//   * On app quit, SIGTERM the soul child (which propagates to UE).
//
// Path resolution: in dev, electron-vite runs `electron .` with cwd at
// the project root, so `app.getAppPath()` returns `.../UnClaw`. Soul
// lives at `../soul/run_soul.sh` relative to that. In packaged builds
// (later) we'll bundle a wrapper; for now this is dev-only.

import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import http from 'http';

const SOUL_HEALTH_URL = 'http://127.0.0.1:8765/health';
const SOUL_HEALTH_TIMEOUT_MS = 1200;
// Marker soul prints once everything is up (the actual line is:
// "[soul] READY  —  listening on 127.0.0.1:8765"). We match a substring
// so a future banner tweak doesn't break the gate as long as the word
// "READY" still appears.
const SOUL_READY_MARKER = '[soul] READY';

let soulProc: ChildProcess | null = null;
let alreadyReadyFired = false;

interface LogPayload {
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
}

// Ring buffer of recent log lines + ready flag so the renderer can
// REPLAY current state on mount. Without this, if the user refreshes
// the renderer mid-session (Cmd-R, hot reload, or after a UE crash
// when they refresh to recover) the freshly mounted boot screen sees
// none of the events that already fired — it sits forever on
// "listening for soul…". The boot screen calls getSoulSnapshot() at
// mount time, hydrates from the snapshot, and THEN starts listening
// for new lines via the IPC channel. No event-replay race.
const RECENT_LOG_BUFFER = 200;
const recentLogs: LogPayload[] = [];
let soulIsReady = false;
let soulSpawnAt: number | null = null;

export function getSoulSnapshot(): {
  ready: boolean;
  recentLogs: LogPayload[];
  elapsedMs: number;
} {
  return {
    ready: soulIsReady,
    recentLogs: recentLogs.slice(),
    elapsedMs: soulSpawnAt ? Date.now() - soulSpawnAt : 0,
  };
}

function emit(window: BrowserWindow, channel: string, payload?: unknown): void {
  if (window.isDestroyed()) return;
  if (payload === undefined) {
    window.webContents.send(channel);
  } else {
    window.webContents.send(channel, payload);
  }
}

function log(window: BrowserWindow, stream: LogPayload['stream'], line: string): void {
  const payload = { stream, line };
  // Buffer for replay on renderer mount/refresh.
  recentLogs.push(payload);
  if (recentLogs.length > RECENT_LOG_BUFFER) recentLogs.shift();
  emit(window, 'soul:log', payload);
}

function maybeFireReady(window: BrowserWindow, line: string): void {
  if (alreadyReadyFired) return;
  if (line.includes(SOUL_READY_MARKER)) {
    alreadyReadyFired = true;
    soulIsReady = true;
    emit(window, 'soul:ready');
  }
}

/**
 * Quick TCP probe for an existing soul. Used to decide whether to
 * spawn a new instance or attach to one the user is running externally
 * (e.g. `./run_soul.sh` in a terminal during development).
 */
function probeExistingSoul(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(SOUL_HEALTH_URL, { timeout: SOUL_HEALTH_TIMEOUT_MS }, (res) => {
      // Any 2xx counts. Drain + discard the body.
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * The packaged-install runtime root — everything the user downloaded on
 * first launch lives under here. Mirrors the Windows
 * `%LOCALAPPDATA%\Unclaw-Soul\_runtime\` layout.
 *
 *   runtime/python-env/                — uv-managed venv
 *   runtime/assets/{Audio2Lipsync,...} — downloaded model code + checkpoints
 *   runtime/unreal/Unclaw Character.app — downloaded UE Shipping build
 *   runtime/data/                      — soul runtime data (reminders,
 *                                          memory, crash dumps)
 *   runtime/.setup-complete            — idempotent first-run gate
 */
export function getRuntimeDir(): string {
  return path.join(app.getPath('userData'), 'runtime');
}

function isPackagedSetupComplete(): boolean {
  if (!app.isPackaged) return true; // dev runs always have a working repo
  try {
    const fs = require('fs') as typeof import('fs');
    return fs.existsSync(path.join(getRuntimeDir(), '.setup-complete'));
  } catch {
    return false;
  }
}

/**
 * Resolve `run_soul.sh` on disk. Order of precedence:
 *   1. UNCLAW_SOUL_REPO env override (for dev pointing at a non-sibling soul)
 *   2. Packaged build — Resources/soul-src/run_soul.sh inside the .app
 *   3. Dev — walk up from app path looking for a sibling soul/ checkout
 */
function resolveSoulScript(): { script: string; cwd: string } | null {
  const fs = require('fs') as typeof import('fs');
  const override = process.env.UNCLAW_SOUL_REPO;
  if (override) {
    return { script: path.join(override, 'run_soul.sh'), cwd: override };
  }
  // Packaged: Electron stages extraResources at process.resourcesPath
  // (= <App>.app/Contents/Resources/ on macOS, Resources\ on Windows).
  // package.json maps `../soul → soul-src`, so this is the install path.
  if (app.isPackaged) {
    const packagedDir = path.join(process.resourcesPath, 'soul-src');
    const script = path.join(packagedDir, 'run_soul.sh');
    if (fs.existsSync(script)) {
      return { script, cwd: packagedDir };
    }
  }
  // Dev: <something>/Unclaw-Mac/UnClaw/ → walk to sibling /soul/
  const appPath = app.getAppPath();
  const candidates = [
    path.resolve(appPath, '..', 'soul'),
    path.resolve(appPath, '..', '..', 'soul'),
    path.resolve(process.cwd(), '..', 'soul'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'run_soul.sh'))) {
        return { script: path.join(dir, 'run_soul.sh'), cwd: dir };
      }
    } catch { /* try next */ }
  }
  return null;
}

function spawnSoul(window: BrowserWindow): boolean {
  const resolved = resolveSoulScript();
  if (!resolved) {
    log(window, 'meta',
      '[unclaw] could not locate soul/run_soul.sh — set UNCLAW_SOUL_REPO to ' +
      'the absolute path of your soul checkout');
    return false;
  }

  log(window, 'meta', `[unclaw] launching soul: ${resolved.script}`);

  // PATH augmentation: Electron's process inherits an inert PATH that
  // typically lacks /opt/homebrew/bin (where node, npm, uv live). Soul's
  // MCP servers spawn npx-based packages and would ENOENT without this
  // (same bug we fixed inside soul itself for its own MCP spawns).
  // Pass the full inherited env plus the dev defaults so soul behaves
  // exactly like a terminal-launched `./run_soul.sh` invocation.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    UNCLAW_UE_RES_AUTO: process.env.UNCLAW_UE_RES_AUTO ?? '1',
    PATH: [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH ?? '',
    ].filter(Boolean).join(':'),
  };

  // Packaged-install env. The setup wizard provisions
  //   <userData>/runtime/{python-env, assets, unreal, data}/
  // on first launch and writes <userData>/runtime/.setup-complete when
  // done. run_soul.sh's UNCLAW_PACKAGED=1 branch reads these env vars
  // instead of walking sibling repos.
  if (app.isPackaged) {
    const runtime = getRuntimeDir();
    const ueApp = path.join(runtime, 'unreal', 'Unclaw Character.app');
    childEnv.UNCLAW_PACKAGED = '1';
    childEnv.UNCLAW_PYTHON_ENV = path.join(runtime, 'python-env');
    childEnv.UNCLAW_ASSETS_DIR = path.join(runtime, 'assets');
    childEnv.UNCLAW_DATA_DIR = path.join(runtime, 'data');
    childEnv.UNCLAW_UE_APP = ueApp;
    // soul.cli imports the `soul` package by name; PYTHONPATH points at
    // the dir CONTAINING it. In packaged installs that's
    // Resources/soul-src/ (run_soul.sh re-exports it from its own
    // location, but setting it here too is harmless and survives any
    // child the script might spawn before the export line runs).
    childEnv.PYTHONPATH = [
      resolved.cwd,
      childEnv.PYTHONPATH ?? '',
    ].filter(Boolean).join(':');
  }

  try {
    soulProc = spawn('bash', [resolved.script], {
      cwd: resolved.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached:true makes the child a process-group leader on Unix
      // (via setsid()). The whole bash → soul → UE tree shares that
      // group, so we can take it down with a single `kill(-pid, ...)`
      // in stopSoul. Without this, killing only the bash PID leaves
      // grand-children (notably UE, which soul spawns in its own
      // session) orphaned to launchd.
      //
      // Critically: we do NOT call soulProc.unref() — that would
      // tell Electron not to wait on the child during shutdown, and
      // we explicitly DO want stopSoul() to control the lifecycle.
      detached: true,
    });
  } catch (err) {
    log(window, 'meta', `[unclaw] spawn failed: ${(err as Error).message}`);
    return false;
  }

  // Persistent on-disk log file in addition to the in-memory IPC stream.
  // Without this, when something breaks on a user's machine we can't ask
  // them to send logs — the IPC ring buffer only survives until the
  // Electron window closes. Daily-rotated to keep size manageable; old
  // files stay around for retrospective debug. Path mirrors the runtime
  // dir convention so support paths are uniform.
  const fs = require('fs') as typeof import('fs');
  const logsDir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch { /* ok */ }
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logFilePath = path.join(logsDir, `soul-${dateStr}.log`);
  let logFileStream: import('fs').WriteStream | null = null;
  try {
    logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logFileStream.write(
      `\n=== soul spawn @ ${new Date().toISOString()} (pid=${soulProc.pid}) ===\n`,
    );
    log(window, 'meta', `[unclaw] tee soul stdout/stderr to ${logFilePath}`);
  } catch (err) {
    log(window, 'meta', `[unclaw] could not open log file ${logFilePath}: ${(err as Error).message}`);
  }

  const onChunk = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    // Tee the raw chunk to disk before line-splitting so multi-line stack
    // traces stay grouped and timestamps interleave correctly.
    if (logFileStream) {
      try { logFileStream.write(`[${stream}] ${text}`); } catch { /* eof / closed */ }
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\r/g, '');
      if (!line) continue;
      log(window, stream, line);
      maybeFireReady(window, line);
    }
  };

  soulProc.stdout?.on('data', onChunk('stdout'));
  soulProc.stderr?.on('data', onChunk('stderr'));

  soulProc.on('exit', (code, signal) => {
    log(window, 'meta', `[unclaw] soul exited (code=${code} signal=${signal})`);
    if (logFileStream) {
      try {
        logFileStream.write(
          `=== soul exited (code=${code} signal=${signal}) @ ${new Date().toISOString()} ===\n`,
        );
        logFileStream.end();
      } catch { /* ok */ }
      logFileStream = null;
    }
    emit(window, 'soul:exit', { code, signal });
    soulProc = null;
  });
  soulProc.on('error', (err) => {
    log(window, 'meta', `[unclaw] soul error: ${err.message}`);
  });

  return true;
}

/**
 * Public entry point: call once after the main BrowserWindow is open
 * but before the renderer needs the stream. Handles both the
 * "external soul running" path (attach + immediate ready) and the
 * "no soul yet" path (spawn + wait for the READY marker).
 */
export async function startSoul(window: BrowserWindow): Promise<void> {
  alreadyReadyFired = false;
  soulIsReady = false;
  recentLogs.length = 0;
  soulSpawnAt = Date.now();

  // In packaged builds, refuse to spawn until the first-run wizard has
  // provisioned the runtime (python-env, downloaded UE app, downloaded
  // assets). The renderer's App.tsx gates on the same .setup-complete
  // marker via setup:get-status and shows <SetupWizard> first; the
  // wizard explicitly re-invokes startSoul() once it finishes. Without
  // this guard, an early auto-spawn would race the wizard and crash
  // soul with missing python-env / missing PYTHONPATH errors.
  if (!isPackagedSetupComplete()) {
    log(window, 'meta',
      '[unclaw] first-run setup not yet complete — deferring soul spawn ' +
      'until SetupWizard finishes');
    return;
  }

  const existing = await probeExistingSoul();
  if (existing) {
    log(window, 'meta', '[unclaw] soul already running externally — attaching');
    alreadyReadyFired = true;
    // Short tick so renderer has time to mount its log subscription
    // before the ready event fires. Otherwise the LoadingScreen never
    // sees 'soul:ready' and gets stuck.
    setTimeout(() => emit(window, 'soul:ready'), 100);
    return;
  }
  spawnSoul(window);
}

/**
 * Kill the spawned soul + everything it spawned (UE, MCP subprocesses)
 * on app quit. Idempotent. If soul was attached externally, this is a
 * no-op — the user owns that process.
 *
 * Strategy:
 *   1. Negative-PID SIGTERM addresses the entire process group, so soul,
 *      bash, UE, and any in-flight MCP npx children get the signal at
 *      once. Without the group-kill, killing only the bash PID can
 *      leave UE running as an orphan (soul spawns UE in its own session
 *      via start_new_session=True so it's not in bash's immediate
 *      hierarchy for signal forwarding).
 *   2. Give the group ~2s to shut down gracefully (soul's FastAPI
 *      shutdown hook unwinds MCP sessions + the UE supervisor's stop()
 *      method does its own SIGTERM on UE).
 *   3. Negative-PID SIGKILL the survivors. By that point anything still
 *      breathing is wedged — better to force-quit than leak processes
 *      across app sessions.
 *
 * Called synchronously from the `will-quit` hook, so we can't await —
 * the SIGKILL fallback runs after a setTimeout that may not complete
 * before app exit on a fast user quit. That's acceptable: SIGKILL on
 * a process group with no parent left over is the OS's job at that
 * point (launchd cleans up orphans whose group leader is gone).
 */
export function stopSoul(): void {
  if (!soulProc) return;
  const pid = soulProc.pid;
  soulProc = null;
  if (pid === undefined) return;

  const killGroup = (sig: NodeJS.Signals) => {
    try {
      // Negative PID = "send to process group whose leader is |pid|".
      // Requires the child to have been spawned with detached:true so
      // it's actually a group leader.
      process.kill(-pid, sig);
    } catch {
      // ESRCH (no such process) is fine — already exited.
    }
  };

  killGroup('SIGTERM');
  setTimeout(() => killGroup('SIGKILL'), 2000);
}
