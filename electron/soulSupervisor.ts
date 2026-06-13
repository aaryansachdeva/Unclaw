// Soul subprocess supervisor, the Electron main side of the
// "launching Unclaw also launches soul" flow.
//
// What this module does:
//   * On app start, check whether a soul instance is already serving
//     127.0.0.1:8765/health (e.g. the user is running it in a terminal
//     for dev). If yes, attach to it, don't spawn a duplicate.
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
import { spawn, ChildProcess, execFile } from 'child_process';
import path from 'path';
import http from 'http';

// Platform split. On Windows soul is launched via `powershell run_soul.ps1`
// and the process tree is reaped with `taskkill /T /F` (no POSIX process
// groups); on macOS/Linux it's `bash run_soul.sh` + negative-PID signals.
const IS_WINDOWS = process.platform === 'win32';
const SOUL_SCRIPT = IS_WINDOWS ? 'run_soul.ps1' : 'run_soul.sh';

// Legacy/fallback port for external-soul probing. When the user runs
// soul standalone in a terminal and we attach to it, we don't know
// which port it picked; ports.json is the canonical discovery path,
// this fallback covers the case where the file is missing/stale and
// the user explicitly pinned --port 8765.
const SOUL_LEGACY_HTTP_PORT = 8765;
const SOUL_HEALTH_TIMEOUT_MS = 1200;
// --- Boot resilience knobs ---------------------------------------------
// The READY marker is the FAST path to "soul is up", but it's a single
// point of failure: if soul never prints it (a hung/crashing startup hook,
// a slow first-run model load that the user kills, or stdout buffering),
// the renderer would otherwise sit on the boot screen forever. These add a
// health-poll fallback, crash-respawn, and a hard timeout so the boot
// either succeeds or surfaces an actionable error, never hangs.
//
// How long we poll /health as a fallback path to "ready" (independent of
// the stdout marker). Cheap loopback GET.
const SOUL_HEALTH_POLL_MS = 1500;
// Total automatic respawns within one boot episode before we give up and
// surface a failure. Self-heals transient first-run crashes (OOM on first
// model load, a flaky import) without looping forever.
const MAX_SOUL_RESPAWNS = 3;
// Backoff between respawns (indexed by attempt-1), capped.
const SOUL_RESPAWN_BACKOFF_MS = [1500, 3000, 6000];
// Hard ceiling for the whole boot episode. Generous because a cold first
// run loads several models (lipsync + t2f) from disk before READY. If
// neither the marker nor /health confirms within this window, we declare
// failure rather than spin. Spans respawns (one overall budget).
const SOUL_BOOT_TIMEOUT_MS = 150_000;
// If soul stays ready this long, reset the respawn counter so a much-later
// crash gets a fresh retry budget (without letting a ready→crash loop reset
// it every cycle).
const SOUL_STABLE_MS = 30_000;
// Marker soul prints once everything is up (the actual line is:
// "[soul] READY ,  listening on 127.0.0.1:NNNN"). Substring match so
// future banner tweaks don't break the gate as long as "READY" appears.
const SOUL_READY_MARKER = '[soul] READY';
// Ports banner, soul prints this BEFORE the READY marker (declared
// after _signalling_startup in server.py). Format is stable:
//   "[ports] http=NNNN streamer=NNNN player=NNNN"
const SOUL_PORTS_RE =
  /\[ports\] http=(\d+) streamer=(\d+) player=(\d+)/;

export interface SoulPorts {
  http: number;
  signallingStreamer: number;
  signallingPlayer: number;
}

let soulProc: ChildProcess | null = null;
let alreadyReadyFired = false;
let livePorts: SoulPorts | null = null;

// --- Boot resilience state ---------------------------------------------
let respawnAttempts = 0;            // respawns used in the current boot episode
let intentionalStop = false;        // set by stopSoul() so quit/restart don't respawn
let bootTimer: ReturnType<typeof setTimeout> | null = null;   // overall boot watchdog
let healthTimer: ReturnType<typeof setInterval> | null = null; // /health fallback poll
let stableTimer: ReturnType<typeof setTimeout> | null = null;  // ready-stability timer
let bootFailed = false;             // latched once we surface soul:failed

