// OpenAI Codex CLI. Docs: developers.openai.com/codex/config-reference,
// /codex/mcp, /codex/guides/agents-md.
//   * Recommended: `codex mcp add <name> -- <cmd> <args>` (writes config.toml).
//   * Config: ~/.codex/config.toml → [mcp_servers.unclaw] command/args (TOML).
//   * Guidance: AGENTS.md (Codex reads ~/.codex/AGENTS.md + per-dir).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter, onPath, runAgentCli, upsertMcpToml, upsertInstructions, INSTRUCTIONS_BODY } from '../installer.mjs';

const DIR = join(homedir(), '.codex');

registerAdapter({
  id: 'codex',
  name: 'Codex CLI',
  detect: () => onPath('codex') || existsSync(DIR),
  register({ node, runtime }) {
    const mcp = onPath('codex')
      ? runAgentCli('codex', ['mcp', 'add', 'unclaw', '--', node, runtime, '--mcp'])
      : upsertMcpToml(join(DIR, 'config.toml'), { node, runtime });
    const guide = upsertInstructions(join(DIR, 'AGENTS.md'), INSTRUCTIONS_BODY);
    return { ok: mcp.ok, detail: [mcp.detail, guide.detail].filter(Boolean).join('; '), error: mcp.error };
  },
  unregister() {
    if (onPath('codex')) { try { runAgentCli('codex', ['mcp', 'remove', 'unclaw']); } catch { /* ignore */ } }
    return { ok: true, detail: 'removed (config.toml table left if hand-added)' };
  },
});
