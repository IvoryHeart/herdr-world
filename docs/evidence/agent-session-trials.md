# Persistent agent session trials — 2026-09-07

These are authenticated native Codex 0.153.4 calls through the production adapter,
with a new Docker container for every turn and host-backed role histories. The initial
probes use a tiny synthetic retry helper; a real sidebar feature trial follows below.
No live deployment or unrelated user working tree is exposed.

## Interview and review continuation

- Harness base commit: `7cd70e18a371bb408333081856ed639bc3b875b9` plus the in-progress persistence changes.
- Exact source fingerprint at start: `eff4675f8e2f533709422acf167cf67f0b4021f99e793e9f83cb8feaccdd9826`.
- Image: `sha256:0f4a93fcdd2705cc31137bd0a711f53e1fb438a42f2cdc116801466ff33bb698`.
- Duration: 5.71 minutes; six sequential model calls; all assertions passed.
- Raw evidence is ignored at `.agents/state/session-evals/live-rCTCmr/report.json`.

| Turn | Model / xhigh | Outcome | Input tokens | Cached input | Output tokens |
| --- | --- | --- | ---: | ---: | ---: |
| Intake | gpt-5.6-sol | intake.questions | 61,532 | 45,184 | 799 |
| Answered intake (same lead) | gpt-5.6-sol | intake.ready | 17,729 | 15,616 | 756 |
| Review cap bug | gpt-5.6-sol | review.rejected | 48,039 | 31,104 | 857 |
| Review after repair (same reviewer) | gpt-5.6-sol | review.rejected | 35,408 | 33,536 | 448 |
| Review corrected helper (same reviewer) | gpt-5.6-sol | review.passed | 38,913 | 36,864 | 431 |
| QA (same review history) | gpt-5.6-luna | qa.passed | 48,482 | 0 | 741 |

The first intake asked for the missing cap; the owner answer in this controlled test
was 8000ms. The next call resumed the exact saved lead thread and established acceptance.
The first reviewer found the incorrect 5000ms cap. After repairing the cap and introducing
a new immediate-retry defect, the same reviewer caught `delay(0) = 1000` instead of `0`.
The final repair passed review and a direct behavioral check from Luna QA, using the
same native review thread with the new role schema and model selection.

The probe calls the production model/validation layer directly; its repair mutations
and QA plan are controlled fixtures. It does not claim to test the full Ralph router.
The separate pipeline smoke below exercises that router.

Total CLI-reported tokens: 250,103 input, including 162,304 cached input, and 4,032 output.
Cached input is a subset of input, not an additional token count. Repeated Sol reviews
showed cache hits; the Sol-to-Luna switch reported none. Cost and subscription-usage
impact are unknown. There is no paired fresh-session comparison, so this establishes
working continuation and specific review behavior, not a measured saving or general
reliability improvement.

## Deterministic controls

The container fixture exercises the production goal command with a simulated parent PR,
central worktree placement, saved interview questions and refusal to resume without an
answer. Other cases cover exact builder resumption after SIGTERM, read-only review/QA
mounts, private histories, candidate export, and rejection of falsely claimed success
by the independent verifier. The stand-in retains its own fixture history so delta-only
prompts do not accidentally erase its task on a repair round.

## Full Ralph pipeline smoke

A separate synthetic source repository supplied the broken retry helper, immutable task
instructions and an existing `check.mjs`. It used the production `agent:run start
--interview --task-profile routine --profile check --seconds 1800` entry point and
default persistent Luna/Sol allocation. No owner decision was missing in this case.

- Harness base: `7cd70e18a371bb408333081856ed639bc3b875b9` plus in-progress changes.
- Harness fingerprint at start: `475fa1eb2c572d0010104d6e8e2ffc8eb9d777640543c76ca3e8a317fb12a47f`.
- Source fingerprint: `b2db2fddaaca35394fb49917c5cba1238f894339845776be0bca2f9ee9bc88a8`.
- Image: `sha256:0f4a93fcdd2705cc31137bd0a711f53e1fb438a42f2cdc116801466ff33bb698`.
- Run: `ad05c247-6610-4fe6-ba87-b9f1c5532c22`; raw evidence under ignored `.agents/state/pipeline-evals/live-qiqFmN/`.
- Outcome: `ready-for-review`, six model calls, eight total activations, 8.51 minutes including initial dependency preparation.
- Lead history: intake → planner, same ID; review history: QA planner → reviewer → QA, same ID; builder history remained separate.
- Acceptance, review, all four QA scenarios and the independent deterministic verifier passed.
- The original checkout remained clean. The exported patch changed only `source.mjs`; `check.mjs` and manifests were unchanged.
- A subsequent authless, network-disabled container received only the resulting helper and passed separate boundary assertions, including attempt 100000.
- CLI usage: 419,073 input, including 285,952 cached input, and 11,860 output tokens. Cost remains unknown.

