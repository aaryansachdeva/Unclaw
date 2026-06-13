#!/usr/bin/env node
/*
 * prepare-build — makes `npm run dist:*` work from a clean clone with ZERO
 * manual setup. Idempotent: skips anything already in place. Run automatically
 * at the front of every dist:* script (see package.json).
 *
 * Two build-machine prerequisites that aren't (and shouldn't be) in git:
 *
 *   1. soul source at ../soul — electron-builder's extraResources pulls the
 *      soul package + run_soul.* + requirements from "../soul". On machines
 *      where soul isn't literally a sibling folder (e.g. Windows dev, where it
 *      lives at E:\UnClaw\soul), we create a junction/symlink so "../soul"
 *      resolves. macOS keeps soul as a real sibling, so this no-ops there.
 *
 *   2. build/resources/uv/{uv|uv.exe} — the uv binary bundled into the
 *      installer (gitignored; ~68 MB). Downloaded from the pinned uv release
 *      for this platform if absent.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');         // .../UnClaw (frontend repo)
const PARENT = path.resolve(REPO, '..');
const IS_WIN = process.platform === 'win32';
const UV_VERSION = '0.11.8';

const log = (m) => console.log(`[prepare-build] ${m}`);

// --- 1. soul source at ../soul -------------------------------------------
function isSoulRepo(dir) {
  return !!dir && (
    fs.existsSync(path.join(dir, 'run_soul.ps1')) ||
    fs.existsSync(path.join(dir, 'run_soul.sh'))
  ) && fs.existsSync(path.join(dir, 'soul'));
}

function ensureSoul() {
  const sibling = path.join(PARENT, 'soul');
  if (isSoulRepo(sibling)) { log(`soul resolves at ${sibling}`); return; }

  // Find the real soul repo: explicit override, then known dev locations.
  const candidates = [
    process.env.UNCLAW_SOUL_REPO,
    'E:/UnClaw/soul',
    path.join(os.homedir(), 'UnClaw', 'soul'),
    path.join(os.homedir(), 'Documents', 'GitHub', 'soul'),
  ].filter(Boolean);
  const real = candidates.find(isSoulRepo);
  if (!real) {
    throw new Error(
      'cannot locate the soul repo. Set UNCLAW_SOUL_REPO to its path, or place ' +
      `it at ${sibling}. Tried: ${candidates.join(', ') || '(none)'}`);
  }
  // Clear a stale/empty ../soul, then link to the real one.
  try { fs.rmSync(sibling, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.symlinkSync(path.resolve(real), sibling, IS_WIN ? 'junction' : 'dir');
  log(`linked ${sibling} -> ${real}`);
}

// --- 2. bundled uv --------------------------------------------------------
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'unclaw-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function ensureUv() {
  const dst = path.join(REPO, 'build', 'resources', 'uv');
  const uvBin = IS_WIN ? 'uv.exe' : 'uv';
  if (fs.existsSync(path.join(dst, uvBin))) { log(`uv present at ${path.join(dst, uvBin)}`); return; }
  fs.mkdirSync(dst, { recursive: true });

  const asset = IS_WIN ? 'uv-x86_64-pc-windows-msvc.zip'
    : process.platform === 'darwin' ? 'uv-aarch64-apple-darwin.tar.gz'
      : 'uv-x86_64-unknown-linux-gnu.tar.gz';
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;
  log(`downloading uv ${UV_VERSION} (${asset})...`);
  const buf = await fetchBuffer(url);
  const tmp = path.join(os.tmpdir(), `unclaw-${asset}`);
  fs.writeFileSync(tmp, buf);

  if (IS_WIN) {
    // zip with uv.exe + uvx.exe at the root.
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(tmp)} -DestinationPath ${JSON.stringify(dst)} -Force`,
    ], { stdio: 'inherit' });
  } else {
    // tar.gz extracts into uv-<triple>/; flatten uv + uvx into dst.
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-'));
    execFileSync('tar', ['-xzf', tmp, '-C', tmpdir], { stdio: 'inherit' });
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    for (const f of walk(tmpdir)) {
      const b = path.basename(f);
      if (b === 'uv' || b === 'uvx') {
        fs.copyFileSync(f, path.join(dst, b));
        fs.chmodSync(path.join(dst, b), 0o755);
      }
    }
  }
  if (!fs.existsSync(path.join(dst, uvBin))) {
    throw new Error(`uv extraction failed: ${uvBin} not found in ${dst}`);
  }
  log(`uv ready at ${dst}`);
}

(async () => {
  ensureSoul();
  await ensureUv();
  log('build prerequisites ready');
})().catch((e) => {
  console.error(`[prepare-build] FAILED: ${e.message}`);
  process.exit(1);
});