interface LogPayload {
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
}

// Ring buffer of recent log lines + ready flag so the renderer can
// REPLAY current state on mount. Without this, if the user refreshes
// the renderer mid-session (Cmd-R, hot reload, or after a UE crash
// when they refresh to recover) the freshly mounted boot screen sees
// none of the events that already fired, it sits forever on
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
  ports: SoulPorts | null;
  failed: boolean;
} {
  return {
    ready: soulIsReady,
    recentLogs: recentLogs.slice(),
    elapsedMs: soulSpawnAt ? Date.now() - soulSpawnAt : 0,
    ports: livePorts,
    failed: bootFailed,
  };
}

// ----------------------------------------------------------------------
// Boot resilience: a single source of truth for "soul became ready",
// reached via EITHER the stdout marker OR a /health probe, so a missed/
// unflushed marker line can't strand the boot. Idempotent.
// ----------------------------------------------------------------------

function clearHealthPoll(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}
function clearBootTimers(): void {
  clearHealthPoll();
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
}

function markReady(window: BrowserWindow, via: 'marker' | 'health'): void {
  if (soulIsReady) return;
  alreadyReadyFired = true;
  soulIsReady = true;
  bootFailed = false;
  clearBootTimers();
  if (via === 'health') {
    log(window, 'meta', '[unclaw] soul confirmed ready via /health (marker not seen yet)');
  }
  emit(window, 'soul:ready');
  // If soul stays up this long, hand back a fresh respawn budget so a
  // much-later crash isn't starved by boot-time retries — but a rapid
  // ready→crash loop (crash before this fires) keeps the spent budget.
  if (stableTimer) clearTimeout(stableTimer);
  stableTimer = setTimeout(() => {
    if (soulIsReady) respawnAttempts = 0;
  }, SOUL_STABLE_MS);
}

/** Poll soul's /health on the best-known port until it answers 200, then
 *  mark ready. Runs alongside the marker path; whichever lands first wins. */
function startHealthPoll(window: BrowserWindow): void {
  clearHealthPoll();
  healthTimer = setInterval(() => {
    if (soulIsReady || bootFailed) { clearHealthPoll(); return; }
    const port = livePorts?.http ?? readPortsJson()?.http ?? SOUL_LEGACY_HTTP_PORT;
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: SOUL_HEALTH_TIMEOUT_MS },
      (res) => {
        res.resume();
        if (res.statusCode === 200) markReady(window, 'health');
      },
    );
    req.on('error', () => { /* not up yet */ });
    req.on('timeout', () => req.destroy());
  }, SOUL_HEALTH_POLL_MS);
}

/** Surface an unrecoverable boot failure to the renderer (instead of an
 *  infinite spinner). Carries the recent stderr tail so the UI can show a
 *  real reason + a "view logs" affordance. */
function handleBootFailure(window: BrowserWindow, reason: string): void {
  if (soulIsReady) return; // we made it after all; ignore late failure signals
  bootFailed = true;
  clearBootTimers();
  const errTail = recentLogs
    .filter((l) => l.stream === 'stderr' || l.stream === 'meta')
    .slice(-12)
    .map((l) => l.line);
  log(window, 'meta', `[unclaw] soul boot FAILED: ${reason}`);
  emit(window, 'soul:failed', { reason, recentErrors: errTail });
}

/** Live ports soul is bound to. Null until the [ports] banner has been
 *  parsed (or ports.json read for an external-attach soul). Consumers
 *  should treat the null window as "soul is booting" and wait for the
 *  'soul:ports' event before constructing URLs. */
export function getSoulPorts(): SoulPorts | null {
  return livePorts;
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
  if (line.includes(SOUL_READY_MARKER)) markReady(window, 'marker');
}

