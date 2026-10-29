# Development

Herdr World uses Bun 1.4.3, React/Vite and a Bun server. Herdr is an external runtime.

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

## Development tools

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

## Verification

```bash
bun run typecheck:quick       # source types without regenerating embedded assets
bun test <path>               # focused Bun test
bun run test:quick            # non-Chromium suite
CHROME_BIN=/path/to/chromium bun run test:browser
bun run test:world            # all World browser acceptance suites
bun run test:world --shard=1/6 # reproduce one CI shard, one browser at a time
bun run test:world --shard=latency # the latency-budget suites, as CI's quiet job runs them
bun run test --web-browser    # Chrome-driven suites outside World, as CI's web job runs them
bun run build:site            # landing page/tutorial
bun run check                 # repository checks and tests
bun run check:delivery        # full local gate, including behavioral verification
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
bun test ./web/src/world/ProductionContexts*.test.ts --parallel=1
bun test ./web/src/world/HostsFilter*.test.ts --parallel=1
```

`--parallel=1` runs one file at a time with isolated modules, avoiding the shared
cache lifetime issue. Higher file parallelism also isolates modules. The World
runner and its CI shards prepare bundles before testing and own their cleanup;
those paths are unaffected, including shards with one file worker.

PR CI and Release run the remaining repository checks with one file worker and up
to two concurrent cases, preserving the upstream test configuration. Both call the
[shared World browser workflow](../.github/workflows/world-browser.yml), which runs
six separate runners, each with one file worker and one active case,
**Web browser tests** and **World latency budgets**. That job runs only the suites that assert
wall-clock budgets (production contexts, concurrent contexts, terminal handoff):
it waits until the runner is quiet after setup (`scripts/wait-for-quiet.ts`:
three consecutive seconds at least 90% idle, at most 60 s) and then runs them one
case at a time. A failed case runs once more (`--retry=1`): a hosted runner still
produces the odd slow event, and the worst-event budgets are judged on one run.
The shards never retry. The [shard inventory](../scripts/world-browser-suites.ts)
includes all World browser suites, split between the six shards and the
`latency` group; inventory checks reject missing or duplicate assignments. The
required Delivery checks status succeeds only when repository validation, every
World shard, the web browser job and the latency job pass. Markdown-only and exact-head reuse keep their existing shorter paths.
Release packaging requires repository validation, all six shards, the web
browser job and the latency job to pass. **Web browser tests** runs the
Chrome-driven suites outside World (`webBrowserSuites` in the same inventory) one
file at a time; an inventory check rejects an unlisted one.
Prepare Release validates its generated working tree in one checkout with one file
worker; it retains the complete World suite, with one active World case at a time.

Each World run writes JUnit results and per-file timings under `.agents/delivery/`.
CI uploads them as `world-browser-N-attempt-M` and `world-latency-attempt-M`
artifacts, and the web job's JUnit results as `web-browser-attempt-M`, including on test failure. Compare
the slowest shard and total delivery time before changing the shard assignment or
concurrency. The slowest file bounds the slowest shard, so add shards only when
the slowest shard holds more than one long file. Keep all scenario combinations, dense
fixtures, real deadline checks and input-latency budgets when rebalancing.

Production responsiveness cases also save `world-production-*-inputs.json` in
those CI artifacts. These lightweight timings correlate independently scheduled
inputs with browser dispatch, service replies, browser acknowledgements and
snapshot admission. Inspect them when a latency limit fails; CI keeps full Chrome
timeline tracing disabled to avoid adding its recording cost to the benchmark.

World browser harnesses use two bounded phases through
[`waitForBrowserFixture`](../web/src/browserChrome.ts): Chrome has 35 seconds
from launch to request the fixture's main HTML document, then the existing
per-fixture deadline begins. The fixture budget still includes serving HTML and
assets, application initialization, interaction and every assertion. Browser exit
fails either phase immediately, and deadline timers are cleared on completion.
The outer Bun timeout includes setup, the startup allowance, fixture execution
and cleanup. Input latency, rendering and operation-specific limits are unchanged.

This boundary addresses a confirmed first-case CI failure: Chrome reached its
debugging endpoint after 18.4 seconds, connected after 25.5 seconds and requested
the Spaces page around 27.4 seconds. The original 30-second timer expired while
the fixture was still completing checks without reported failures. A controlled
31-second browser launch delay reproduced the old timeout before Chrome started;
the repaired harness completed all Spaces assertions in 33.3 seconds, with the
same 30-second fixture limit. This proves startup consumed the acceptance budget;
it does not identify why Chrome initialization was slow on that runner. Diagnose
any failure after the page request separately, using fixture progress or input
artifacts, rather than extending an acceptance or latency limit.

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
[knowledge map](knowledge-map.md).

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

Board following stays after the serialized move, outside the move queue, as in
the original RPC implementation. Successful moves follow confirmed replacement
IDs; failed moves reconcile only observed terminal witnesses. Unknown locations
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

Lead/reviewer edits are reserved to the owner or FirstMate by **crew rule**.
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
Lead/reviewer edits follow the owner/FirstMate crew rule across every verb.
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
they never lock the owner out. One call holds at most 20 s for `ask --wait`.
World's pages fetch only the open questions (`world.asks.get`), and only when
a ledger notice says a question changed. `ask --key CAUSE` deduplicates a cause
for the verified asking occupant, even after an answer; `ask withdraw ID`
closes that cause and allows recurrence. Only the verified original connection,
runtime, terminal and session may withdraw it. The owner may dismiss any open
question in World (`world.ask.dismiss`): it closes without an answer, and a
keyed repeat returns it, as it returns an answered one, until the asker
withdraws. A waiting CLI returns on answer, dismissal or withdrawal. Closed
questions are retained and trimmed together. New verified asks carry their
runtime, terminal, workspace and session identity into reception and
notification targets; an unverified ask carries them, still marked
unverified, only when exactly one local Herdr has the pane it claims. Asks
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
