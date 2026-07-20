// Google Gemini CLI. Docs: github.com/google-gemini/gemini-cli docs/tools/
// mcp-server.md, docs/cli/gemini-md.md.
//   * Config: ~/.gemini/settings.json → "mcpServers" (standard shape, no
//     `type` for stdio). We write the file directly (robust; the `gemini mcp
//     add` CLI can mis-parse a trailing `--mcp` arg).
//   * Guidance: GEMINI.md (~/.gemini/GEMINI.md).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter, onPath, upsertMcpJson, removeMcpJson, upsertInstructions, INSTRUCTIONS_BODY } from '../installer.mjs';

const DIR = join(homedir(), '.gemini');
const CFG = join(DIR, 'settings.json');

registerAdapter({
  id: 'gemini',
  name: 'Gemini CLI',
  detect: () => onPath('gemini') || existsSync(DIR),
  register({ server }) {
    const mcp = upsertMcpJson(CFG, { server }); // { command, args }
    const guide = upsertInstructions(join(DIR, 'GEMINI.md'), INSTRUCTIONS_BODY);
    return { ok: mcp.ok, detail: [mcp.detail, guide.detail].filter(Boolean).join('; '), error: mcp.error };
  },
  unregister: () => removeMcpJson(CFG),
});
