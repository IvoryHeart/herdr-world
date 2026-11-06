# React 19 migration and development diagnostics

World follows Roamgate's `^19.3.1` range for React and React DOM and uses 19.x
types. The lockfile resolves both runtimes to 19.3.1. No React 19 features are
adopted. Nullable DOM refs, ref callbacks that return no value, and test access
through `props.ref` accommodate the new types and ref API.
Tests also account for Strict Mode's callback-ref replay, inject preview failures
during rendering rather than through getters inspected by development diagnostics,
and check bundle module identities so patch metadata cannot be mistaken for a
React DOM service import. Their lifecycle, error-containment and service-boundary
assertions remain in force.

React 19's effect ordering also exposed two lifecycle races. Terminal effects
can retain a disposed xterm instance for the commit that replaces its renderer;
they now verify it still matches the current renderer before binding transport,
attaching or updating font/theme options. The phone Spaces navigator case
reproduced a font effect refreshing that disposed instance, followed by xterm's
viewport callback reading its removed renderer. Groups now applies a requested
selection before committing its panel title and focus intent together; an effect
that changed the title afterward could cancel restoration of a minimized panel.
The desktop/phone navigation and Groups browser cases cover these sequences.

Creation fixtures wait for the enabled Create button while the suggested name
loads. The terminal handoff fixture records the Inspector view at each RPC and
checks that Chat's hidden terminal preserves the pane size. A transient Terminal
view shown before Chat becomes readable may claim its displayed viewport; it is
not counted as a resize from Chat. These are direct browser lifecycle consumers
under the existing Q06 attachment boundary, not new authority or recovery claims.

## Cause and fix

Closed PR #252 (`fd39a227`) separated ordinary production latency from a
development-only stall. The stall still reproduces on main `f206391b5` with
unpatched React 19.3.1, including **without Chrome CPU profiling**.

React DOM's `addObjectDiffToProperties` walks changed props for the development
Components performance track. It has an existing 100-property width limit and a
depth limit, but increments its next-object counter at the bottom of the loop.
Recursive object/array comparisons and equivalent-function comparisons `continue`
before reaching that increment. Large arrays of changed World objects therefore
bypass the width limit. This work runs synchronously during commit diagnostics,
after the interruptible render; deferring Board rendering cannot make it yield.

In the unpatched refresh CPU profile, `addObjectDiffToProperties` accounts for
1,684.9 ms sampled self time and `addValueToProperties` another 251.7 ms. The
4,106.5 ms long animation frame coincides with the input delay; React's reported
render duration itself is only 96.8 ms. Profile samples alone are attribution,
but the controlled patch and deterministic traversal test establish the defect:
the real installed renderer reads all 1,000 changed objects before the fix and
only the bounded prefix afterward.