function maybeParsePorts(window: BrowserWindow, line: string): void {
  // Parse exactly once per soul session, the banner is printed by the
  // _announce_ports_startup hook, which fires once during startup.
  if (livePorts !== null) return;
  const m = line.match(SOUL_PORTS_RE);
  if (!m) return;
  livePorts = {
    http: parseInt(m[1], 10),
    signallingStreamer: parseInt(m[2], 10),
    signallingPlayer: parseInt(m[3], 10),
  };
  emit(window, 'soul:ports', livePorts);
}

/**
 * Resolve the data dir soul writes ports.json into. Mirrors the precedence
 * run_soul.sh applies: packaged install uses <userData>/runtime/data,
 * dev falls back to the repo's soul/data/. Both paths are computed
 * statically, no IPC, no async, so this is safe to call before soul boots.
 * Exported so the character-voice install lands in the exact dir soul reads.
 */
export function getSoulDataDir(): string {
  if (app.isPackaged) {
    return path.join(getRuntimeDir(), 'data');
  }
  // Dev: same default run_soul.sh uses (": ${SOUL_DATA_DIR:=$REPO/soul/data}").
  const overrideDir = process.env.SOUL_DATA_DIR;
  if (overrideDir) return overrideDir;
  // Anchor to the SAME soul checkout the supervisor launches, whose cwd is the
  // soul dir (run_soul.sh's $REPO/soul). Deriving from resolveSoulScript() (not
  // a fixed __dirname walk) is correct regardless of where the bundler places
  // the compiled main: a `__dirname/../..` walk silently points at
  // UnClaw/soul/data in the dev build (__dirname = UnClaw/out/main), a dir soul
  // never reads — which dropped downloaded voices into a phantom folder.
  const resolved = resolveSoulScript();
  if (resolved) return path.join(resolved.cwd, 'data');
  // Last-resort fallback (resolver found nothing): the old source-tree walk.
  return path.join(path.resolve(__dirname, '..', '..'), 'soul', 'data');
}

/** Best-effort read of soul's ports.json. Returns null if missing/stale/
 *  malformed. Used to discover an external-attach soul's HTTP port
 *  before doing /health. */
function readPortsJson(): SoulPorts | null {
  try {
    const fs = require('fs') as typeof import('fs');
    const file = path.join(getSoulDataDir(), 'ports.json');
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<{
      http: number; signalling_streamer: number; signalling_player: number;
      pid: number;
    }>;
    if (!raw.http || !raw.signalling_streamer || !raw.signalling_player) {
      return null;
    }
    return {
      http: raw.http,
      signallingStreamer: raw.signalling_streamer,
      signallingPlayer: raw.signalling_player,
    };
  } catch {
    return null;
  }
}

/**
 * Quick TCP probe for an existing soul. Used to decide whether to
 * spawn a new instance or attach to one the user is running externally
 * (e.g. `./run_soul.sh` in a terminal during development). Tries
 * ports.json first (covers dynamic-port soul), falls back to the
 * legacy 8765 default.
 */
