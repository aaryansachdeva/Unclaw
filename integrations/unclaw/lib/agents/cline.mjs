// Cline (VS Code extension saoudrizwan.claude-dev). Docs:
// docs.cline.bot/mcp/configuring-mcp-servers.
//   * Config: <VSCode globalStorage>/saoudrizwan.claude-dev/settings/
//     cline_mcp_settings.json → "mcpServers" with `disabled` + `autoApprove`.
//   * No add-CLI. Guidance skipped (project .clinerules; MCP tool desc covers).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerAdapter, upsertMcpJson, removeMcpJson } from '../installer.mjs';

// VS Code family user-data roots to probe (stable + Insiders + Cursor host).
const CODE_ROOTS = ['Code', 'Code - Insiders', 'Cursor', 'VSCodium']
  .map((d) => join(homedir(), 'Library', 'Application Support', d, 'User', 'globalStorage'));

function settingsPath() {
  for (const root of CODE_ROOTS) {
    const p = join(root, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
    if (existsSync(join(root, 'saoudrizwan.claude-dev'))) return p;
  }
  return join(CODE_ROOTS[0], 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
}

function hasExtension() {
  const extDirs = [join(homedir(), '.vscode', 'extensions'), join(homedir(), '.vscode-insiders', 'extensions')];
  return extDirs.some((d) => { try { return readdirSync(d).some((n) => n.startsWith('saoudrizwan.claude-dev-')); } catch { return false; } })
    || CODE_ROOTS.some((r) => existsSync(join(r, 'saoudrizwan.claude-dev')));
}

registerAdapter({
  id: 'cline',
  name: 'Cline',
  detect: hasExtension,
  register: ({ node, runtime }) =>
    upsertMcpJson(settingsPath(), { server: { command: node, args: [runtime, '--mcp'], disabled: false, autoApprove: [] } }),
  unregister: () => removeMcpJson(settingsPath()),
});
