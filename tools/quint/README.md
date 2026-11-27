# Locked development verification tools

This package is deliberately outside the application's Bun workspaces. Its
`package-lock.json` is an explicit exception to the root Bun-lockfile convention:
Quint's development-only dependency graph is independently locked and never included
in shipped application assets or dependency resolution. Use `npm ci --ignore-scripts`,
not an unlocked global install. The package inventory is in `DEPENDENCY_NOTICES.md`;
actual tooling/checker redistribution must preserve upstream licence texts.

Quint is locked at 0.33.1 with adm-zip 0.6.1. The runner, installed-tool assertion
and evidence validator derive the Quint identity from the tool manifest, so a
lock update cannot accidentally retain an old hard-coded success identity. The
full gate remains mandatory for tool updates; never reuse old worker evidence.
All simulation commands explicitly select the TypeScript evaluator, and the
runner refuses other/default backends before spawn. The Windows Rust evaluator's
ZIP installer is unreachable; see [the adm-zip analysis](../../SECURITY.md#november-2026-adm-zip-alerts).


`checker.json` pins Apalache 0.62.1's release URL, archive SHA-256 and extracted JAR
SHA-256. That distribution provides translation and TLC. `tlc.json` limits the
checker to one worker, a 1 GB heap and a 16 MB stack. `verification:setup` downloads
and verifies the distribution into the checkout's ignored `.agents/verification/`
cache. The check verifies the installed JAR and does not download a checker.
It uses a private allocated endpoint for each invocation instead of borrowing an
existing local server. Readiness requires gRPC reflection and listener ownership,
not just a startup log line. Linux verifies ownership through `/proc`; macOS
requires its standard `lsof` tool and separate runner evidence. Checker and replay workers have owned POSIX process groups,
deadlines and TERM/KILL drain, including grandchildren and inherited pipes.

Use Bun 1.4.3, Node 18+ and Java 17+ on POSIX systems. Candidate CI pins
Node 24.19.0 and Eclipse Temurin JDK 21.0.13+9 on Linux x64 in every shard
and the aggregate; use that exact build to reproduce CI tool identities.
Java comes from commit-pinned `actions/setup-java`, independent of runner image
updates. Aggregation rejects differing full tool identities. macOS requires
its own runner evidence before claiming equivalent process/platform coverage:

```bash
bun run verification:setup
bun run verification:check
bun run verification:typecheck
bun run verification:notices
```

On Windows, use the POSIX CI job for checker/process supervision; actual Windows
application/runtime behavior retains its platform tests. A supported check never
silently skips a missing toolchain or treats a timeout as verification.

Runs use fresh artifact directories and validate source fingerprints before
completing a manifest. Model/code controls must fail at a named conformance
observation; malformed traces, adapter errors and cleanup errors abort. Witnesses
are counted from successfully executed production replay, not only simulation.
Raw output is kept in bounded local logs and summarized in console output.

The maintained command executes all 16 runtime, observation, allocation, protocol,
creation and Ranger models, their controls and larger-bound/host-order sensitivity.
The verified JAR is launched directly. These bounded implementations and consumer mappings are independently accepted in review 5516249164. The complete Quint 0.33.1 local run on 2026-11-19 passed all 16 cases in
425 seconds with two workers. Scheduling weights in `scripts/verification-timings.json`
come from that run and record its tool identities; these are local observations,
not hosted CI timings or a total peak-memory measurement. Final gate/resource approval remains a separate review checkpoint in `verification/`.

The canonical command uses `execution.json`'s bounded case pool (two workers by
default), with isolated case processes and private checkers. Its aggregate manifest
requires all 16 focused worker results against one current source/tool identity.
Failure/cancellation stops queue admission and drains peers; focused results do
not substitute for this aggregate. Worker count is CPU-capped and recorded with
case timings/resource observations. Retain conservative concurrency for the
JVM-backed phases; per-case max RSS is not a combined-memory measurement.

Linux model CI uses `model-resources.json` to enforce a 4 GiB no-swap cgroup and
four CPUs of quota over the model job and descendants, with `tlc-ci.json` selecting
four TLC workers (owner approval, 2026-11-26). The local resource command retains
`resources.json`'s two-CPU quota and `tlc.json`'s one worker. Other CI lanes keep
their existing CPU limits. Its actual aggregate peak,
OOM events and canonical manifest link are retained. A 64 MiB OOM control verifies
enforcement; actual cancellation must reject success and drain its descendants. Local `verification:resources` requires a systemd user manager;
required CI uses its system manager. Missing accounting fails the check.
