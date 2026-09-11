import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareSmoke } from './prepare.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const installed = await access(join(directory, 'node_modules/openwiki/package.json')).then(() => true, () => false);
const options = { skip: installed ? false : 'Install opt-in pilot dependencies first', timeout: 60000 };

test('OpenWiki project installer preserves unrelated settings and uninstalls its own integration', options, async t => {
  const { installHostIntegration, uninstallHostIntegration } = await import('./node_modules/openwiki/dist/integrations/install/installer.js');
  const { getHostTarget } = await import('./node_modules/openwiki/dist/integrations/install/registry.js');
  const root = await mkdtemp(join(tmpdir(), 'wiki-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/config.toml'), 'model = "owner-selected"\n');
  const config = { scope: 'project', root, mcpServerCommand: {
    command: process.execPath, args: [join(directory, 'openwiki.mjs'), 'mcp', '--host', 'codex'] } };
  assert.equal((await installHostIntegration(getHostTarget('codex'), config)).changed, true);
  assert.equal((await installHostIntegration(getHostTarget('codex'), config)).changed, false);
  assert.match(await readFile(join(root, '.codex/config.toml'), 'utf8'), /owner-selected/);
  await uninstallHostIntegration(getHostTarget('codex'), { scope: 'project', root });
  const remaining = await readFile(join(root, '.codex/config.toml'), 'utf8');
  assert.match(remaining, /owner-selected/);
  assert.doesNotMatch(remaining, /mcp_servers.openwiki/);
});

test('OpenWiki MCP discovers its lifecycle and refuses an unknown run', options, async t => {
  const { Client } = await import('./node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await import('./node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(directory, 'openwiki.mjs'), 'mcp', '--host', 'codex'], stderr: 'pipe' });
  const client = new Client({ name: 'world-pilot-controls', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'openwiki_begin', 'openwiki_finish', 'openwiki_inspect_page_claims',
    'openwiki_next_page', 'openwiki_submit_page', 'openwiki_submit_plan',
  ]);
  const result = await client.callTool({ name: 'openwiki_next_page', arguments: { runId: '00000000-0000-4000-8000-000000000000' } });
  assert.equal(result.isError, true);
});

test('Skillgrade accepts the reference and rejects the unchanged reconnect regression without model calls', options, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'world-pilot-controls-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const prepared = await prepareSmoke(join(parent, 'prepared'));
  const executable = join(directory, 'node_modules/skillgrade/bin/skillgrade.js');
  const run = (cwd, args) => spawnSync(process.execPath, [executable, '--provider=local', '--trials=1', '--parallel=1',
    '--ci', '--threshold=1', '--output=' + join(parent, 'reports'), ...args], { cwd, encoding: 'utf8', timeout: 20000 });
  const positive = run(join(prepared, 'controls'), ['--validate']);
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  assert.match(positive.stdout, /PASS|passed|1\.00|100%/i);
  const negative = run(prepared, ['--agent=command', '--command=true']);
  assert.equal(negative.status, 1, negative.stdout + negative.stderr);
  assert.match(negative.stdout, /0\.00|0%|0\/1/);
});
