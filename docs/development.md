# Development

Herdr World uses Bun 1.4.4, React 19/Vite and a Bun server. Herdr TUI and herdr-core are external runtimes.

```bash
bun install --frozen-lockfile
```

Start a local Herdr TUI or herdr-core server, then run these in separate terminals:

```bash
bun run dev:server
bun run dev:web
```

Open <http://localhost:5173>. Vite proxies API and WebSocket traffic to the World
service at <http://127.0.0.1:8788>. To use explicit Herdr sockets or SSH, pass service
options after the workspace command or configure a profile in the UI.

For a second instance, use the isolated preview below rather than the shared
development ports. Tests never use your data folder: the test preload sets
`HERDR_WORLD_DATA_DIR` under the run's temporary directory, and a test that
starts World with its own `HOME` unsets it. To test the service end to end, start
it in the test's own process with `startTestService`
([test services](../server/src/service/testing/services.ts)), which gives it its own
folder. Spawn `server/src/index.ts` only for what needs a real process: signals and
exit codes, the lock between processes, a home folder of its own, or fakes on
`PATH`. A test that saves source settings should switch the GitHub source off
first, because `gh` keeps its own state in the process's home folder.

Database tests should exercise behavior without measuring disk sync speed.
Use an isolated in-memory backing for store logic (see
[`memoryBacking`](../server/src/testing/memory-backing.ts)), or SQLite
`:memory:` when the code accepts a connection. For real file/worker tests,
seed large histories and capacity boundaries in a few transactions, then run
the operation under test through its normal path. Keep real disk sync for
persistence, crash recovery and durability checks; never change the product's
FULL-sync mode, extend timeouts, retry or skip a slow test. Logical model replay
can use [`openWithoutSqliteSync`](../server/src/testing/sqlite-no-sync.ts) around
synchronous fixture construction; it retains real SQL transactions and reopen
checks while the separate process-kill fixtures keep FULL sync. Concurrent-reader
tests should acknowledge observed commits rather than rely on many writes to
create a scheduling window. Check churn tests alongside a bounded write/fsync
load when changing their fixtures.

React DOM's development renderer has a version-scoped Bun patch that enforces
its existing changed-prop diagnostic width limit. Install with the frozen lockfile
so the patch applies; retain it during dependency refreshes until the installed
renderer regression passes without it. See [React 19 measurements and patch
maintenance](react-19.md).

## Isolated worktree preview

For acceptance checks against both real runtimes, use the
[isolated runtime kit](isolated-runtimes.md). It creates and cleans up its own
TUI session, core, World and scratch harness configurations, including after a
crash; its self-test is run on demand.

Keep one preview per worktree, on its own unused loopback port and data folder.
Use a synthetic Herdr TUI session, with demo agents/repositories only, so a
preview cannot act on real work. The standard `dev:server` script fixes port
8788; start the source entry directly to use `PORT`, which
`server/src/config/server-config.ts` already honours. A built frontend needs
only the World listener, without another Vite server.

From the worktree, build the frontend:

```bash
bun run build:web
```

In a separate terminal start the dedicated TUI (replace `preview-example` with a
unique synthetic session for this worktree):

```bash
herdr --session preview-example
```

Then start World from the worktree; choose an unused port other than 8787/8788:

```bash
PORT=8799 HERDR_WORLD_DATA_DIR="$PWD/.agents/preview-data" \
  bun server/src/index.ts --host 127.0.0.1 --session preview-example \
  --public-dir ./server/public
```

Open the printed login URL in a separate browser profile. Keep only the synthetic
connection; do not copy installed connection/settings files into this data folder.
Create demo workspaces and terminals in that TUI, then check Town and its Inspector.
Rebuild the frontend and reload after edits. Stop your preview before replacing
it; leave other worktrees' listeners and data alone. For CLI checks, point
`HERDR_WORLD_URL` at this listener and use the same `HERDR_WORLD_DATA_DIR` so the
CLI locates its token. Preview data and built assets stay untracked.

