// Roo Code (VS Code extension rooveterinaryinc.roo-cline; a Cline fork that
// DIFFERS). Docs: docs.roocode.com/features/mcp/using-mcp-in-roo.
//   * Config file is `mcp_settings.json` (NOT cline_mcp_settings.json), and
//     the approval key is `alwaysAllow` (NOT autoApprove).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter, upsertMcpJson, removeMcpJson } from '../installer.mjs';

const CODE_ROOTS = ['Code', 'Code - Insiders', 'Cursor', 'VSCodium']
  .map((d) => join(homedir(), 'Library', 'Application Support', d, 'User', 'globalStorage'));

function settingsPath() {
  for (const root of CODE_ROOTS) {
    if (existsSync(join(root, 'rooveterinaryinc.roo-cline'))) {
      return join(root, 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json');
    }
  }
  return join(CODE_ROOTS[0], 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json');
}

function hasExtension() {
  const extDirs = [join(homedir(), '.vscode', 'extensions'), join(homedir(), '.vscode-insiders', 'extensions')];
  return extDirs.some((d) => { try { return readdirSync(d).some((n) => n.startsWith('rooveterinaryinc.roo-cline-')); } catch { return false; } })
    || CODE_ROOTS.some((r) => existsSync(join(r, 'rooveterinaryinc.roo-cline')));
}

registerAdapter({
  id: 'roo',
  name: 'Roo Code',
  detect: hasExtension,
  register: ({ node, runtime }) =>
    upsertMcpJson(settingsPath(), { server: { type: 'stdio', command: node, args: [runtime, '--mcp'], disabled: false, alwaysAllow: [] } }),
  unregister: () => removeMcpJson(settingsPath()),
});
