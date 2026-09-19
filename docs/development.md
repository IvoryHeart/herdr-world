# Development

Herdr World uses Bun 1.4.1, React/Vite and a Bun server. Herdr is an external runtime.

```bash
bun install --frozen-lockfile
```

Start a local Herdr server, then run these in separate terminals:

```bash
bun run dev:server
bun run dev:web
```

Open <http://localhost:5173>. Vite proxies API and WebSocket traffic to the World
service at <http://127.0.0.1:8787>. To use explicit Herdr sockets or SSH, pass service
options after the workspace command or configure a profile in the UI.

## Verification

```bash
bun run typecheck:quick       # source types without regenerating embedded assets
bun test <path>               # focused Bun test
bun run test:quick            # non-Chromium suite
CHROME_BIN=/path/to/chromium bun run test:browser
bun run build:site            # landing page/tutorial
bun run check                 # complete PR candidate
```

`bun run check` validates dependency notices, formatting, lint, all types/tests,
production frontend/server builds and OpenSpec contracts. Generated output belongs in
ignored directories and must not be committed.

## Architecture while developing

The service owns connection profiles and isolated runtimes. Global RPC methods such as
`connections.*` and `world.snapshot` do not carry a focused connection. Every
downstream Herdr operation carries both `connection_id` and
`connection_generation`. Keep aggregate observation read-only; send terminal,
resource and mutation work through the qualified focused-runtime path.

See [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) and the
[knowledge map](knowledge-map.md).

The optional Office Economy provider is service-owned. For local testing, set
`HERDR_WORLD_OTEL_PROMETHEUS_URL` on `dev:server` or use the Office metrics dialog;
do not add browser-to-Prometheus requests. The provider intentionally accepts only a
base URL and fixed queries. See [deployment](DEPLOYMENT.md#optional-office-metrics).
