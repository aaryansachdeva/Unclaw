#!/usr/bin/env node
// unclaw , wire the UnClaw avatar's `speak` capability into whatever coding
// agent(s) you use. One command; the same core the UnClaw app calls.
//
//   npx unclaw            # detect agents + install into all of them
//   npx unclaw install    # same, explicit
//   npx unclaw install codex opencode   # only these
//   npx unclaw detect     # list supported agents + whether installed
//   npx unclaw uninstall  # remove from all
//
// After installing, run `/unclaw` (Claude Code) or just start your agent , it
// gains a `speak` tool. Launch the UnClaw app in passthrough mode and the
// avatar voices whatever the agent speaks.

import '../lib/agents/index.mjs'; // registers all verified adapters
import { detectAgents, install, uninstall, ADAPTERS } from '../lib/installer.mjs';

const [cmd = 'install', ...rest] = process.argv.slice(2);

function printResults(results) {
  for (const r of results) {
    const mark = r.ok ? '✓' : '·';
    console.log(`  ${mark} ${r.name}${r.detail ? ` , ${r.detail}` : ''}${r.error ? ` (${r.error})` : ''}`);
  }
}

if (ADAPTERS.length === 0) {
  console.error('unclaw: no agent adapters bundled yet in this build.');
  process.exit(1);
}

switch (cmd) {
  case 'detect': {
    console.log('Supported agents on this machine:');
    for (const a of detectAgents()) {
      console.log(`  ${a.installed ? '●' : '○'} ${a.name}${a.installed ? '' : '  (not detected)'}`);
    }
    break;
  }
  case 'install': {
    const ids = rest.length ? rest : null;
    const found = detectAgents().filter((a) => a.installed);
    if (!ids && found.length === 0) {
      console.log('No supported coding agents detected. Install one (Codex, opencode, Gemini CLI, ...) then re-run.');
      process.exit(0);
    }
    console.log('Installing UnClaw speak capability...');
    printResults(install(ids));
    console.log('\nDone. Start your agent and use its `speak` tool; launch UnClaw in passthrough mode to hear it.');
    break;
  }
  case 'uninstall': {
    const ids = rest.length ? rest : null;
    console.log('Removing UnClaw speak capability...');
    printResults(uninstall(ids));
    break;
  }
  default:
    console.error(`unknown command: ${cmd}\nusage: unclaw [install|detect|uninstall] [agent...]`);
    process.exit(2);
}
