# React 18 and 19 reassessment — 21 October 2026

**Retain React/React DOM 18.3.1 for now.** React 19.3.1 is comparable in ordinary
production builds, but reproduces multi-second input stalls in the current
required development-built browser consumers. The earlier exception has current
evidence, with a narrower cause than the old blanket claim about React 19.
Do not interpret the production-only result as safe acceptance of a full upgrade.

## Decision and acceptance

The original `UPSTREAM.md` explanation said React 19 stalled terminal input during
dense topology refresh. Commit `07332d4c` already retained React 18 on 8 October;
that sentence records a decision, not a preserved controlled comparison proving
its original cause. Current World uses Town/Board and newer render scheduling;
Office/Tree/Graph have been retired. This investigation evaluates current code.

The owner requested a fresh branch to test both versions. Acceptance keeps the
application/workload fixed, existing input budgets and all routing/ownership
assertions. Desktop and phone widths, animated rendering, cold mount, mounted
refresh and editor behavior remain required. The ordinary production comparison
passes for both versions; React 19 fails the existing development-mode latency
consumers and therefore the full delivery gate. Development usability and the
mandatory consumer checks remain obligations; no gate is weakened to adopt 19.

The final branch retains 18. Prototype commits preserve the 19.3.1 runtime and
19.3.0 types, three explicit nullable-ref annotations and a test-only `props.ref`
adaptation; those upgrade changes and proposed policy relaxation are withdrawn.
No new product/API contract or formal model is introduced.

## Ordinary production comparison

Application baseline: `7fd939aa5154674750cf66ab5ecf1f7dd5512200`, PR #231's
reviewed head, based on World main `6f04aafe`. During timing runs only React and
React DOM changed together: 18.3.1 versus 19.3.1. Type packages remained at 18,
so application code was identical. Each version used its own frozen lockfile;
no unrelated dependency versions changed.

Linux x64, Bun 1.4.3, Chrome 153.0.8010.52. Six cases per trial: Board, Town and
animated Town, each at 1440px/390px. Order: 18-A, 19-A, 19-B, 18-B, 18-C, 19-C.
Browsers use isolated profiles. Runs are sequential with no concurrent checks
started by this investigation; other machine load is uncontrolled.

The existing production-transport fixture includes dense synthetic topology,
terminal output, independently scheduled native input, cold mount and mounted
refresh. Its deliberate 20-second response stall remains included. Town keeps
p95 <150ms/max <450ms; Board keeps p95 <200ms/max <500ms. All 36 ordinary production
cases pass, checking 6,608 input acknowledgements on 18 and 6,636 on 19.

Values are milliseconds: median of three run-level p95s and worst acknowledgement
delay across those runs. They are descriptive samples, not confidence intervals.

| Workload | 18 median p95 | 18 worst | 19 median p95 | 19 worst |
| --- | ---: | ---: | ---: | ---: |
| board, 390px | 28 | 131 | 29 | 198 |
| board, 1440px | 28 | 131 | 33 | 130 |
| town, 390px | 31 | 150 | 32 | 163 |
| town, 1440px | 29 | 157 | 30 | 158 |
| town animated, 390px | 32 | 186 | 33 | 196 |
| town animated, 1440px | 28 | 168 | 31 | 146 |

Run-level p95 ranges are 27–33ms (18) and 28–34ms (19). Neither is a compelling
latency winner in ordinary production. This fixture does not establish an SLA,
all-device performance or live Herdr/OpenSSH behavior.

## Development-mode negative evidence

The existing normal browser build uses development React. With 19.3.1, static,
unit, behavioral-verification and ordinary World browser lanes passed, but the
quiet latency lane failed eight consumers. The six dense cases had p95 input
acknowledgements of 2,694–4,898ms; two concurrent-runtime cases had maximum input
delays of 4,561ms and 4,487ms. None of those assertions or thresholds was changed.

To distinguish a version-specific problem from machine load, reran the same
1440px Board case sequentially with Chrome CPU profiling enabled on both versions:

| Same development-built Board case | React 18.3.1 | React 19.3.1 |
| --- | ---: | ---: |
| p95 input acknowledgement | 30ms | 3,440ms |
| maximum acknowledgement | 89ms | 4,940ms |
| largest observed refresh blocking task | no multi-second task | 4,791.9ms |

