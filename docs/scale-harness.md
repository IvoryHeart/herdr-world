# On-demand synthetic scale measurements

Run from a clean branch checkout with the pinned dependencies and Chrome installed:

```sh
bun install --frozen-lockfile
bun scripts/scale/run.ts --thin --build
bun scripts/scale/run.ts --build --out=.agents/scale/matrix
bun scripts/scale/report.ts .agents/scale/matrix
```

The thin run exercises the recorded-current shape through the compiled service and
both production views at an actual CDP 390×844 viewport with 4× CPU throttling.
The full run takes one excluded warmup and three measured fresh service processes
per shape, each with fresh Chrome profiles for Town and Board at 1440×1000/1×
and 390×844/4×. It adds a separate profiled diagnostic process per cell. Use
`--rounds=1`, `--seconds=2`, `--shape=room-1440` or `--no-profile` for a declared
smaller experiment; preserve those options with the evidence.

`--thin --shape=room-1440` calibrates the separate Town fit/pan row. The full run
includes this row at both devices, using the existing ALL control (the fixture has
exactly one room), then one trusted ArrowRight pan. It keeps Town's bounded
24-desk projection of the raw 1,440-desk room. No admission is bypassed. Exposing
the full room through the existing 20-desk expansion steps would require 71
presses; that is an owner UX question, not a behavior change here.

`--board-only` runs just the approved 100/500-note save-size comparison. Each
size uses a private process, one atomic seed outside save timing, one operation
warmup and ten measured sequential revision-aware saves. One excluded process
warmup precedes three measured processes, with size order alternating. Preserve
per-process medians/tails and raw CPU tick windows; repeated calls are dependent.
The 1,000-note state is an expected atomic refusal at the existing 500-note limit,
with committed state and restart contents verified. No cadence, algorithm or
durability setting changes. This is not the parked storage-reuse acceptance matrix.

`--build` generates ordinary Vite production assets with source maps and embeds
them in the minified compiled Bun service. It does not enable World devtools.
The harness acquires every machine-wide heavy-check slot before building or
measuring. It waits for other cooperating work, including other worktrees.
It is disabled in CI. There are no latency or throughput pass/fail budgets;
bounded completion and correctness checks detect broken fixtures.

## Workloads and identity

| Row | Source input | Interpretation |
| --- | --- | --- |
| recorded-current | 3 connections, 15 workspaces, 66 tabs, 67 panes, 37 agents | Historical count-only proxy recorded on 2026-10-30; balanced invented placement and working status, all synthetic content. Does not claim to match today or the live world. |
| active-360 | 3 connections, 30 workspaces, 360 tabs/panes/working agents | 360 active source agents; presentation remains bounded. |
| room-1440 | 1 connection, 1 room, 1,440 tabs/desks and panes, 360 working agents | Raw dense room; measure retained and rendered counts separately. |
| sources-10 | 10 connections, 30 workspaces, 360 working agents | Ten separate synthetic Herdr control/render endpoints using the existing Herdr interface. Not ten adapter kinds. |
| dense-repair | 64 connections × 2,014 workspaces × 17 panes | Separate direct aggregation row plus actual HerdrClient NDJSON refusal; raw listing exceeds the 1 MiB native admission limit. No compiled-service/browser dense claim. |

Every primary browser cell includes a 100 events/second burst for the declared duration.
The producer records absolute due times and actual emission times, so producer
overload cannot masquerade as the requested rate. A final marker event follows
the burst to establish refresh completion; it is separate from the rate sample.
Events invalidate the existing observation path. The harness does not apply event
payloads in the browser or implement observation v2.

Dense repair supplies 34,238 raw panes per source directly to aggregation, matching
the maintained repair fixture's shape. Its native pane listing exceeds the existing
1,048,576-byte NDJSON limit, which the harness verifies and preserves. Consequently
it has no native/compiled browser cell. A separately labelled mounted repair-fixture
browser experiment can supply dense renderer budgets if Town step 8 requests it;
it cannot establish native end-to-end support. Whether a real Herdr can exceed this
admission limit is a separate correctness investigation, never a reason to enlarge
the limit in this measurement tool.

