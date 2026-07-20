# unclaw

Give **any** coding agent a voice: wire the UnClaw 3D avatar's `speak`
capability into Codex, opencode, Gemini CLI, Cursor, Cline, Roo, Windsurf,
Claude Code — with one command.

```bash
npx unclaw            # detect installed agents + connect them all
npx unclaw detect     # just list what's supported / installed
npx unclaw install codex opencode   # only these
npx unclaw uninstall  # remove
```

Then start your agent — it gains a `speak` tool. Launch UnClaw in passthrough
mode (`/unclaw`, or `open "unclaw://passthrough"`) and the avatar voices
whatever the agent decides to say aloud.

## How it works

The whole capability is **one stdio MCP server** (`unclaw-speak.mjs --mcp`,
exposing `speak` + `launch_unclaw`). Because MCP is the common substrate across
every modern coding agent, "support a new agent" just means registering that
server + dropping short guidance — no per-agent reimplementation. The `speak`
tool's own description carries the usage rules, so agents know how to use it
even without an instructions file.

`speak(text)` → the agent's shim → soul `/passthrough/speak` → the UnClaw
renderer → TTS + lipsync + facial expression on the avatar. The user controls
talkativeness + mute inside UnClaw; every `speak` response echoes those back so
the agent self-adjusts.

## What it does per agent (all verified against official docs)

| Agent | MCP registration | Guidance |
|---|---|---|
| **Codex CLI** | `codex mcp add` → `~/.codex/config.toml` | `~/.codex/AGENTS.md` |
| **opencode** | `~/.config/opencode/opencode.json` (`mcp`, `type:"local"`) | `~/.config/opencode/AGENTS.md` |
| **Gemini CLI** | `~/.gemini/settings.json` (`mcpServers`) | `~/.gemini/GEMINI.md` |
| **Claude Code** | `claude mcp add --scope user` | `~/.claude/CLAUDE.md` (+ the `/unclaw` skill) |
| **Cursor** | `~/.cursor/mcp.json` (`type:"stdio"`) | tool description |
| **Cline** | VS Code globalStorage `cline_mcp_settings.json` (`autoApprove`) | tool description |
| **Roo Code** | globalStorage `mcp_settings.json` (`alwaysAllow`) | tool description |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | tool description |

Notes baked in from the research pass:
- The runtime is copied to a stable `~/.unclaw/bin/unclaw-speak.mjs` so configs
  survive npx-cache eviction.
- Every config uses an **absolute** `node` path — Dock-launched GUI editors
  (Cursor/Cline/Windsurf) get a minimal PATH, and in the UnClaw app
  `process.execPath` is Electron, not node.
- We prefer each tool's **own `mcp add` CLI** where it has one (Codex, Claude);
  JSON writes refuse to run if an existing config can't be parsed.
- `AGENTS.md` is the emerging cross-agent instructions standard (Codex,
  opencode, Cursor, Gemini, Windsurf, ...). `openclaw` isn't a standalone CLI —
  it wraps Claude/Codex/opencode, so it inherits their setup.

## Distribution

Two channels, one shared core (`lib/installer.mjs`):

1. **CLI** — publish this package to npm; users run `npx unclaw`.
2. **In-app** — the UnClaw app's *Connect your coding agent* screen calls the
   same `detectAgents()` / `install()` core over IPC (one click per agent).

Node.js is required only where the MCP server runs. Gemini CLI users already
have it; for the others the installer resolves an absolute node and, if none
exists, should prompt to install one.

## Requirements

Node 18+. macOS paths above; Linux/Windows adapters follow the same schemas
with per-OS config locations (TODO for non-macOS).