React 19's refresh profile attributed 2,007ms of sampled self time to
`addObjectDiffToProperties` and another 337ms to `addValueToProperties`; these
functions are present in its installed development renderer's changed-prop
instrumentation. The 18 profile lacks that hotspot. This strongly implicates
React 19 development diagnostics over large World props, rather than the
production scheduler. It is an inference from profiling, not proof of the only
cause or a completed remedy.

[React's performance-track documentation](https://react.dev/reference/dev-tools/react-performance-tracks)
explains that development tracks are enabled by default and expose changed props,
while instrumentation overhead is disabled in ordinary production. That mode
difference is consistent with the observed results. No unsupported runtime patch,
diagnostic suppression, prop-model redesign or production-only gate substitution
was attempted. Investigating a supported bounded representation of large props,
or an upstream diagnostic fix, is the next step before adopting 19.

## Build-mode audit

An independent read-only review caught a benchmark labeling error. The initial
runner requested a profiling alias through an ignored bundler option. Raw result
JSON says `production-profiling`, but the runs actually used ordinary production.
The corrected builder verifies loaded production renderer modules and rejects
development/profiling modules. Both versions emit byte-identical benchmark JS
before/after the correction, so those measurements remain valid for ordinary
production. Original raw observations are preserved, not relabeled. No React
commit-duration claim is made; production Profiler callbacks are disabled.

- 18 module: `react-dom.production.min.js`; JS SHA-256
  `d0104412eb66ab0120ccd1ae6f88d7d5a7df03480974250432489244691a743a`.
- 19 modules: `react-dom-client.production.js`, `react-dom.production.js`; JS SHA-256
  `70b4a28376a2c6470ef4b2d2b722f4bacc8180f5300b93a53ad8c7c5705336e3`.

## Compatibility checks and fixture repair

The React 19 prototype passed quick types after three nullable-ref annotations,
34 focused interaction tests across eight suites, four final Composer/Mention
tests, and the Vite production build under unchanged budgets (130 assets, 13.2 MiB,
386.1 KiB initial JS / 118.3 KiB gzip; no development tools). Those successes do
not override the failed latency consumers.

An earlier gate exposed a separate test readiness race: SharedViewCreation
dispatched a synthetic submit while Create was disabled for name generation.
A diagnostic reproduced it at both widths. The fixture now waits for the enabled
Create button and clicks it, retaining all exact source/count/Inspector ownership
assertions. Both widths pass on both React 18 and 19; no product creation behavior
changed. This repair is retained independently of the rejected upgrade.

Final delivery evidence belongs in the PR handoff. Existing coverage Q43 uses
real browser measurements, not a model of React scheduling. Other authority and
recovery models keep their established scope. No live Herdr/SSH, Safari/Firefox,
low-end hardware or arbitrary user topology is claimed tested here.

## Reproduction

Install the frozen lockfile and run the ordinary production comparison for the
currently installed matching React/React DOM versions:

```bash
bun install --frozen-lockfile
CHROME_BIN=/path/to/chrome bun scripts/benchmark-react.ts .agents/react-benchmark/sample
```

The tool creates temporary production assets and writes `run.log`/`results.json`.
It verifies the renderer modules and six measured cases; it never edits dependency
files. The prototype's 19 manifest/lockfile is preserved in commit `15e287d9`;
use the baseline files for 18, preserving the final benchmark tool and fixture
code for both. Restore dependencies from the chosen frozen lockfile at each
switch. Repeat the three trials in the order above.

Reproduce the development-mode diagnostic with either installed version:

```bash
CHROME_BIN=/path/to/chrome WORLD_PROFILE=1 WORLD_TIMINGS_ONLY=1 \
  WORLD_TRACE_PREFIX=.agents/react-benchmark/development \
  bun test web/src/world/ProductionContexts.board.test.ts --test-name-pattern 1440
```

Create the trace directory first. Local raw evidence is ignored under
`.agents/react-benchmark/18-{a,b,c}`, `19-{a,b,c}`, and the corresponding
`18-development-profile`/`19-development-profile` prefixes. Full local gate logs
also preserve all eight React 19 failures. Revisit the pin on a relevant React
fix or a supported remedy, rerunning both build modes, editor checks and the full
gate; no broad claim that React 19 production itself stalls remains justified.
