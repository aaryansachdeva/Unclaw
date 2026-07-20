// opencode (sst / opencode.ai). Docs: opencode.ai/docs/mcp-servers, /config,
// /rules.
//   * No `mcp add` CLI , edit config JSON.
//   * Config: ~/.config/opencode/opencode.json → "mcp" key. stdio = type
//     "local"; `command` is a SINGLE ARRAY [cmd, ...args].
//   * Guidance: AGENTS.md (global ~/.config/opencode/AGENTS.md).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerAdapter, onPath, upsertMcpJson, removeMcpJson, upsertInstructions, INSTRUCTIONS_BODY } from '../installer.mjs';
import { opencodeDir } from '../platform.mjs';

const DIR = opencodeDir();
const CFG = join(DIR, 'opencode.json');

registerAdapter({
  id: 'opencode',
  name: 'opencode',
  detect: () => onPath('opencode') || existsSync(DIR),
  register({ node, runtime }) {
    const mcp = upsertMcpJson(CFG, {
      rootKey: 'mcp',
      server: { type: 'local', command: [node, runtime, '--mcp'], enabled: true },
    });
    const guide = upsertInstructions(join(DIR, 'AGENTS.md'), INSTRUCTIONS_BODY);
    return { ok: mcp.ok, detail: [mcp.detail, guide.detail].filter(Boolean).join('; '), error: mcp.error };
  },
  unregister: () => removeMcpJson(CFG, { rootKey: 'mcp' }),
});