Native workspace/pane/session IDs deliberately collide across source instances;
connection IDs distinguish them. Direct observation diagnostics retire a generation
and assert that cached topology stays stale and non-actionable. No actor or runtime
fence is replaced by a capture receipt or by a fixture sequence counter.

Only owned synthetic Unix sockets, temporary private state and ephemeral loopback
listeners are used. The harness does not launch or contact real Herdr. It creates
its own Chrome and dynamic debugging endpoint, and authenticates only its private
World service. It never addresses ports 8787/8788 or reads installed configuration.
Children, sockets and scratch state are cleaned in `finally`; raw local evidence
remains ignored. Do not post raw logs/profiles, which may contain machine paths.

## Evidence boundaries

`identity.json` records source/binary/lock/tool identities, device settings and the
fixed plan. `results.json` retains individual process/phase measurements, raw input
counts, returned coverage and bounded presentation counts. `complete.json` proves
completion; `failure.json` retains the first failure and completed rows. Diagnostics
are labelled separately from unprofiled timing controls; excluded warmups remain.

Service evidence separates direct aggregation and serialization, compiled-service
initial/cached/invalidated snapshot RPCs, listener and connection readiness,
revision-aware durable Board writes, restart content verification and idle process
ticks/resident pages. Direct aggregation omits service composition and persistence.
Each browser phase also records service process ticks/pages and native list-call,
reply-byte and producer-encoding deltas, including the 100 events/s burst.
Linux process ticks/pages include worker threads; convert with the local
`getconf CLK_TCK` and `getconf PAGESIZE`. A write RPC includes scheduling, validation,
IPC, durable commit and publication; its latency cannot identify a single owner.

Town and Board phases are initial content readiness, marker refresh, timed idle
and burst refresh. Record React root commits through its production devtools-hook
protocol, application requestAnimationFrame callbacks, diagnostic cadence frame
intervals, long tasks, renderer task/script/layout time and JS heap. The light
diagnostic frame observer is excluded from application callback counts. WebSocket
accounting counts text characters, not compressed network bytes. Chunked snapshot
counts are partial envelope observations, not a complete decoded-snapshot counter.

When the baseline exposes the capture readiness API, use its receipt; otherwise the
completion boundary is expected topology controls plus two animation frames,
explicitly labelled in each phase. A default viewport may draw zero topology
cards; note cards never prove topology-card readiness. Record workspace/tab/note
counts separately and make no card-draw latency claim when topology is absent.
That fallback does not prove completed GPU drawing. The fit/pan row reads the
existing TownSceneCamera's public `flying` getter through a read-only, version-bound
React host-fiber observer, then waits two frames. HUD transform stability alone is
insufficient because HUD publication can lag camera motion. Animation and production
clocks stay enabled; unavailable internal observation fails explicitly. This is a
build-specific measurement hook, not a production API or a GPU-completion claim.
CPU profiles provide sampled self owners using the exact build's source maps;
unmapped samples remain visible. Elapsed sample weights under throttling are not
process CPU accounting. Sampling is not exact function accounting, and
worker/GPU/native costs are outside the browser main-thread CPU profile.

CDP verifies the actual viewport and sets CPU throttle explicitly; Chrome window
size is not evidence of a phone viewport. DPR is 1, mobile emulation is off and
SwiftShader renders in software. Results cannot establish native phone, hardware
GPU, battery/thermal, WAN/SSH, real Herdr IPC, cold disk or long-lived ledger budgets.
OS and owner workload remain outside the cooperating queue. Rank measured owners
and these limits before proposing future budgets; this harness sets none.

Choose a fresh `--out` directory for another run. The runner refuses to overwrite
existing evidence, so a failed attempt cannot inherit an earlier completion marker.
Profile diagnostics use the same 100-note persisted restart workload as timed controls.
