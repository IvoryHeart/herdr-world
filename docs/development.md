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
`connection_generation`. Keep aggregate observation internal and project only the
selected host into visual surfaces; send terminal,
resource and mutation work through the qualified focused-runtime path.

See [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) and the
[knowledge map](knowledge-map.md).

The optional Office Economy provider is service-owned. For local testing, set
`HERDR_WORLD_OTEL_PROMETHEUS_URL` on `dev:server` or use the Office metrics dialog;
do not add browser-to-Prometheus requests. The provider intentionally accepts only a
base URL and fixed queries. See [deployment](DEPLOYMENT.md#optional-office-metrics).

## Harness task summaries

A harness inside an active Herdr agent pane can report a short current-work label
without starting the World web service:

```bash
herdr-world task-summary "Reviewing synthetic release checks" --pane w1:p1
```

`HERDR_PANE_ID` supplies the pane when it is available in the harness environment.
For a named local Herdr session, pass `--session NAME`. For a remote runtime, select
one fixed-policy OpenSSH destination explicitly:

```bash
herdr-world task-summary "Checking fixture topology" --pane w1:p1 \
  --ssh-host example.invalid --session fixture
```

The command reads the exact pane and its active Herdr session before it writes one
summary token plus a session fingerprint. It normalizes text, replaces common
credential-shaped values, and reports at most 80 Unicode characters. Use concise,
non-secret text: the filter is only a guard against accidental disclosure. The default
lifetime is 900,000 ms; `--ttl-ms` accepts 1 through 86,400,000 milliseconds. Herdr
expires both tokens together. There is no `--clear`, because an old hook could erase
a newer session's report.
