# React 18 and 19 reassessment — 21 October 2026

The current World workload does not reproduce the historical React 19 input
stall. React 18.3.1 and React 19.3.1 perform similarly in these runs; neither
is a compelling latency winner. Recommend React 19.3.1 to match Roamgate and
remove the compatibility divergence, subject to full delivery checks and
independent owner approval of the changed adoption policy.

## Question and acceptance

The old explanation in `UPSTREAM.md` said React 19 stalled terminal input during
dense topology refresh. Commit `07332d4c` already retained React 18 on 8 October;
that explanation is historical evidence of a decision, not a preserved controlled
comparison establishing its cause. The tested code now uses Town/Board and newer
render scheduling, and Office/Tree/Graph have been retired. This investigation
cannot establish what caused an older build's stall.

Acceptance: keep the exact application/workload fixed while changing runtime
versions; retain the existing input budgets and all transport/ownership assertions;
check desktop and phone widths, animated rendering, mounted refresh and editor
correctness. A newer major is acceptable only with matching type packages,
production asset checks and the normal delivery gate. No model of React scheduling
or universal device/network latency is claimed.

## Controlled measurements

Baseline application revision: `7fd939aa5154674750cf66ab5ecf1f7dd5512200`, the
current upstream integration (PR #231), based on World main `6f04aafe`.
React/React DOM changed together from 18.3.1 to 19.3.1. Their type packages remained
at 18 during the timing comparison, so no application code migration was needed
between samples. Each version used its own lockfile; no unrelated dependency
versions changed. Type-only migration followed the comparison.

Linux x64, Bun 1.4.3, Chrome 153.0.8010.52. Six cases per trial: Board, Town and
animated Town at 1440px and 390px. Order: 18-A, 19-A, 19-B, 18-B, 18-C, 19-C.
Each browser starts in an isolated profile. Runs are sequential with no concurrent
checks started by this investigation. Other machine load is not controlled.

The existing production-transport fixture runs cold mount and mounted refresh
against synthetic dense topology, terminal output and independently scheduled
native input. Its deliberate 20-second response stall remains included. Tests
retain all existing assertions and budgets: Town p95 <150ms and max <450ms;
Board p95 <200ms and max <500ms. All 36 cases passed, acknowledging 6,608 input
keys on 18 and 6,636 on 19 without routing/acknowledgement failures.

For comparable mounted-update counters the benchmark explicitly uses each
version's **production profiling renderer**, with production React, minification
and identical fixture code. This includes profiling overhead and is not a direct
measurement of the shipped Vite bundle or a runtime/network SLA. The ordinary
fixture/gate remains unchanged; the production Vite build is checked separately.

Values below are milliseconds: median of each case's three run-level p95s, and
worst acknowledgement delay observed across those runs. These are descriptive
samples, not confidence intervals or proof of performance equivalence.

| Workload | 18 median p95 | 18 worst | 19 median p95 | 19 worst |
| --- | ---: | ---: | ---: | ---: |
| board, 390px | 28 | 131 | 29 | 198 |
| board, 1440px | 28 | 131 | 33 | 130 |
| town, 390px | 31 | 150 | 32 | 163 |
| town, 1440px | 29 | 157 | 30 | 158 |
| town animated, 390px | 32 | 186 | 33 | 196 |
| town animated, 1440px | 28 | 168 | 31 | 146 |

The measured run-level p95 ranges are 27–33ms (18) and 28–34ms (19). Both are
comfortably inside the fixed budgets. Tail variation is mixed; do not describe
React 19 as faster on this evidence. The old stall is not reproduced on this code.

## Compatibility and candidate

Use React/React DOM 19.3.1 and their 19.3.0 type packages together, following the
[official React upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).
The JSX transform was already modern. Three ref prop annotations now explicitly
include null. The Composer test uses `props.ref` instead of React 18's deprecated
`element.ref` access. Application callback freshness and synchronous tool gestures
remain intact; there is no unrelated conversion to effect events or ref props.

Initial focused evidence: all 34 top-level interaction tests across eight suites
passed, including isolated terminal Message/Direct/upload tests, dialog freshness,
History, Toast, Back and terminal selection/focus. Quick types pass after ref
annotations. The production web build passes existing unchanged budgets: 130
assets, 13.2 MiB total, 386.1 KiB initial JS (118.3 KiB gzip), 28.3 KiB initial CSS;
no development tools ship. Dependency notices/licenses are regenerated.
Final delivery and independent review results belong in the PR handoff.

## Reproduction and limits

On this branch install the frozen lockfile and run one installed version:

```bash
bun install --frozen-lockfile
CHROME_BIN=/path/to/chrome bun scripts/benchmark-react.ts .agents/react-benchmark/sample
```

The command uses the existing six dense tests, creates temporary profiling assets,
and records `run.log` and `results.json` in the output directory. It verifies React
and React DOM match and that all six cases yielded measurements; it does not edit
dependencies. To repeat the comparison, use the base revision's manifest/lockfile
for 18 and the candidate's for 19, retaining the candidate benchmark tool and
profiling build option on both. Restore dependencies with the frozen lockfile at
each switch. Run three trials per version in the order above. Raw local runs live
under `.agents/react-benchmark/18-{a,b,c}` and `19-{a,b,c}`; they are ignored and
contain only synthetic fixture observations.

Chrome on this machine does not establish live Herdr/OpenSSH behavior, Safari,
Firefox, low-end hardware or arbitrary user data. Input timing evidence is real
browser/consumer evidence (coverage Q43), not a new formal model. Shared ownership,
recovery and authority models retain their existing scope. Reassess on a future
React major or a reproducible responsiveness regression; keep the normal browser
and latency gates mandatory rather than pinning React 18 without current evidence.
