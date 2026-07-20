#!/usr/bin/env node
// unclaw-speak , the passthrough "speak" shim.
//
// UnClaw runs in passthrough mode: it does no inference of its own. A
// user's coding agent (Claude Code first, any agent later) decides WHAT
// the avatar says and calls this shim to voice it. The shim finds the
// locally-running UnClaw soul server (via its ports.json discovery file)
// and POSTs the text to /passthrough/speak, which pushes it to the
// UnClaw window for TTS + lipsync + expression on the 3D character.
//
// Three modes, one file (zero npm deps , plain Node 18+):
//   node unclaw-speak.mjs "text" [--mood M] [--action A]   # CLI speak
//   node unclaw-speak.mjs --launch                          # open UnClaw in passthrough
//   node unclaw-speak.mjs --status                          # is a passthrough session live?
//   node unclaw-speak.mjs --mcp                             # stdio MCP server (speak/launch tools)
//
// The MCP mode makes `speak` a first-class tool for ANY MCP client
// (Claude Code, Codex, Gemini CLI, ...). The CLI mode is what the
// bundled Claude Code skill calls so it works in the same session with
// no MCP registration / restart.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// --- ports.json discovery -------------------------------------------------
//
// soul writes {host, http, ...} to <SOUL_DATA_DIR>/ports.json on every
// boot. Two standard locations: the packaged app's runtime dir and the
// dev repo's soul/data. SOUL_PORTS_JSON overrides both. Pick the freshest
// readable file so a stale dev copy never shadows a running packaged app.
function candidatePortsPaths() {
  const out = [];
  if (process.env.SOUL_PORTS_JSON) out.push(process.env.SOUL_PORTS_JSON);
  if (process.env.SOUL_DATA_DIR) out.push(join(process.env.SOUL_DATA_DIR, 'ports.json'));
  out.push(join(homedir(), 'Library', 'Application Support', 'unclaw', 'runtime', 'data', 'ports.json'));
  // Dev repo layout: this file lives at <repo>/UnClaw/integrations/unclaw-skill/scripts/,
  // soul/data is a sibling of UnClaw. Also try a couple of common dev roots.
  out.push(join(homedir(), 'Documents', 'Unclaw-Mac', 'soul', 'data', 'ports.json'));
  return out;
}

function resolvePorts() {
  let best = null;
  for (const p of candidatePortsPaths()) {
    try {
      if (!existsSync(p)) continue;
      const mtime = statSync(p).mtimeMs;
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (typeof data.http === 'number') {
        if (!best || mtime > best.mtime) best = { data, mtime, path: p };
      }
    } catch { /* unreadable / mid-write / not JSON , skip */ }
  }
  return best?.data ?? null;
}

function soulHttpBase() {
  const ports = resolvePorts();
  if (!ports) return null;
  const host = ports.host || '127.0.0.1';
  return `http://${host}:${ports.http}`;
}

// --- HTTP calls -----------------------------------------------------------