`patches/react-dom@19.3.1.patch`, installed by Bun's `patchedDependencies`, moves
the counter increment before branches can `continue`. It changes the client and
profiling **development** renderer copies only. It retains React's existing
limits, changed-prop information and truncation marker; it neither suppresses
diagnostics nor changes production code, scheduling or World topology props.
[React documents](https://react.dev/reference/dev-tools/react-performance-tracks)
that these tracks add instrumentation overhead and are disabled in ordinary
production builds.

## Same-workload measurements

Reused #252's 1440px development-built Board consumer on current main's fixture:
64 hosts, 32,768 admitted workspaces, a 40,629,895-byte snapshot, two terminal
owners, independent native input every 75 ms, output pushes, and an initial plus
refresh phase that includes three deliberately stalled hosts. All transport,
ownership and work-ceiling assertions remain intact. Linux, Chromium 157.0.8103.38,
no CPU throttling; fresh disposable browser per run, sequential runs, one trial
per cell. These are observations on this runner, not a device-independent SLA.

| Installed renderer | Chrome CPU profiling | p95 input acknowledgement | Maximum acknowledgement | Keys |
| --- | --- | ---: | ---: | ---: |
| React 18.3.1 | Off | 33 ms | 98 ms | 358 |
| React 18.3.1 | On | 30 ms | 115 ms | 364 |
| React 19.3.1, unpatched | Off | 2,811 ms | 4,185 ms | 412 |
| React 19.3.1, unpatched | On | 2,803 ms | 4,193 ms | 416 |
| React 19.3.1, patched | Off | 29 ms | 174 ms | 356 |
| React 19.3.1, patched | On | 34 ms | 206 ms | 364 |

The patched refresh profile reduces `addObjectDiffToProperties` self time to
57.1 ms. Its longest recorded animation frame is 214.1 ms (110.5 ms reported
blocking time); the multi-second task disappears. Maximum input tails are still
higher than 18 in these single trials; the p95 comparison supports removal of the
multi-second regression, not a claim that every event is faster.

Raw logs and input/phase receipts are retained locally under
`.agents/react-679/merged/` (the initial pre-merge comparison remains under
`.agents/react-679/`).
They are ignored artifacts. The comparison uses development React throughout;
the fixture's historical name, `ProductionContexts`, refers to the mounted
production components and transport, not its React build mode. PR #252 already
found ordinary production input latency similar; that measurement is historical.

## Reproduction and patch maintenance

Run with each explicitly installed matching React/React DOM version, preserving
the same fixture. Use the baseline manifest/lockfile for 18 and the candidate for
patched 19. For a local unpatched-19 negative control, remove the patch entries
from the manifest and lockfile, then run `bun install --frozen-lockfile --force`
to replace previously patched installed files; do not edit shared package-cache
files. The installed-renderer regression is expected to fail in that negative
control. The matrix also checks the installed renderer's counter placement, so
a cached patched package cannot be mislabeled as an unpatched control.

```bash
mkdir -p .agents/react-679/sample
WORLD_TIMINGS_ONLY=1 WORLD_TRACE_PREFIX=.agents/react-679/sample/run \
  bun run test web/src/world/ProductionContexts.board.test.ts \
  --test-name-pattern '"entry":"","width":1440'
# Repeat the same command with WORLD_PROFILE=1 for the CPU-profile cell.
bun run test web/src/testing/reactPerformanceTracks.test.ts
```

The deterministic test mounts both installed development entry points, verifies
the updated UI and retained changed-prop/truncation diagnostics, and bounds
property reads independently of wall-clock speed. It fails on unpatched 19.3.1.
Existing Board/Town desktop/phone consumers remain the rendering and interaction
evidence; Quint authority/recovery models do not model React instrumentation.

Before merging the newer main, all six patched dense Board, Town and animated
Town consumers at 1440/390px passed, recording p95 acknowledgements of 31–41 ms
on `fac6758d7`. The comparison above was repeated after merging `f206391b5`.
The production Vite build passes the unchanged asset budgets (171 files,
14.8 MiB total, 431.3 KiB initial JS /
134.9 KiB gzip) and excludes development tools.
The 25 focused browser checks cover real Vite startup, Board interactions and
responsive controls, Town rendering/recovery, Chat menus and questions, Needs you,
and shared window resize/snap/minimize behavior. Focused Chat/composer/ref tests
and quick type checks pass. README, tutorial and feature instructions remain
accurate because the migration adds no controls or first-run steps.
After the main merge, those 25 browser checks and all four dense Board cases
pass again (29 tests). Board's original 1440/390px cases record p95 27/29 ms;
the newly merged maximum-scale cases record 34/51 ms. These follow-up timings
come from a two-file browser run, separate from the sequential comparison above.

Keep the exact-version patch and lockfile together. On a React DOM update, first
check whether the upstream renderer counts every visited property before early
continuation. Remove or refresh the patch explicitly, run the installed-renderer
regression and this on/off profiling matrix, then the affected browser and delivery
checks. A future upstream fix can retire the patch without changing World props or
keeping World on React 18. Broader diagnostic redesign is unnecessary for this
reproduced defect. No upstream fix submission or live Herdr/device test is claimed.
