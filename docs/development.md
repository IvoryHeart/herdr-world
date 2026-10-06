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
service at <http://127.0.0.1:8788>. To use explicit Herdr sockets or SSH, pass service
options after the workspace command or configure a profile in the UI.

## Verification

```bash
bun run typecheck:quick       # source types without regenerating embedded assets
bun test <path>               # focused Bun test
bun run test:quick            # non-Chromium suite
CHROME_BIN=/path/to/chromium bun run test:browser
bun run test:world            # all World browser acceptance suites
bun run test:world --shard=1/8 # reproduce one CI shard, one browser at a time
bun run build:site            # landing page/tutorial
bun run check                 # complete PR candidate
```

The test wrapper runs ordinary files in parallel using up to eight available CPUs.
Set `HERDR_TEST_PARALLEL`
to choose a default worker count and `HERDR_TEST_MAX_CONCURRENCY` to cap concurrent
cases, or pass Bun's `--parallel=N` flag to override the worker count for one run.
An unfiltered `bun run test` runs the remaining suite first, then all World browser
tests with up to four file workers and one case per worker. World bundles are built once
per run; each case retains its own server, fixture and fresh browser profile.
Focused test files build a bundle once per file. Production responsiveness cases
are serial within each file so their global diagnostic instrumentation cannot overlap.

GitHub Actions runs the remaining repository checks with one file worker and up to
two concurrent cases, preserving the upstream test configuration. World browser
tests run on eight separate runners, each with one file worker and one active case.
The [shard inventory](../scripts/world-browser-suites.ts) includes all World browser
suites; inventory checks reject missing or duplicate assignments. The required
Delivery checks status succeeds only when repository validation and every World
shard pass. Markdown-only and exact-head reuse keep their existing shorter paths.

Each World run writes JUnit results and per-file timings under `.agents/delivery/`.
CI uploads them as `world-browser-N-attempt-M` artifacts, including on test failure. Compare
the slowest shard and total delivery time before changing the shard assignment or
concurrency. The first eight-shard grouping is provisional, rather than a claim of
a measured two-to-three-minute delivery time. Keep all scenario combinations, dense
fixtures, real deadline checks and input-latency budgets when rebalancing.

`HERDR_TEST_EXCLUDE_WORLD_BROWSER=1` is for the CI repository-validation job, which
is gated together with the separate World shards. Do not use it as a complete local
check. The existing `test:browser` selection covers upstream and selected World
files; use `test:world` for the complete World browser matrix.

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

## Harness agent checkouts

An active agent harness can report its own checkout without starting the World web
service:

```bash
herdr-world agent-checkout /worktrees/synthetic-agent --pane w1:p1 \
  --pr https://example.invalid/org/repo/pull/7
```

The report is an absolute checkout path plus an optional HTTPS link, each bounded
before one 15-token metadata update. It is fingerprinted to the pane's exact active
agent session and has no TTL or renewal job. It disappears from the Inspector when
the session changes, the pane closes, or Herdr restarts. Do not use real paths or
repository links in shared harness output. `--clear` and `--ttl-ms` are rejected
before any metadata request because delayed cleanup could erase a newer report.