async function postSpeak({ text, mood, action }) {
  const base = soulHttpBase();
  if (!base) {
    return { ok: false, error: 'UnClaw soul server not found (no ports.json). Is UnClaw running?' };
  }
  let res;
  try {
    res = await fetch(`${base}/passthrough/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mood: mood || null, action: action || null }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: `could not reach UnClaw soul at ${base}: ${e.message}` };
  }
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    return { ok: false, error: `soul /passthrough/speak ${res.status}`, ...body };
  }
  return body; // { ok, delivered, error? }
}

async function passthroughStatus() {
  const base = soulHttpBase();
  if (!base) return { running: false, connected: false, reason: 'soul not found' };
  // /health reports whether soul is up + how many passthrough renderers are
  // subscribed; /passthrough/prefs reports the user's talkativeness + mute.
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4_000) });
    const ok = res.ok;
    let j = {};
    try { j = await res.json(); } catch { /* ignore */ }
    let prefs = {};
    try {
      const pr = await fetch(`${base}/passthrough/prefs`, { signal: AbortSignal.timeout(4_000) });
      if (pr.ok) prefs = await pr.json();
    } catch { /* prefs optional */ }
    return {
      running: ok,
      connected: (j.passthrough_clients ?? 0) > 0,
      verbosity: prefs.verbosity ?? 'balanced',
      muted: !!prefs.muted,
      base,
    };
  } catch (e) {
    return { running: false, connected: false, reason: e.message };
  }
}

// --- launch ---------------------------------------------------------------

function launchPassthrough() {
  // macOS: `open` the deep link. This cold-starts UnClaw (or focuses it if
  // already running) and the app enters passthrough mode via its
  // unclaw://passthrough deep-link handler.
  return new Promise((resolve) => {
    const child = spawn('open', ['unclaw://passthrough'], { stdio: 'ignore', detached: true });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('spawn', () => { child.unref(); resolve({ ok: true }); });
  });
}

// --- MCP stdio server -----------------------------------------------------
//
// Minimal hand-rolled MCP (JSON-RPC 2.0 over stdio, line-delimited via
// Content-Length framing). Implements initialize, tools/list, tools/call
// for `speak` and `launch_unclaw`. Enough for Claude Code / Codex / any
// MCP client to expose speak as a native tool. No SDK dependency.

function mcpServer() {
  const TOOLS = [
    {
      name: 'speak',
      description:
        "Voice a line aloud through the user's UnClaw avatar (TTS + lipsync + "
        + 'facial expression on the 3D character). Use this ONLY for words meant '
        + 'to be spoken to the user, not for your regular text output. Keep it '
        + 'conversational and concise , it is heard, not read.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The line to speak aloud.' },
          mood: {
            type: 'string',
            description: "Optional expression hint, e.g. 'joyful', 'tender', "
              + "'excited', 'neutral', 'thoughtful'.",
          },
          action: {
            type: 'string',
            description: "Optional one-shot gesture, e.g. 'celebrate', "
              + "'give_a_kiss', 'do_dance', 'say_hello'.",
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'launch_unclaw',
      description:
        'Launch (or focus) the UnClaw avatar window in passthrough mode so '
        + 'subsequent speak calls are heard. Safe to call again if already open.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Content-Length framed messages.
    for (;;) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { buf = buf.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = buf.slice(start, start + len).toString('utf8');
      buf = buf.slice(start + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      void handle(msg);
    }
  });

  function send(obj) {
    const s = JSON.stringify(obj);
    const payload = Buffer.from(s, 'utf8');
    process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
    process.stdout.write(payload);
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'unclaw', version: '1.0.0' },
        },
      });
      return;
    }
    if (method === 'notifications/initialized') return; // no-op
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      let text;
      if (name === 'speak') {
        const r = await postSpeak({ text: args.text || '', mood: args.mood, action: args.action });
        const pref = r.verbosity ? ` [talkativeness: ${r.verbosity}]` : '';
        if (r.muted) {
          text = `Held , the user has the avatar MUTED. Stop calling speak until it clears.${pref}`;
        } else if (r.ok) {
          text = `Spoken (delivered to ${r.delivered} UnClaw window${r.delivered === 1 ? '' : 's'}).${pref}`;
        } else {
          text = `Not spoken: ${r.error || 'unknown error'}${pref}`;
        }
      } else if (name === 'launch_unclaw') {
        const r = await launchPassthrough();
        text = r.ok ? 'UnClaw launching in passthrough mode.' : `Launch failed: ${r.error}`;
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${name}` } });
        return;
      }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      return;
    }
    if (id != null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
    }
  }
}

// --- CLI entry ------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mood') out.mood = argv[++i];
    else if (a === '--action') out.action = argv[++i];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
    else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mcp) { mcpServer(); return; } // long-lived

  if (args.launch) {
    const r = await launchPassthrough();
    console.log(r.ok ? 'UnClaw launching in passthrough mode.' : `Launch failed: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.status) {
    const s = await passthroughStatus();
    console.log(JSON.stringify(s, null, 2));
    process.exit(s.running ? 0 : 1);
  }

  const text = args._.join(' ').trim();
  if (!text) {
    console.error('usage: unclaw-speak "text to say" [--mood M] [--action A]');
    console.error('       unclaw-speak --launch | --status | --mcp');
    process.exit(2);
  }
  const r = await postSpeak({ text, mood: args.mood, action: args.action });
  const pref = r.verbosity ? `  [talkativeness: ${r.verbosity}]` : '';
  if (r.muted) {
    console.log(`held , avatar is MUTED (hold speech until unmuted)${pref}`);
    process.exit(0);
  } else if (r.ok) {
    console.log(`spoken (delivered to ${r.delivered} window${r.delivered === 1 ? '' : 's'})${pref}`);
    process.exit(0);
  } else {
    console.error(`not spoken: ${r.error || 'unknown error'}${pref}`);
    process.exit(1);
  }
}

main();
