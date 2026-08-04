# UnClaw passthrough integration

Let a user's own coding agent (Claude Code first, any MCP/CLI agent
next) drive the UnClaw 3D avatar. UnClaw runs in **passthrough mode**:
it does no inference, the agent decides what gets said, and only text
the agent hands to `speak` is voiced (TTS + lipsync + facial expression
on the character). One-directional: input comes from the agent, the
avatar is pure output.

## Pieces

- `scripts/unclaw-speak.mjs` , zero-dependency Node shim. Finds the local
  soul server via its `ports.json` discovery file and POSTs to
  `/passthrough/speak`. Three modes:
  - `node unclaw-speak.mjs "text" [--mood M] [--action A]` , voice a line
  - `node unclaw-speak.mjs --launch` , open UnClaw in passthrough mode
  - `node unclaw-speak.mjs --status` , is a passthrough session live?
  - `node unclaw-speak.mjs --mcp` , stdio MCP server exposing `speak` +
    `launch_unclaw` as native tools (universal , Claude Code, Codex,
    Gemini CLI, any MCP client)
- `skill/SKILL.md` , the `/unclaw` Claude Code skill: launches passthrough
  and teaches the model to voice replies via the shim, sparingly and
  conversationally.

## Install (Claude Code)

```bash
mkdir -p ~/.claude/skills/unclaw/scripts
cp skill/SKILL.md            ~/.claude/skills/unclaw/SKILL.md
cp scripts/unclaw-speak.mjs  ~/.claude/skills/unclaw/scripts/
```

Then in any Claude Code session: `/unclaw`. It launches the avatar and
gains a speak capability for the rest of the session. Because the skill
calls the shim via Bash, it works immediately , no MCP registration or
restart required.

## Install (any MCP client , universal path)

Register the shim as an MCP server for a persistent, native `speak` tool:

```bash
# Claude Code
claude mcp add unclaw -- node ~/.claude/skills/unclaw/scripts/unclaw-speak.mjs --mcp
# Codex / Gemini CLI: point their MCP config at the same command + --mcp arg
```

## How it flows

```
agent → unclaw-speak.mjs → soul POST /passthrough/speak
                                   │  (push over /passthrough/ws)
                                   ▼
                         UnClaw renderer  → soul POST /speak (verbatim, no LLM)
                                   │            (renderer's own voice + BYOK keys)
                                   ▼
                         emitUIInteraction → UE avatar speaks
```

soul never stores the user's TTS provider / voice / API keys (onboarding
owns those, they live in the renderer), so the render always happens in
the renderer's request , the shim only needs soul's http port.

## Env overrides

- `SOUL_PORTS_JSON` , explicit path to `ports.json`
- `SOUL_DATA_DIR` , directory containing `ports.json`

Otherwise the shim probes the packaged app dir
(`~/Library/Application Support/unclaw/runtime/data/ports.json`) and the
dev repo (`soul/data/ports.json`), newest wins.