function probeExistingSoul(): Promise<boolean> {
  // Discover the candidate port: ports.json wins (matches a soul that
  // picked dynamic ports), 8765 is the legacy explicit-pin default.
  const fromFile = readPortsJson();
  const port = fromFile?.http ?? SOUL_LEGACY_HTTP_PORT;
  const url = `http://127.0.0.1:${port}/health`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: SOUL_HEALTH_TIMEOUT_MS }, (res) => {
      // Any 2xx counts. Drain + discard the body.
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * The packaged-install runtime root, everything the user downloaded on
 * first launch lives under here. Mirrors the Windows
 * `%LOCALAPPDATA%\Unclaw-Soul\_runtime\` layout.
 *
 *   runtime/python-env/               , uv-managed venv
 *   runtime/assets/{Audio2Lipsync,...}, downloaded model code + checkpoints
 *   runtime/unreal/Unclaw Character.app, downloaded UE Shipping build
 *   runtime/data/                     , soul runtime data (reminders,
 *                                          memory, crash dumps)
 *   runtime/.setup-complete           , idempotent first-run gate
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
 *   2. Auto-updater overlay, <userData>/runtime/soul/run_soul.sh, newer
 *      than the DMG-bundled baseline when the updater has dropped a fresh
 *      soul tarball. Code-signed .app contents are read-only post-install,
 *      so we can't write into Resources/soul-src/; the overlay lives in
 *      userData where we have write access.
 *   3. Packaged build baseline, Resources/soul-src/run_soul.sh inside the
 *      .app. Used on first launch (before any update has landed) and as a
 *      permanent fallback if the overlay is missing/corrupted.
 *   4. Dev, walk up from app path looking for a sibling soul/ checkout
 */
function resolveSoulScript(): { script: string; cwd: string } | null {
  const fs = require('fs') as typeof import('fs');
  const override = process.env.UNCLAW_SOUL_REPO;
  if (override) {
    return { script: path.join(override, SOUL_SCRIPT), cwd: override };
  }
  // Auto-updater overlay, checked FIRST so a freshly-dropped soul takes
  // precedence over the baseline. The overlay dir is only present after
  // the updater has successfully installed a soul category bump.
  if (app.isPackaged) {
    const overlayDir = path.join(getRuntimeDir(), 'soul');
    const overlayScript = path.join(overlayDir, SOUL_SCRIPT);
    if (fs.existsSync(overlayScript)) {
      return { script: overlayScript, cwd: overlayDir };
    }
  }
  // Packaged baseline: Electron stages extraResources at process.resourcesPath
  // (= <App>.app/Contents/Resources/ on macOS, Resources\ on Windows).
  // package.json maps `../soul → soul-src`, so this is the install path.
  if (app.isPackaged) {
    const packagedDir = path.join(process.resourcesPath, 'soul-src');
    const script = path.join(packagedDir, SOUL_SCRIPT);
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
      if (fs.existsSync(path.join(dir, SOUL_SCRIPT))) {
        return { script: path.join(dir, SOUL_SCRIPT), cwd: dir };
      }
    } catch { /* try next */ }
  }
  return null;
}

function spawnSoul(window: BrowserWindow): boolean {
  const resolved = resolveSoulScript();
  if (!resolved) {
    log(window, 'meta',
      '[unclaw] could not locate soul/run_soul.sh. Set UNCLAW_SOUL_REPO to ' +
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
    // Dynamic backbuffer match via MatchViewportRes, the new MacInputHandler
    // SetCommandHandler("Resolution.Width", ...) (UE plugin rebuild) handles
    // the SDK's resize messages and runs r.SetRes WxHw. UE picks its own
    // sensible default at boot (typically the host display dimensions in
    // -RenderOffScreen), then resizes on demand as the browser fires.
    UNCLAW_UE_RES_AUTO: process.env.UNCLAW_UE_RES_AUTO ?? '1',
    // Flat dir of owned character paks. run_soul.sh stages any *.pak here into
    // the UE sandbox container's Saved/Paks at launch so purchased characters
    // boot-mount before BeginPlay. run_soul guards on the dir existing, so this
    // is a harmless no-op until the first character is downloaded (and in dev,
    // where paks are baked into the .app's Content/Paks). Must match
    // setupCoordinator.characterPaksStageDir().
    UNCLAW_CHARACTERS_SRC:
      process.env.UNCLAW_CHARACTERS_SRC ?? path.join(getRuntimeDir(), 'character-paks'),
    // PATH augmentation is a macOS/Linux fix (Electron inherits an inert
    // PATH lacking /opt/homebrew/bin). On Windows the inherited PATH already
    // resolves powershell/python; just pass it through unchanged.
    PATH: IS_WINDOWS
      ? (process.env.PATH ?? '')
      : [
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
    soulProc = IS_WINDOWS
      ? spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved.script],
          {
            cwd: resolved.cwd,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
            // No console window for the spawned powershell host.
            windowsHide: true,
            // NB: do NOT set detached:true on Windows. Unlike Unix (where
            // it makes a killable process group), on Windows it spawns a
            // new detached console that makes powershell exit immediately
            // (code 0, ~0.1s). taskkill /T in stopSoul() walks the PID
            // tree directly, so no process group is needed.
          },
        )
      : spawn('bash', [resolved.script], {
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
      // Critically: we do NOT call soulProc.unref(), that would
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
  // them to send logs, the IPC ring buffer only survives until the
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
      maybeParsePorts(window, line);
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
    clearHealthPoll();

    // Intentional shutdown (quit / explicit restart) → never respawn.
    if (intentionalStop) return;

    // Unexpected exit. Auto-respawn with backoff so a transient first-run
    // crash (OOM on a cold model load, a flaky import) self-heals instead
    // of stranding the user. The overall boot watchdog (armed in startSoul)
    // still bounds the whole episode; the stability timer resets the count
    // once soul has been healthy for a while.
    if (respawnAttempts < MAX_SOUL_RESPAWNS) {
      const attempt = respawnAttempts + 1;
      respawnAttempts = attempt;
      // Re-detect on the fresh process: a respawn may pick new ports.
      soulIsReady = false;
      alreadyReadyFired = false;
      livePorts = null;
      const backoff = SOUL_RESPAWN_BACKOFF_MS[Math.min(attempt - 1, SOUL_RESPAWN_BACKOFF_MS.length - 1)];
      log(window, 'meta',
        `[unclaw] respawning soul (attempt ${attempt}/${MAX_SOUL_RESPAWNS}) in ${backoff}ms`);
      emit(window, 'soul:retrying', { attempt, max: MAX_SOUL_RESPAWNS });
      setTimeout(() => {
        if (intentionalStop) return;
        // Re-sweep first: the dead process may have leaked UE/wilbur
        // children holding the ports the respawn needs to bind.
        void sweepStaleProcesses(window).finally(() => {
          if (intentionalStop) return;
          if (spawnSoul(window)) startHealthPoll(window);
        });
      }, backoff);
      return;
    }

    // Out of retries and never reached ready → surface a real failure.
    if (!soulIsReady) {
      handleBootFailure(window,
        `soul exited (code=${code ?? 'null'} signal=${signal ?? 'null'}) ` +
        `and exhausted ${MAX_SOUL_RESPAWNS} restart attempts`);
    }
  });
  soulProc.on('error', (err) => {
    log(window, 'meta', `[unclaw] soul error: ${err.message}`);
  });

  // Fallback readiness path: poll /health alongside the stdout marker so a
  // missed/unflushed marker line can never strand the boot.
  startHealthPoll(window);

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
  // Reset livePorts so a respawn doesn't surface the dead session's
  // ports to the renderer while we wait for the new [ports] banner.
  livePorts = null;
  recentLogs.length = 0;
  soulSpawnAt = Date.now();
  // Fresh boot episode: clear resilience state + any leftover timers.
  respawnAttempts = 0;
  intentionalStop = false;
  bootFailed = false;
  if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
  clearBootTimers();

  // In packaged builds, refuse to spawn until the first-run wizard has
  // provisioned the runtime (python-env, downloaded UE app, downloaded
  // assets). The renderer's App.tsx gates on the same .setup-complete
  // marker via setup:get-status and shows <SetupWizard> first; the
  // wizard explicitly re-invokes startSoul() once it finishes. Without
  // this guard, an early auto-spawn would race the wizard and crash
  // soul with missing python-env / missing PYTHONPATH errors.
  if (!isPackagedSetupComplete()) {
    log(window, 'meta',
      '[unclaw] first-run setup not yet complete, deferring soul spawn ' +
      'until SetupWizard finishes');
    return;
  }

  const existing = await probeExistingSoul();
  if (existing) {
    log(window, 'meta', '[unclaw] soul already running externally, attaching');
    alreadyReadyFired = true;
    soulIsReady = true;
    // Hydrate livePorts from ports.json, the external soul wrote it
    // on its own startup, so we don't have a [ports] banner to parse
    // but the file is authoritative. Falls back to the legacy port if
    // ports.json isn't present (older soul, or the user explicitly
    // pinned with --port 8765 and skipped ports.json writes somehow).
    livePorts = readPortsJson() ?? {
      http: SOUL_LEGACY_HTTP_PORT,
      // We can't know the legacy signalling ports for sure if the
      // file is missing, best effort with the old defaults, matching
      // what soul shipped pre-dynamic-ports.
      signallingStreamer: 8888,
      signallingPlayer: 8080,
    };
    // Short tick so renderer has time to mount its log subscription
    // before the ready event fires. Otherwise the LoadingScreen never
    // sees 'soul:ready' and gets stuck. Emit ports BEFORE ready so
    // the renderer's init-soul-base resolves on the same render frame.
    setTimeout(() => {
      if (livePorts) emit(window, 'soul:ports', livePorts);
      emit(window, 'soul:ready');
    }, 100);
    return;
  }
  // Sweep stale processes from a prior crashed/killed Unclaw session
  // before spawning. The bug we're working around: when Unclaw is force-
  // quit (Cmd+Opt+Esc, system reboot, OOM, etc.), the soul/wilbur/UE
  // process tree can survive and continue holding ports 8765/8888/8080.
  // The next launch then can't bind those ports and silently fails to
  // ever signal-ready, leaving the user stuck on SoulBootScreen.
  // Auto-kill anything whose argv we can positively identify as ours , 
  // be conservative: a generic process holding port 8888 we leave alone
  // and just log a warning.
  await sweepStaleProcesses(window);

  // Arm the overall boot watchdog BEFORE spawning. It spans the whole
  // episode (including any respawns); if neither the READY marker nor a
  // /health probe confirms within the budget, we surface a failure instead
  // of letting the renderer spin forever.
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    if (!soulIsReady && !intentionalStop) {
      handleBootFailure(window,
        `soul did not become ready within ${Math.round(SOUL_BOOT_TIMEOUT_MS / 1000)}s`);
    }
  }, SOUL_BOOT_TIMEOUT_MS);

  spawnSoul(window);
}

/**
 * User-initiated restart from the boot-failure screen. Clears the failure
 * latch + retry budget and runs a fresh boot episode.
 */
export async function restartSoul(window: BrowserWindow): Promise<void> {
  log(window, 'meta', '[unclaw] manual soul restart requested');
  // Tear down any current process first so the respawn binds clean ports.
  intentionalStop = true;
  if (soulProc) {
    try { process.kill(-soulProc.pid!, 'SIGTERM'); } catch { /* group may be gone */ }
    soulProc = null;
  }
  clearBootTimers();
  await startSoul(window);
}

/**
 * Find + kill orphaned soul/wilbur/UE processes from a prior crashed
 * Unclaw session. Identifies them by:
 *   * argv contains "run_soul.sh" or "soul.cli" or "soul.server"
 *   * argv contains "wilbur" (the signalling server soul ships with)
 *   * .app path matches our runtime/unreal/Unclaw Character.app
 *
 * Safe: we only kill processes whose argv we POSITIVELY identify as ours.
 * A random other dev tool holding port 8765 gets logged-not-killed.
 */
async function sweepStaleProcesses(window: BrowserWindow): Promise<void> {
  if (IS_WINDOWS) {
    // run_soul.ps1 frees its own HTTP port on launch
    // (Get-NetTCPConnection → Stop-Process), so a stale soul can't block
    // the rebind. A full tasklist/taskkill sweep of orphaned UE is a
    // follow-up; skip cleanly rather than shell out to /bin/ps (Unix-only).
    return;
  }
  const psOutput = await new Promise<string>((resolve) => {
    // `ps -A -o pid=,command=`, full command line for every process the
    // user can see. We post-filter by argv pattern.
    execFile('/bin/ps', ['-A', '-o', 'pid=,command='], (err, stdout) => {
      if (err) {
        log(window, 'meta', `[unclaw] stale-process sweep skipped: ps failed (${err.message})`);
        resolve('');
      } else {
        resolve(stdout);
      }
    });
  });
  if (!psOutput) return;

  const myPid = process.pid;
  const ueAppName = 'Unclaw Character';
  const ourPatterns = [
    /run_soul\.sh\b/,
    /\bsoul\.cli\b/,
    /\bsoul\.server\b/,
    /\bwilbur\b/,
    new RegExp(`${ueAppName}\\.app`),
  ];
  const stale: Array<{ pid: number; cmd: string }> = [];

  for (const line of psOutput.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const cmd = m[2];
    // Never touch our own process tree (Electron main, helper procs,
    // current soul if it's already mid-spawn).
    if (pid === myPid) continue;
    if (soulProc && pid === soulProc.pid) continue;
    if (!ourPatterns.some((re) => re.test(cmd))) continue;
    // Filter out the .app path matching our DMG-bundled UE, we only
    // care about orphans that haven't been reaped. A still-living
    // Electron-main owner means the process belongs to a parallel
    // Unclaw instance and we shouldn't touch it. Conservative: only
    // count it as orphan if we can confirm the parent PID is launchd
    // (PID 1) or otherwise dead.
    stale.push({ pid, cmd: cmd.slice(0, 120) });
  }

  if (stale.length === 0) {
    return;
  }

  log(window, 'meta',
    `[unclaw] sweeping ${stale.length} stale process(es) from prior session:`);
  for (const { pid, cmd } of stale) {
    log(window, 'meta', `  pid=${pid}: ${cmd}`);
    try {
      // SIGTERM first, give the process a chance to clean up. If it's
      // wedged, we follow up with SIGKILL after a short grace window.
      process.kill(pid, 'SIGTERM');
    } catch {
      // ESRCH (already exited), fine.
    }
  }
  // Brief grace window for SIGTERM to land + processes to release their
  // ports. 800 ms is well under the user-visible "is it stuck?" threshold
  // but long enough for clean Python shutdown hooks to run.
  await new Promise((r) => setTimeout(r, 800));
  // SIGKILL any survivors. By this point they've ignored SIGTERM , 
  // unblock the ports unconditionally.
  for (const { pid } of stale) {
    try {
      process.kill(pid, 0); // probe, throws if dead
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone, good
    }
  }
}

/**
 * Kill the spawned soul + everything it spawned (UE, MCP subprocesses)
 * on app quit. Idempotent. If soul was attached externally, this is a
 * no-op, the user owns that process.
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
 *      breathing is wedged, better to force-quit than leak processes
 *      across app sessions.
 *
 * Called synchronously from the `will-quit` hook, so we can't await , 
 * the SIGKILL fallback runs after a setTimeout that may not complete
 * before app exit on a fast user quit. That's acceptable: SIGKILL on
 * a process group with no parent left over is the OS's job at that
 * point (launchd cleans up orphans whose group leader is gone).
 */
export function stopSoul(): void {
  // Mark intentional FIRST so the exit handler never auto-respawns a
  // process we're deliberately tearing down, and stop all boot timers.
  intentionalStop = true;
  clearBootTimers();
  if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
  if (!soulProc) return;
  const pid = soulProc.pid;
  soulProc = null;
  if (pid === undefined) return;

  if (IS_WINDOWS) {
    // Windows has no POSIX process groups. taskkill /T walks the child
    // tree (powershell → python soul → UE) and /F force-terminates each.
    // soul's own FastAPI shutdown won't run on a hard kill, but UE is a
    // grandchild taskkill /T reaches directly, so nothing is orphaned.
    try {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F']);
    } catch {
      // already exited
    }
    return;
  }

  const killGroup = (sig: NodeJS.Signals) => {
    try {
      // Negative PID = "send to process group whose leader is |pid|".
      // Requires the child to have been spawned with detached:true so
      // it's actually a group leader.
      process.kill(-pid, sig);
    } catch {
      // ESRCH (no such process) is fine, already exited.
    }
  };

  killGroup('SIGTERM');
  // Soul's FastAPI shutdown hook (_on_shutdown in server.py) runs
  // synchronously on SIGTERM and itself SIGTERMs the UE child, then
  // waits up to ~8s for UE to release its GPU/audio devices cleanly
  // before SIGKILLing it. If we SIGKILL soul faster than that, soul
  // dies mid-shutdown and UE is left orphaned (it's in a separate
  // process group via start_new_session=True so OUR killpg here
  // doesn't reach it). 10s gives the whole chain room to drain.
  setTimeout(() => killGroup('SIGKILL'), 10000);
}
