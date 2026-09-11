// Pinned, repository-local CLI/MCP entrypoint; no separate model loop.
process.env.OPENWIKI_TELEMETRY_DISABLED = '1';
process.env.DO_NOT_TRACK = '1';
await import('./node_modules/openwiki/dist/cli/cli.js');
