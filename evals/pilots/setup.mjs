import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHostIntegration, uninstallHostIntegration } from './node_modules/openwiki/dist/integrations/install/installer.js';
import { getHostTarget } from './node_modules/openwiki/dist/integrations/install/registry.js';

// This small adapter uses the pinned upstream installer's command override so
// Codex can start the local package without a global openwiki executable in PATH.
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const target = getHostTarget('codex');
const remove = process.argv.includes('--remove');
const result = remove
  ? await uninstallHostIntegration(target, { scope: 'project', root })
  : await installHostIntegration(target, { scope: 'project', root,
    mcpServerCommand: { command: process.execPath, args: [join(directory, 'openwiki.mjs'), 'mcp', '--host', 'codex'] } });
if (!remove) {
  await mkdir(join(root, 'openwiki'), { recursive: true });
  for (const [source, destination] of [['wiki-instructions.md', 'openwiki/INSTRUCTIONS.md'], ['openwikiignore', '.openwikiignore']]) {
    try { await writeFile(join(root, destination), await readFile(join(directory, source)), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
console.log(JSON.stringify({ ...result, activeSessionVerified: false, modelCalls: 0 }, null, 2));