The real pipeline smoke establishes the native role/schema transitions through Ralph.
It is one small source-only task, not a broad product acceptance or reliability claim.
The deterministic goal-command test separately covers parent PR resolution and interview
answers; it uses a simulated GitHub response and no paid model.

Final deterministic container suite: passed in 237.20 seconds. The 28 focused harness
tests, strict OpenSpec validation and all eight positive/negative local grader controls
also passed. Final checks include a regression ensuring fresh sessions still receive
the full candidate delta after Ralph creates a local landing commit.

## Sidebar feature trial with one Oracle consultation

The owner requested a real sidebar redesign stacked on PR #78, with alternatives and
an owner choice before implementation. One persistent feature run used the production
`agent:goal` parent-PR path, a one-hour execution budget and a 24-activation ceiling.
The source baseline was `c6efd9dda0a3a06448a9e22ad29835f74af1c17c`.

The owner selected compact View/Hosts controls with the list mode and space filter on
the next row, retained Settings, and added an Add Host shortcut to the existing
Network settings form. The same lead history incorporated those refinements. Exactly
one Oracle consultation completed during planning, assessing canonical navigation,
qualified host state, responsive sizing and keyboard focus. Its advice informed the
plan; the later Add Host command justified a custom Hosts menu while View and space
scope remained native selects.

| Step | Recorded outcome | Duration |
| --- | --- | ---: |
| Initial intake | Owner questions | 351.4 s |
| Owner design answer | Intake ready, same lead | 102.1 s |
| Planner | Oracle request | 68.8 s |
| Oracle | Advice completed | 752.8 s |
| Settings/Add Host refinement | Intake ready, same lead | 77.4 s |
| Planner continuation | Plan ready | 183.5 s |
| Independent QA planner | Invocation timed out | 900.0 s |
| QA planner continuation | 14 scenarios, same review history | 120.0 s |
| Builder | Invocation timed out with partial source | 900.0 s |
| Builder continuation | Overall execution budget exhausted | Remaining budget |

The authoritative result is **exhausted**, after 12 activations; the last completed
workflow event was `qa.planned`. There was no completed candidate-ready event, internal
code review, QA execution or deterministic acceptance verification in this bounded
run. The budget was not reset, a second run was not silently started, and interactive
completion is not counted as Ralph success. This is a product-task failure to finish
within the configured budget, despite useful Oracle advice and a recovered QA plan.

Completed calls reported 6,374,824 input tokens (including 5,537,664 cached input) and
41,659 output tokens. These are **partial totals**: timed-out and supervisor-killed
calls have missing usage records. Cached input is included in input, not additional.
Total usage and monetary/subscription impact remain unknown.

### Verification output correction kept in the parent PR

Baseline browser verification reproduced a source-fingerprint failure: passing visual
tests rewrote tracked evidence PNGs. Commit `f77eb5e` routes the four screenshot suites
into ignored `.scratch/playwright/evidence/` paths. CI already captures that artifact
tree. Historical evidence remains tracked, and an intentional evidence refresh now
requires an explicit copy and review. No assertion or fingerprint check was weakened.

All 14 tests in those four suites passed through the actual verifier with an unchanged
source fingerprint, alongside the complete repository check, strict OpenSpec validation
and all positive/negative local grader controls. The run was paused after QA planning
and received only the four output-path edits before the builder resumed; frozen harness
controls and acceptance were unchanged. The child branch incorporates this parent fix.

### Interactive feature delivery

After preserving the exhausted run, the authorized feature work continued interactively
from its exported partial candidate. Navigation focus, menu overflow, duplicate-name
identification and regression-selector migration required further work. The feature
remains separate from harness code and trial reporting; its own validation and independent
review are recorded in the child pull request linked from
[PR #78](https://github.com/IvoryHeart/herdr-world/pull/78).