Previews share Shipyard's private per-user instance registry by default, even
with different data folders. Set `HERDR_WORLD_INSTANCE_REGISTRY_DIR` in a
listener's environment at startup to select a separate private registry; use
the same override for previews that should discover one another. This shares
display observations and, for previews attached to the same runtime, their open
owner questions in Needs you (each World reads
the others over loopback with a per-run token); credentials, storage and
connections stay in each preview's own folder. Reports expire after 45
seconds without renewal, and stale reports have no open link. See the
[Shipyard API guide](shipyard-api.md#local-instance-registry) for bounds and CLI
try commands. No discovery probes or additional servers are started by Shipyard.

## Development tools

To inspect the Claude limits ownership repair without a live account, open
`/?claudeTapLockFixture`. The testing-only page removes its parameter immediately
and shows synthetic histories checked by the real filesystem regression. Click
**Suspend live writer** to see `20 → 22 → 23`; click **Recover dead writer** to
see `20 → 23 → 23`. Both stay within one reset window and never decrease. Reload
to leave this walkthrough. It does not execute tap writers in the browser;
`bun run test quint/claude-tap-lock.test.ts` exercises the actual protocol.

To check harness title spinners without running agents, open
`/?titleSpinnerFixture` on a development or preview World. The testing-only page
removes the parameter immediately and shows a synthetic `π`-prefixed title.
Click **Next spinner frame**: the raw title changes while **Displayed task**
stays `π Running tests`. Click **Change task**: it becomes `π Review results`.
Reload to leave the preview. This checks title display; the snapshot activity
and conversation-identity regressions check service admission and refresh.

World's event traces and renderer counters exist only in development builds:
`bun run dev:web`, or a production-style build with
`HERDR_WORLD_BUILD_DEVTOOLS=1 bun run build:web`. In such a build, Board's
**⋯ → Event trace** and Town's **Town event trace** switch in the settings menu
(or `?debug=board` / `?debug=town` in the URL) record a bounded, page-local trace
of input, gestures, effects, frames and errors; **Copy trace** puts it on the
clipboard for a bug report.
Nothing is sent anywhere. Release and package builds never set the flag, and the
web asset check fails a release build that carries any of it. See the
[World component routes](../web/src/world/README.md#development-tools).

## Linux installation acceptance

Run the real standalone installer in disposable Ubuntu 24.04 containers with
systemd as PID 1 and a normal user with a lingering user manager:

```bash
bun run test:install-linux
# Reuse an already packaged candidate instead of rebuilding it:
bun run test:install-linux --reuse --version 0.0.0-rc.1
# Pin the real core release; the default is latest:
bun run test:install-linux --core-version 0.1.21
# Diagnose one scenario:
bun run test:install-linux --reuse --version 0.0.0-rc.1 --case stopped
```

Requirements: Bun/dependencies, Docker with cgroup v2 and permission to run
containers with `SYS_ADMIN` and unconfined AppArmor/seccomp, and internet access
to Ubuntu, GitHub releases and releases.herdr.dev. No root shell or
`--privileged` is used. Missing Docker prints `SKIP` and succeeds locally;
`--require-docker` makes it an error in CI. An unavailable daemon, unsupported
cgroups or a failed download fails the run. `--version` selects the candidate
build version (or exact package in `dist/` with `--reuse`).

The cached dependency base allows one additional package-index refresh when a
mirror fails (including HTTP 520, which APT's native retries do not cover). Every index must
refresh successfully before package installation; signature checks stay enabled.
Repeated refresh failures and package installation failures still fail the run.
Both refresh attempts and installation share the base's 300-second deadline;
HTTP/HTTPS requests retain 15-second timeouts and one native retry. See the
[image guide](../scripts/install-linux/README.md) for cache and failure evidence.

Every default run uses five fresh containers:

| Case | Checks |
| --- | --- |
| `fresh` | Neither runtime installed; installer downloads and verifies core, enables its login unit and starts it. A container restart exercises reboot and the lingering user unit. Saved profiles contain only core, `core-local` is default, CLI lists it, and Town's snapshot has no dead Local building. |
| `core-only` | Core is already running at login, with no TUI or World profiles. First World startup discovers and saves core as its only default, and CLI/Town see it. Uninstall removes a running legacy World unit while preserving the core binary, login unit and running core. |
| `tui` | Official checksum-pinned Herdr TUI is present; installer preserves it without adding core or a unit. Manage connections' `connections.core_install` probe/install RPC installs, enables, starts and connects core, preserving the TUI binary and default. |
| `stopped` | A real core is installed but stopped; installer preserves it without a unit. Town's setup card's probe/install RPC starts and connects it, enables login and checks core-only profiles/default/topology. |
| `upgrade` | Installs the latest published stable World first, seeds synthetic connections/default and a real enabled core unit, then installs the candidate. Connections, default, unit contents/enabled state and live core connectivity survive. |

The upgrade uses the same stable-release resolver and current-shell-installer
policy as `scripts/installer-upgrade.ts`; it supplements that native matrix's
plugin, auth and migration coverage. In CI it reuses the validated
`INSTALLER_BASELINE_TAG` frozen by the native matrix, without another GitHub API
lookup. Otherwise it resolves the latest stable release; set `GH_TOKEN` locally
to authenticate that lookup if shared-IP rate limits apply. The release workflow
supplies its read-capable token for this lookup. Tokens stay outside the containers.
Only the upgrade baseline opts out of runtime
bootstrap while its pre-existing state is prepared. Other installations run real
runtime setup. The TUI executable comes from the official release URL and must
match the repository's reviewed SHA-256 before execution. Core comes from its
official HTTPS release manifest and archive, verified by the production installer.
To pin automatic bootstrap, a test-only curl wrapper substitutes only the official
latest manifest URL with the official pinned manifest URL; downloads and checksums
are never fabricated. A read-only mount serves World archives from an HTTP mirror
bound to loopback **inside** each container. No host ports are published, no host
runtime state is mounted, and the harness never operates host services.

Output names `[case] CHECK`, `PASS` and the failing check. A failure retains only
bounded synthetic-container journal diagnostics in command output, then tries the
remaining cases and exits nonzero. Containers, the image built by the run and
scratch files are removed on success, failure, SIGINT and SIGTERM; generated
candidate packages in `dist/` remain available for reuse. Docker's pre-existing
images and build cache are left alone. A forced kill or machine failure cannot
run cleanup. The resources carry the `herdr-world.install-test=true` container
label and unique `world-install-` names for identifying an interrupted run.

To prove a check catches an installer regression, run
`bun run test:install-linux --reuse --version 0.0.0-rc.1 --case fresh --fault skip-register`.
This skips `herdr_core_register` only in the disposable installer copy. The
core-only profile/default check must fail and cleanup must still complete;
tracked scripts are untouched. The focused harness tests exercise
cleanup on failure/interrupt, option validation and installation suite selection:

```bash
bun run test ./scripts/install-linux.test.ts ./scripts/validation-scope.test.ts
```

To add a case, add its name to `cases` in `scripts/install-linux.ts` and its
preconditions and named checks to `scripts/install-linux/scenarios.py`. Keep setup
and observations inside the container and drive user actions through the real RPC
or CLI. Await socket/systemd/World events with deadlines; do not add fixed sleeps.
Add the case to this table. macOS can later use a disposable macOS VM/runner with
a real launchd user session and the same case contract; this Linux suite does not
claim macOS or Windows service coverage.

Optional UI review: open `/town?coreInstall=ok` on a disposable preview (the
testing parameter removes itself), then open
**Town → Hosts → Manage connections → Install herdr-core… → This computer**
and capture the completed panel after **Install and start**. The panel must say
**Simulated**; this step must not install a runtime on your host. Keep screenshots
separate from installation acceptance; use the [five-viewport capture recipe](SCREENSHOTS.md#pr-screenshot-viewports)
with your own browser and the panel's `.core-install-lines` expected selector.
The automated install/start checks require no clicks or screenshots.

## Herdr-core release smoke

**Herdr-core release smoke** in GitHub Actions runs daily at 06:37 UTC and
with **Run workflow**. Select the branch to test, run it, then open **Newest
herdr-core release**. Its summary and 14-day artifact identify the resolved
release, target, SHA-256, live suites and exit status; the log includes failures
and measured latency/throughput. A red run flags drift or download failure; it
never pins core, changes runtime permissions or certifies a release. This job is
separate from ordinary unit/model checks, which need no live core. Installation
CI also runs the [real container cases](#linux-installation-acceptance) under
required **Delivery checks**.

GitHub enables manual dispatch and the schedule once the workflow exists on the
default branch. Before then, or to reproduce locally on Linux x64/ARM64:

```bash
bun install --frozen-lockfile
bun scripts/herdr-core-smoke.ts
# Include the fixed Windows relay's PowerShell checks when pwsh 7 is available:
HERDR_WORLD_PWSH="$(command -v pwsh)" bun scripts/herdr-core-smoke.ts
```

The runner always downloads `https://releases.herdr.dev/core/latest.json`, verifies
the archive against its SHA-256, and runs every `server/src/herdr-core/*.live.test.ts`
suite. It installs nothing. Live cores use isolated scratch HOME/XDG directories;
the harness stops their processes and the runner removes the download. Without
`HERDR_CORE_BIN`, ordinary test runs skip live-core cases. PowerShell-on-Linux
checks exercise framing and pipe relay behavior; real Windows ACLs, local core
and SSH behavior remain [known limits](../openspec/specs/herdr-core-runtime/spec.md#known-limits).
Recorded official-app and phone results remain historical evidence
in [the handover](../openspec/changes/archive/2026-11-17-herdr-core-runtime/delivery.md#owner-device-acceptance).

## Verification

```bash
bun run typecheck:quick       # source types without regenerating embedded assets
bun run test <path>           # focused Bun test
bun run test:quick            # non-Chromium suite
CHROME_BIN=/path/to/chromium bun run test:browser
bun run test:world            # all World browser acceptance suites
bun run test:world --shard=1/6 # reproduce one CI shard, one browser at a time
bun run test --web-browser    # Chrome-driven suites outside World, as CI's web job runs them
bun run build:site            # landing page/tutorial
bun run check                 # repository checks and tests
bun run check:delivery        # full local gate, including behavioral verification
```

Use `bun run test <path>` for every ordinary test, including focused cases.
Feature discovery uses committed `server/src/features/index.gen.ts` and
`web/src/features/index.gen.ts` indexes. After adding or removing a feature's
`register.ts` or `mount.tsx` under those roots, run `bun run features:generate`.
Each sorted line exports one module namespace; colliding export names are refused.
`bun run features:check` checks membership (ignoring order) in the static lane.
The `testing/probe` features are inert fixtures: the server probe is invoked only
by tests, and the web probe declares no `Host`, so the shell never renders it. The
proof in `scripts/features.test.ts` and `web/src/features/index.browser.test.ts`
runs them through every build path, including a compiled probe after deleting sources.

A web feature's `mount.tsx` holds wiring only and exports `id`, `slot`, `order`
and `Host`. `web/src/features/FeatureHosts.tsx` names the slots and the props each
passes (`dialogs`: the world and a launched-terminal opener, mounted in the
control plane's AgentDialogs), renders a slot's hosts by order then id, refuses a
duplicate id, and fails typecheck when a discovered `Host` does not fit its slot.
A host whose UI is heavy keeps it behind `lazyWithReload`, as the Memory Library does.

Server entries export `feature = defineFeature(...)` from `register.ts`.
Declare RPC verbs there once; the generated catalogue feeds admission and the
composer checks that factory handler keys match those declarations exactly.
Use `featureKey<Api>(id)` for the id and dependencies, list dependencies in
`requires`, and resolve their APIs with the factory's typed `get(key)`.
Composition validates the entire graph before creation, then creates dependencies
first with id order for ties. The read-only `FeatureKernel` provides service
ports and lazy, explicitly qualified runtime access; it has no default runtime
helper. Features receive status/listening hooks in composition order and stop
in reverse order per phase: `quiesce` fences work, `drain` precedes runtime stop,
and `close` precedes storage closure. Add a feature and regenerate the index
without editing the service root, World RPC router or RPC context. Presence is
the pilot; existing security and storage lifecycle owners remain in the root.

Use `bun run ci:health --days 3` for a read-only screen of recent CI and delivery
numbers (`gh` authentication required). `--days` accepts 1–30 and `--repo owner/name`
selects another accessible repository. Run it again after delivery to compare the
same window definition; do not infer an improvement from a different sample size.
The [pipeline guide](ci-pipelines.md#health-and-delivery-measures) defines the
request caps, sampling and missing incident links. Save an intended PR description
before pushing: `HERDR_WORLD_PR_BODY=/tmp/pr-body.md git push`. The pre-push
privacy step scans that body (or the existing PR's description) and the existing
PR title; description policy runs in CI, and `check:pr-body` remains the explicit
check before opening the PR.

The runner creates HOME and every XDG directory before launching Bun (a preload
cannot change Bun's cached home), removes inherited runtime/account settings and
builds a PATH from system tools plus the selected toolchain. Installed Herdr,
core and World, real harness records and SSH configuration are unavailable.
Tests that need configuration must write synthetic fixtures under scratch.
Runner-owned browser diagnostics retain `HERDR_DIAGNOSTIC_CHROME`,
`HERDR_BROWSER_DIAGNOSTICS_DIR` and `HERDR_BROWSER_DIAGNOSTICS_MODE`, including
through nested runners, so CI's Chrome adapter can launch and write its artifacts.

The preload guards Bun and Node process calls, fetch, WebSocket and socket
connections. Shell children also receive guarded service, SSH and download
commands; source Bun children carry the preload. A tripwire names the refused
call and leaves a run-owned failure record, so catching the exception cannot
hide it. Use injected `detect`, `run`, `download` and transport doubles, or
scratch executables. Installer fixtures pass an explicit scratch HOME and PATH
with fake curl/service/runtime commands. Use dynamic loopback ports and scratch
sockets; never use the running services on 8787/8788. The guard prevents accidental
host operations; it is not a sandbox for deliberately adversarial test code.
Executable checks compare resolved filesystem identities for both the fixture
and its scratch root, so macOS `/var` and `/tmp` aliases work without permitting
fixture symlinks to host executables.

Run a live test explicitly, for example
`HERDR_CORE_BIN=/path/to/disposable/core bun run test --live server/src/herdr-core/core.live.test.ts`.
Only named live files may use `--live`; ordinary inventory ignores inherited
live flags. Live suites still get a scratch home and keep their existing isolated
runtime setup and teardown. They bypass both preload and shell-command guards,
and retain a supplied `XDG_RUNTIME_DIR` for user-manager access; config, cache,
data and state remain in scratch. `bun scripts/herdr-core-smoke.ts` is the separate,
explicit download-and-live release check. Direct `bun test` explains which
wrapper to use and exits before loading tests. The resource-verification gate uses
this explicit live route for its real-cgroup controls, retaining
`HERDR_RESOURCE_MANAGER=user|system` only in live runs; ordinary test inventory
cannot inherit that selection.

The portability lint in `bun run lint` catches renamed coreutils process fixtures:
uutils dispatches on the executable name and may reject a symlinked `sleep` that
GNU accepts. Preserve command basenames when constructing a fixture PATH; use a
shell blocked on stdin or a compiled probe when a process needs an unusual name.
This covers the known CI tool gap without container startup in the pre-push gate.

Ranger recovery fixtures use a saved synthetic custom model with a loopback
endpoint. They exercise the real SDK in source and standalone processes without
relying on fetch-preload ordering to redirect a production provider address.

Process fixtures run fake behavior in the test process where practical. The
[diagnostics adapter](../scripts/browser-diagnostics.ts) and
[native plugin dispatch](../server/src/config/plugin-command.ts) accept narrow
process doubles with production defaults. Launcher and hook fixtures call the
real status/scope producers in-process and retain CLI conformance cases.
The [SSH process fixture](../server/src/connections/testing/inProcessSsh.ts) keeps
forwarding in-process, with a private Unix-socket transport through `curl` and
small shell shims so real PID death, reconnect isolation and socket cleanup stay
covered. It requires `curl` on Unix. Real inherited-pipe and argv/exit regressions
also keep lightweight shell children; Windows retains Bun for these OS-boundary
fixtures because it has no required POSIX shell. Keep those boundary checks,
assertions and deadlines when optimizing fake startup. Measure alternating
baseline/candidate runs and report negligible or negative results honestly.

The diagnostics adapter detaches its WebSocket callbacks before returning so a
late close event cannot write to a completed or removed log. The arrangement-menu
browser fixture retains task boundaries and attaches mount/unmount, focus,
resize, scroll, load and first-query traces to failures. Its first-open CI failure
remains undiagnosed; local passing traces do not establish a cause.
Worker rejection tests settle the promise before asserting on the error, because
Bun's asynchronous rejection matcher can block MessagePort delivery.

All six storage `*-crash.test.ts` suites use the
[shared crash harness](../server/src/storage/testing/crash-harness.ts).
The native installer matrix runs these suites with one test-file worker and
one concurrent case, so standalone compilation does not compete with other
suites' SQLite recovery on the same runner. The watchdogs below remain unchanged.
Compilation, seed initialization and fault setup finish before recovery assertions
start. Seed initialization keeps its five-second hook; each child has its original
watchdog plus a five-second kill/reap/stream-cleanup bound. Compilation keeps its
own process budget with the same cleanup headroom. Recovery retains each suite's
configured deadline, including storage reopening and the original assertions:

| Suite | Compilation | Fault child | Recovery |
| --- | --- | --- | --- |
| Board, profiles, runtime status | 60 s | 15 s | 5 s |
| World storage before/after COMMIT | 60 s | 15 s | 5 s |
| World storage acknowledgements/drain and effect recovery | 60 s | 15 s per child | 30 s |
| Terminal marks | 60 s | 15 s | 30 s |
| Answer delivery | 120 s | 30 s | 60 s |

World's two-child setups retain their order. Answer delivery's second process
remains after its initial storage assertions, with its existing 30-second bound
inside the 60-second recovery case. Source and standalone runs keep the same
fault markers, forced kills, clean drains and embedded workers.
Crash subprocess ownership ends at the Node child-process `close` event, after
exit and stdio closure, before the standalone tree can be removed. The
[child adapter controls](../server/src/storage/testing/crash-child.test.ts)
exercise exit-before-close ordering and startup failure without filesystem retries.

Failures emit `compile`, `spawn`, `marker`, `kill` and `reopen` timings, including
pending or not-reached phases. Repeated phases appear in execution order. These
are failure diagnostics, not latency assertions. Native Bun hook/test timeouts
also report unfinished phases at finalization. Timer/reader release is
unconditional on stream or exit errors; cleanup failures retain an earlier
failure as their cause. Final directory removal awaits the installer's shared
cleanup helper: retryable filesystem errors get at most five yielding retries
(1.5 seconds of total backoff) after children are reaped. Persistent locks still
fail teardown. This handles Windows handles retained briefly after process exit;
it does not retry compilation, crash setup or recovery. The installer's portable
filesystem-denial and native Windows lock tests cover the shared removal policy.
No suite retries a failed schedule. The
[harness controls](../server/src/storage/testing/crash-harness.test.ts) use virtual
time and process doubles for budget separation, diagnostic and cleanup failures.

The test wrapper runs ordinary files in parallel using up to eight available CPUs.
Set `HERDR_TEST_PARALLEL`
to choose a default worker count and `HERDR_TEST_MAX_CONCURRENCY` to cap concurrent
cases, or pass Bun's `--parallel=N` flag to override the worker count for one run.
An unfiltered `bun run test` runs the remaining suite first, then all World browser
tests with up to four file workers and one case per worker. World bundles are built once
per run; each case retains its own server, fixture and fresh browser profile.
Focused test files build a bundle once per file. Production responsiveness cases
are serial within each file so their global diagnostic instrumentation cannot overlap.

`useWorldObservation.test.ts` mounts the real observation hook on the test clock
for watch revision and unavailable-host scope policy. Actions browser cases keep
rendered watch feedback, qualified action wiring and focus at desktop/phone widths.

Keep policy checks headless once a replacement test and its mapping in
`verification/coverage/` exist. Retained browser cases name the behavior that
requires a browser: geometry, trusted input, focus, rendering, renderer lifecycle
or visual comparison. For example, `useWorldCreatedTerminal.test.ts` mounts the
production creation hook and the Inspector selection-lease effect on the test
clock to check admission retries, deadline cancellation and stale observations.
`WorldTerminalHandoff.test.ts` and
`SharedViewCreation.test.ts` retain launcher wiring, focus, rendered Inspectors and
real terminal ownership. Controlled opener tests do not replace browser evidence
that the actual opener honors cancellation.
`useHostsFilter.test.ts` runs the real Hosts hook and catalogue refresh on the
test clock, including delayed/empty admission and saved-scope reconciliation.
`HostsFilter.test.ts` retains responsive geometry, rendered navigation and removal
feedback, Inspector focus and terminal lifecycle. Town cases stay in the browser.
The handoff browser probe holds the real browser-local focus request, then uses
controlled admission time and named opener completion for its cancellation
check; see [the fixture clock guide](../web/src/world/README.md#browser-fixtures-on-test-time).

**Known limitation: native sequential World browser runs.** Direct `bun test` runs
across multiple `HostsFilter*.test.ts` or `ProductionContexts*.test.ts` files,
without `--parallel` or runner-prepared assets, can serve missing browser assets
and time out. Bun shares the bundle-cache module between sequential files; the
first file's cleanup deletes the bundle directory while later files reuse its
cached path. Check the execution mode and bundle files when investigating these
timeouts. The native sequential cleanup fix is deferred.

Use the World runner, or isolate files even when running one at a time:

```bash
bun run test:world
bun run test ./web/src/world/ProductionContexts*.test.ts --parallel=1
bun run test ./web/src/world/HostsFilter*.test.ts --parallel=1
```

`--parallel=1` runs one file at a time with isolated modules, avoiding the shared
cache lifetime issue. Higher file parallelism also isolates modules. The World
runner and its CI shards prepare bundles before testing and own their cleanup;
those paths are unaffected, including shards with one file worker.

PR CI and Release run the remaining repository checks with one file worker and up
to two concurrent cases, preserving the upstream test configuration. Both call the
[shared World browser workflow](../.github/workflows/world-browser.yml), which runs
six separate runners, each with one file worker and one active case, and
the web browser lane (**Web browser shards** in PR CI). Browser jobs install the
Chrome for Testing build pinned in
[`tools/chrome/test-chrome.json`](../tools/chrome/test-chrome.json) (checksum
verified, cached) and print its version and the runner's CPU, so a browser
update is a reviewed change rather than a runner-image roll-out. Ubuntu 24.04
and later deny unprivileged user namespaces to programs without an AppArmor
profile, which aborts Chrome's sandbox outside the packaged path; on CI the
installer loads a profile like the Chrome package's for the pinned binary, and
then starts it headless once, so a browser that cannot start fails installation
rather than every test. Locally it prints the two commands instead. No job retries a
failed test. The [shard inventory](../scripts/world-browser-suites.ts) splits all
World browser suites between the six shards, discovering `*.test.ts` and
`*.test.tsx` files recursively under `web/src/world/` with the
`// @world-browser-suite` marker or Chrome launch code. Measured weights in
`scripts/world-browser-timings.json` are optional: new suites use ten seconds
until measured, and stale weights add no suites. Shared bundle entries are
discovered from `web/src/world/*.browser.tsx`. Inventory checks reject missing
or duplicate assignments. The required Delivery checks status succeeds only when
every applicable static, dependency, unit, World/web browser and model leaf,
along with PR description policy, passes.
Markdown-only and exact-head reuse keep their existing shorter paths.
PR CI supplies Linux source/browser evidence; main reports the same immutable
PR result without heavy checks. Release tags build/test installed channel bytes
before sealing. Release-please updates version/changelog metadata and dispatches
ordinary PR CI automatically. The web browser lane runs the Chrome-driven suites
outside World (`webBrowserSuites`) one file at a time.

Each World run writes JUnit results and per-file timings under `.agents/delivery/`.
CI uploads them as `world-browser-N-attempt-M` artifacts, and the web job's JUnit results as `web-browser-attempt-M`, including on test failure. Compare
the slowest shard and total delivery time before changing the shard assignment or
concurrency. The slowest file bounds the slowest shard, so add shards only when
the slowest shard holds more than one long file. Keep all scenario combinations, dense
fixtures, real deadline checks and work-count ceilings when rebalancing.

No World test asserts a wall-clock number. The dense suites (production and
concurrent contexts) assert what does not depend on the runner's speed: routing
and generation of every input, one acknowledgement per input, frame coalescing,
and ceilings on the work done per phase (terminal mounts, card observer
registrations, Board commits, World preparations, construction units and
projections, counted by dev-only counters in the production modules; see
`web/src/world/testing/workCeilings.ts`). Their input delays go to the
non-blocking [World latency trend](../.github/workflows/world-latency-trend.yml):
on every main push, and on a pull request labelled `latency-trend`, it runs each
of those suites alone on a quiet runner (`scripts/wait-for-quiet.ts`: three
consecutive seconds at least 90% idle, at most 60 s) with the pinned Chrome, and
its summary sets each p95 and worst delay beside the median of recent main runs
on the same CPU model, marking a rise over 25% (`scripts/latency-trend.ts`).
Hosted runners differ by CPU model and image, so a timing is comparable only
within one; no branch rule requires the trend.

Production responsiveness cases also save `world-production-*-inputs.json` in
those CI artifacts. These lightweight timings correlate independently scheduled
inputs with browser dispatch, service replies, browser acknowledgements and
snapshot admission. Inspect them when the latency trend flags a rise; CI keeps full Chrome
timeline tracing disabled to avoid adding its recording cost to the benchmark.

World browser harnesses use two bounded phases through
[`waitForBrowserFixture`](../web/src/browserChrome.ts): Chrome has 35 seconds
from launch to request the fixture's main HTML document, then the existing
per-fixture deadline begins. The fixture budget still includes serving HTML and
assets, application initialization, interaction and every assertion. Browser exit
fails either phase immediately, and deadline timers are cleared on completion.
The outer Bun timeout includes setup, the startup allowance, fixture execution
and cleanup. Rendering and operation-specific limits are unchanged.

This boundary addresses a confirmed first-case CI failure: Chrome reached its
debugging endpoint after 18.4 seconds, connected after 25.5 seconds and requested
the Spaces page around 27.4 seconds. The original 30-second timer expired while
the fixture was still completing checks without reported failures. A controlled
31-second browser launch delay reproduced the old timeout before Chrome started;
the repaired harness completed all Spaces assertions in 33.3 seconds, with the
same 30-second fixture limit. This proves startup consumed the acceptance budget;
it does not identify why Chrome initialization was slow on that runner. Diagnose
any failure after the page request separately, using fixture progress or input
artifacts, rather than extending an acceptance limit.

A separate compact Inspector failure occurred after page loading: the terminal
handoff fixture checked `data-view="files"`, optionally clicked the Files back
action and slept for 80 ms before checking explorer geometry. React can commit
that view attribute before its retained-file effect renders the back action, so
the optional click could be skipped. The fixture now waits for the back action,
clicks it and waits for the explorer layout within its original deadline. A
controlled one-second back-action lookup delay reproduced the exact old geometry
failure and passed with the repaired synchronization. Keep readiness checks tied
to the next required action; a view attribute alone does not prove it is ready.

For browser startup or rendering timeouts, dispatch CI with
`browser_diagnostics=true` and an immutable `diagnostics_baseline` commit. The
optional lifecycle jobs compare HostsFilter creation, Board and Spaces
arrangement on the baseline and dispatched revision, alternating which runs
first on each runner. Both checkouts install their own pinned dependencies, and
both revisions run even if the first fails. Each browser records Chrome stderr,
document readiness, load events, JavaScript exceptions, failed requests and exit
signals in `browser-lifecycle-*` artifacts. These diagnostic runs use one file
worker and one case at a time with each revision's assertions and deadline boundaries.

```bash
gh workflow run ci.yml --ref agent/example-change \
  -f browser_diagnostics=true -f diagnostics_baseline='<baseline-commit>'
```

Diagnostics add an observer and can affect timing. Use the lifecycle evidence to
locate a failure, then verify any repair with ordinary CI. A passing retry alone
does not establish a cause. First-case timeouts have occurred with one worker in
several suites; distinguish browser startup, page loading and fixture execution
before changing concurrency or an acceptance limit.
Use `diagnostics_mode=stderr` for a control run that captures Chrome logs without
adding a debugging port or attaching the lifecycle observer.

`HERDR_TEST_EXCLUDE_WORLD_BROWSER=1` is for the CI repository-validation job, which
is gated together with the separate World shards and web browser job; it leaves out
every suite those jobs run. Do not use it as a complete local
check. The existing `test:browser` selection covers upstream and selected World
files; use `test:world` for the complete World browser matrix.

`bun run check` validates dependency notices, formatting, lint, all types/tests,
production frontend/server builds and OpenSpec contracts. Generated output belongs in
ignored directories and must not be committed.

Its static checks come from the same lane as `check:delivery` and `check:changed`.
That lane checks source types without invoking server's asset-building
`pretypecheck`, then builds and validates production assets once. `check:commit`
is the read-only format/lint guard used by the Git hook; `check:source` adds the
asset-building type check and tests for release preparation and tag validation.
`precommit` remains a compatibility alias for `check:source`. See the
[pipeline ownership guide](ci-pipelines.md) for the full command matrix.

## Architecture while developing

The service owns connection profiles and isolated runtimes. Global RPC methods such as
`connections.*` and `world.snapshot` do not carry a focused connection. Every
downstream Herdr operation carries both `connection_id` and
`connection_generation`. Keep aggregate observation internal and project only the
selected host into visual surfaces; send terminal,
resource and mutation work through the qualified focused-runtime path.

See [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) and the
[capability lookup](agent-development.md#find-a-feature).

The optional cost metrics provider is service-owned. For local testing, set
`HERDR_WORLD_OTEL_PROMETHEUS_URL` on `dev:server` or use the cost metrics dialog;
do not add browser-to-Prometheus requests. The provider intentionally accepts only a
base URL and fixed queries. See [deployment](DEPLOYMENT.md#optional-cost-metrics).

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

## Harness spawn stamps

Herdr has no creator field, so a harness or skill that starts another agent
stamps the child pane with its parent; World then groups the two:

```bash
herdr-world stamp w1:p2 w1:p1   # child, then parent
bun run agent:stamp -- w1:p2 w1:p1   # from a checkout
```

The command reads both panes, then reports two tokens on the child with source
`herdr-world:spawn` and no TTL: `spawned_by` (the parent's pane ID) and
`spawned_by_terminal` (its terminal, which survives a move of the parent).
Another tool can write the same tokens. World saves the last claim it sees on
a live snapshot, qualified by connection and runtime generation, so the
relation outlives a token cleared while both agents run. Herdr issues new
terminal IDs when it restarts (pane IDs are reused), so a claim or group from
before a restart can never match again: once a current snapshot that lists
every pane of the connection shows its terminals closed, the service drops it
(an offline host keeps it, shown stale). Stamp the restored agents again to
relate them. Magnetic Teams never span connections; the service refuses one that
would. The service saves a claim for every stamp in a snapshot before sending
it, so the browser derives relations from saved claims and groups alone and
never scans panes for stamps. A stamp
with `spawned_by_terminal` is resolved only by that terminal, never by a pane
ID that may since name another pane. Inside an agent pane `HERDR_SOCKET_PATH` selects
that pane's own Herdr ahead of `--session`; pass `--socket-path` to target
another. Experiment only in a throwaway `herdr --session`.

From inside the child pane, `herdr-world spawned-by w1:p1` makes the same
stamp through the running World service, which first checks that the caller
runs in that pane.

## Town move execution

`server/src/world/town-move.ts` owns desk/pane move orchestration independently
of the RPC transport. Its caller injects the captured connection ID/generation,
current-runtime check, Herdr call, Board access/publication and the service's
shared `townMoveQueues` map. It never looks up a default connection. A queued
retired generation is refused before reading another runtime; the existing
`moveDesk`/`movePane` functions reread topology after queue admission and keep
their layout, last-room, rollback and uncertain-step rules. Source colours are
captured at queue entry.

Native movement and appearance/Board reconciliation finish in the same queue
slot, matching the shared appearance contract. Both RPC and CLI capture
colour intent at admission and read the latest fields after asynchronous probes,
so operator edits survive native close cleanup and movement. Per-field edit
revisions, bounded by current saved appearance bindings,
distinguish an explicit reset from an untouched field during a move. After
relocation, reconciliation replays the latest committed source/destination
field values, preserving qualified saves addressed to the new native IDs as
well as saves admitted against the old IDs. Compensation compares every alias
that converges onto a restored native ID. Explicit colour intent survives
native-close cleanup; a colour restoration supersedes that intent. This bookkeeping is transient;
the persisted appearance schema stays the same. Successful moves follow confirmed
replacement IDs; failed moves reconcile only observed terminal witnesses. Unknown locations
are not guessed or retried. Board-follow errors are reported separately while
the real move outcome is preserved. RPC keeps transport replies and synchronous
unmatched-method decline. This extraction adds no user controls or camera policy.

## Stored Groups

World stores Teams, Pods and generic kinds in the existing Board document's
`relations.groups`; Room and Desk are Herdr projections and are refused in this
store. A stored Group has `id`, `kind`, optional `name`, `members`, optional
`attrs`, and `created_at`. Each member has `ref`, `roles`, `joined_at` and an
optional `name_at_join`. `shared/groups.ts` owns validation and observation-only
address resolution; `server/src/world/board-groups.ts` applies the operations.

Old magnetic groups migrate to kind `team`, with terminal refs wrapped as
members, empty roles, and their creation time used as the join time. Reading
preserves the file and revision; the next ordinary write saves the new shape.
Teams remain confined to one connection. Closing a terminal prunes only Team
membership, only after a complete current snapshot; an unnamed Team with fewer
than two members disappears. Named Teams can remain empty. Spawn claims remain
separate. Only Teams feed magnetic layout, grouping menus and the existing CLI's
group/ungroup undo; Pod membership never pulls desks or cards together.

Pods are named and use canonical `agent://<immutable-connection-id>/<agent-name>` addresses,
with each component percent-encoded. They may span connections and survive pane
replacement. Missing or stale observations resolve as away; multiple current
matches resolve as ambiguous, with no guessed occupant. Neither can supply an
action target. Custom kinds have no exclusivity or implicit pruning.

The existing Board patch path accepts `group.create`, `group.join`,
`group.leave`, `group.set_roles`, `group.set_attrs`, `group.delete` and
`group.promote`. New join/leave operations use `id` and `refs`; join can add
`roles`. Legacy terminal `members`/`target` joins and `members` leaves retain
Team semantics. `group.set_roles` replaces roles for existing members;
`group.set_attrs` changes `name` and merges `attrs` (null clears either).
Kinds cannot be changed through that operation. Promotion is explicitly
Team-to-Pod: `mapping: [{from: <terminal-ref>, to: <agent-address>, roles: [...]}]`
must map every existing member exactly once to a distinct address. The group
keeps its ID and creation time. Room/Desk creation or promotion is refused.

Lead and builder are pooled exclusive roles: an address can hold either or both
in one Pod total, while reviewer can span Pods. A conflicting edit fails
atomically. Join, role edits and promotion can use `replace: true` only after an
explicit transfer confirmation; this removes lead/builder roles from the other
Pod, preserving reviewer and other roles. All operations in a Board patch,
including these transfers and their attribution, save together or not at all.
Existing revision-conditional writes remain available through `patchIf`.

Lead/reviewer edits are reserved to the user or FirstMate by **crew rule**.
World's trusted single-user service does not authenticate that distinction or
prevent self-promotion. A sender name is attribution, not authorization. An
optional sender claim is `{label, basis: "reported" | "inferred", via?}`; missing
attribution remains `{basis: "unknown"}`. Existing CLI group/ungroup and undo
forward the caller label as inferred when process-verified, otherwise reported;
this does not authenticate a human/FirstMate distinction. `via` records a channel, not a claim
basis. PR merge/close/ready actions stay browser-only and are not added to the
World CLI, its skill, MCP or message ledger.

`relations.group_changes` retains the most recent **128 events**, including
records for deleted groups. Each carries `group_id`, Board `revision`, time,
operation, sender and complete member role diffs. A diff can contain 64 entries
when 32 old refs are replaced by 32 new refs; it is never clipped. No-op edits
add no events. Retention may remove older events from a revision: this is recent
attribution, not a complete audit or message ledger. Data remains subject to the
Board byte cap, 500 groups, 32 members per group, 32 Pods per participating
connection and bounded roles/attributes. Pods default to `open_pr_limit: 2`;
`open_pr_limit` and ordered `queue` are intent, never enforced work limits.

### Group projections and derived facts

`shared/groupViews.ts` combines stored Groups with bounded Herdr observations
and existing source work links. Room members are qualified Desk/tab refs; Desk
members are qualified terminal refs. These projection refs stay separate from
stored `GroupRef` and never enter `relations.groups`. Their view keys use a
separate namespace, so a stored ID cannot shadow a Herdr projection. Cached
Herdr groups remain visible as noncurrent observations without live roll-ups.

`shared/groupObservations.ts` gives service and browser adapters the same
admission rules. Only ready, actionable, nonstale snapshots from the current
runtime generation supply live members. A Pod resolves using the actual
`agent.list` name qualified by pane, terminal and harness, never a truncated
display label or the harness name. Conflicting current names and mismatched
session metadata do not select an occupant. Existing service/browser session
fingerprint functions qualify work links identically.

Away and ambiguous members contribute neither status nor work. Present
terminals are deduplicated across member refs; status rolls up worst first:
needs you, failed, working, finished, quiet, unknown. Open PRs are deduplicated
from existing source links matched by connection, generation, pane and session;
merged/closed PRs are excluded. A Pod defaults to a displayed limit of two,
and exceeding the limit sets a warning without preventing any edit. GitHub's
source status distinguishes current counts, stale cached work and unavailable
counts; only current counts produce a limit warning. The Now
list is the stored ordered queue. This read model copies no source facts into
the Board and grants no downstream operation lease.

The Groups CLI, roster and Town Summary use this read model rather than
duplicating topology or source ownership.

### Group CLI and Herdr membership moves

`herdr-world group` supplies create, add, remove, lead, reviewers, now, list,
show, delete and promote. `pod`/`team` aliases supply the kind. Names must resolve
uniquely; explicit addresses preserve away Pod members. Teams require a current
terminal on their connection. Promotion preserves identity and requires an
explicit complete terminal-to-address mapping. An exclusive-role transfer needs
`--replace --yes`; deleting needs `--yes` and never deletes agents.
Lead/reviewer edits follow the user/FirstMate crew rule across every verb.
There is no caller identity allowlist or authenticated role gate. The actual
CLI actor supplies the reported/inferred sender claim, or unknown when absent.
Group changes use bounded `relations.group_changes`, outside Board CLI undo.

`group import FILE --yes` reads one explicit Pod table on the CLI side (48000
characters, at most 32 rows), with Lead/Builders/Reviewers and optional Now. It
resolves names under the selected connection or accepts a caller-supplied JSON
name-to-address mapping for away/annotated names. All creates are one Board
transaction; duplicate role/Now columns, mismatched table columns, existing Pod
names, unresolved names, caps or exclusivity conflicts refuse the entire import. No existing Group is overwritten and no background
file watcher or synchronization exists. `group list --kind pod --markdown`
renders qualified role refs and ordered Now items with escaped table content.
Derived PR counts are display-only; this rendering is not a full Board backup.

Room moves preserve a desk's chosen colour or its spawn-parent colour
inheritance. Saved relations and colours are captured at queue admission; a
colour or spawn claim changed after the preview is read at that boundary.

Rooms/Desks remain unpersisted. Their create/delete/role edits are refused.
`group add DESTINATION AGENT --herdr` reads a complete effect from the captured
connection/generation before moving. Room moves print the whole desk and every
agent; Desk moves print the selected pane and destination. JSON mode sends this
preview to stderr and retains one JSON result on stdout. Its hash binds the
qualified identities, names/sessions and destination; queue-entry rereading
refuses a changed plan, and native move admission checks terminal witnesses.
`--allow-close-room` separately opts into closing a source room's last desk.

`group-move.ts` uses the same injected service-owned queue as RPC through
`town-move.ts`, with no default-host fallback or RPC context dependency. The
existing native rollback, uncertain-step handling and post-queue observed Board
reconciliation apply unchanged. CLI results retain the real move outcome and
confirmed locations: Done, Partly done, Not done, or Unknown. Failure returns a
nonzero exit plus the structured result; Unknown is never automatically retried.

### Groups panel

`groups/GroupsWindow.tsx` mounts in WorldControlPlane inside the existing
WorldPanels provider. Actions opens it with the `herdr-world:groups-open` event;
spatial signs can supply the stable view key. It reuses the window manager and
panel chrome. `useGroups` subscribes to existing runtime/source observations and
owns only its reference-counted Board subscription; it never stops the shell's
runtime owner. The detail reuses browser-only PullRequestCard controls.

`shared/groupOps.ts` supplies the existing Group operation types to both browser
and service. Forms and confirmations pass the reviewed Board revision through
BoardDocumentStore and the optional `world.board.patch` revision parameter to
BoardStore.patchIf. A stale revision returns current state/conflict without retry.
Add captures that revision when its form opens, including before transfer
confirmation. Add/Edit/Roles close only after their completion callback reports
a successful write. A refused write keeps the draft and form-local error;
adopting the refreshed revision requires an explicit review action and never
dispatches a write itself. Current-agent Add captures its canonical ref and
connection/generation/pane/terminal/name/session witness at selection, then
revalidates without substituting a replacement. UI and CLI terminal selections
must have one current Herdr name match on that connection before deriving a Pod
address; an explicit qualified address remains intentional, including when away
or ambiguous.
Legacy callers omitting a revision keep their existing operation-specific rules.
Browser edits without an explicit sender claim retain unknown attribution; the
crew rule is explanatory, not a principal check. Ambiguous member inspection
revalidates connection, generation, terminal, pane and session before opening,
and never persists a tie-break or changes effective membership.

### Group and agent Interest

Board `layout.group_interest` stores Focus/Mute viewer intent by immutable stored
Team/Pod ID, separate from membership and attrs. Default removes the overlay.
Projected Room/Desk controls and persistence are refused in v1. Group deletion or
Team dissolution removes its overlay in the same Board write; transient unresolved
membership does not. The existing layout-entry cap includes these preferences.
`board-interest.ts` owns parsing and writes without changing terminal pruning.

Explicit terminal overrides now include watching (force-Watch); null/deletion means
Default (from groups). Old absent records keep that meaning; no former explicit
Watch is guessed. At read time an agent override wins, else group Focus beats
Mute, else watching. `shared/groupInterest.ts` derives from current unambiguous
members without copying terminal choices or changing status/reception. Focus is
a union of reachable effective-focused terminals. The cached live reader keeps
consumer identity for unrelated Board edits and resolves address restarts afresh.

`useChimeHost` installs the live reader into the real chime source, and Inspector
bells explain the winning claim and overrides. The existing `shouldChime` remains
decisive: Town-master needs-you bypasses focus only, never mute, device-off,
motif-off or seen. Reception and needs-you counts remain independent.

## Agent CLI

`herdr-world --skill` is the agent guide (`server/src/cli/world-skill.ts`).
The verbs (`server/src/cli/world.ts`) POST to `/api/world/cli` on the running
service (`server/src/http/world-cli-endpoint.ts`): loopback only, no browser
Origin, and a bearer token derived from the session signing secret
(`worldCliToken`), so it rotates with the login credential and cannot log a
browser in. Wrong tokens get the login throttle, counted apart from logins so
they never lock the user out. One call holds at most 20 s for `ask --wait`.
World's pages fetch only the open questions (`world.asks.get`), and only when
a ledger notice says a question changed. `ask --key CAUSE` deduplicates a cause
for the verified asking occupant, even after an answer; `ask withdraw ID`
closes that cause and allows recurrence. Only the verified original connection,
runtime, terminal and session may withdraw it. The user may dismiss any open
question in World (`world.ask.dismiss`): it closes without an answer, and a
keyed repeat returns it, as it returns an answered one, until the asker
withdraws. A waiting CLI returns on answer, dismissal or withdrawal. Closed
questions are retained and trimmed together. New verified asks carry their
runtime, terminal, workspace and session identity into reception and
notification targets; an unverified ask carries them, still marked
unverified, only when exactly one local Herdr has the pane it claims and every
other candidate local Herdr explicitly reports `pane_not_found`. A timeout,
unavailable or unsupported host, or a malformed pane reply, leaves that ask in
the question list without a reception or notification target. Remote hosts do
not participate in this local placement check. Asks
from agents also carry Herdr's agent name (`agent.get`). World announces newly
observed asks once, and excludes closed asks from every open-question
projection. Behind a reverse proxy on
loopback every peer looks local, so "loopback only" is a transport rule, not
proof of locality: the token itself stays in the service's private data
directory, and attribution still needs the caller's process on this machine.
When a call names a pane, the service asks Herdr for that pane's shell and
foreground processes (`pane.process_info`), looks for the caller's TCP
connection (address and port, failing closed on any ambiguity) among them and
their descendants through `/proc`, and accepts its `HERDR_PANE_ID` only when it
is found there on a local Herdr (`server/src/world/caller-identity.ts`). A call
naming no pane is not looked up and is labelled "terminal with no pane"; a
claim that is not a Herdr pane ID is refused. Unverified callers share one
allowance of open questions. A call through a proxy, such as the Vite dev
server, reaches the service from the proxy's connection, so it is never
verified: point `HERDR_WORLD_URL` at the service's own port. Board changes, questions and results live
in `world-ledger.json` beside the Board file (`HERDR_WORLD_LEDGER_PATH`
overrides it). To try it against a development service, run the CLI with the
same `HOME` (or set `HERDR_WORLD_URL` to its loopback URL and
`HERDR_WORLD_TOKEN` to its CLI token), and point the service at a
throwaway `herdr --session` with explicit `--socket-path` and
`--client-socket-path`.

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
