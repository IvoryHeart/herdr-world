# Agent efficiency changes and validation

The sidebar delivery in PR #79 exhausted the original one-hour Ralph budget before
independent review and verification. Preparation consumed about 71% of active execution;
interactive completion afterward is not counted as autonomous success. Native records also
recovered usage omitted when QA planning and implementation were interrupted. The original
outcome remains in [the session trial record](agent-session-trials.md).

This revision defaults to two native histories, Sol high for lead/review, conditional Sol
xhigh Oracle advice, cumulative stage budgets and deterministic background supervision.
It adds supervisor-owned response accounting, explicit worker metrics export, OTEL
reconciliation and a prepared writable QA fixture. Full mode retains a separate Luna
xhigh builder and QA allocation. These are policies to evaluate, not measured optima.

## Live phase and telemetry regression

On 2026-09-07 UTC, the pinned Codex 0.153.4 adapter completed eight authenticated
invocations against a synthetic retry helper in **372.9 seconds**. The trial exercised:

- Owner-question intake and continuation in the exact native lead history.
- Transition from read-only intake to writable implementation in that history.
- A focused Oracle consultation in a separate history.
- A returning reviewer detecting a different defect after its first finding was repaired.
- Review and behavioral QA passing in the same independent Sol high history.

| Phase | Invocations | Responses | Input tokens | Cached input | Output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Intake | 2 | 6 | 85,666 | 55,040 | 1,274 |
| Implementation | 1 | 4 | 69,649 | 51,200 | 731 |
| Oracle | 1 | 5 | 70,555 | 55,168 | 885 |
| Review | 3 | 7 | 109,060 | 90,752 | 1,529 |
| QA | 1 | 3 | 55,006 | 36,096 | 612 |
| Total | 8 | 25 | 389,936 | 288,256 | 5,031 |

Input includes cached input. All **25 response IDs and token fields matched** the
supervisor's OTEL records retrieved from Loki, with no missing, extra or mismatched
responses. There were no timeouts or missing native usage records. Actual monetary cost
and subscription impact were not reported and remain unknown.

Live input fingerprint:
`926a9a27d4400f5f53b84d58cc70b4efa2a8187e9045eeabd2c863729524e89a`.
Execution image:
`sha256:0f4a93fcdd2705cc31137bd0a711f53e1fb438a42f2cdc116801466ff33bb698`.
The trial used the working revision before subsequent reporting, instance-attribution and
eval-driver refinements. Raw native histories, session IDs and deployment configuration
stay in ignored local storage. Run `eval:sessions` and `agent:metrics --run-dir ... --loki ...`
to repeat the phase test and reconciliation.

This tests specific native phase transitions; it does not run a complete product delivery
or estimate savings against PR #79. The synthetic fixture supplies scenarios and deliberately
changes candidate defects between review turns. Production event routing, final verification,
owner-answer resume and interruption recovery are exercised separately by the Docker test.

## Deterministic and browser controls

The production Docker supervisor test passed successful delivery, blocked intake, exact
lead continuation after SIGTERM, read-only review/QA mounts and independent rejection of
false success. It exposed a graceful-shutdown race: a detached backend could overwrite the
final interrupted state after Ralph exited. The command runner now stops captured descendants
before the supervisor records its final outcome; a dedicated regression covers the race.

Fast tests cover cumulative stage reservations, fresh-history isolation, incremental usage,
interrupted/compaction recovery, deduplication, missing-usage disclosure, exporter retries,
OTEL reconciliation, background completion and writable Vite dependency files. The normal
repository checks, strict OpenSpec validation and edited skill validation passed.

A real web fixture check also passed in 14.3 seconds with the original candidate mounted
read-only and networking disabled: the helper created its temporary copy, ran the runtime
client Vitest suite and built the production web app. The original source fingerprint
remained unchanged, exercising the Vite write path that failed in the sidebar trial.

Three product regression workloads have validated reference and negative controls:

| Workload | Frozen reference | Seeded defects |
| --- | --- | --- |
| Federated host navigation and collision-safe identity | Passed unit/browser checks | Rejected |
| Capability enforcement across toolbar, menus and terminal | Passed unit/browser checks | Rejected by browser checks |
| Keyboard Settings flow, focus return and focus styling | Passed unit/browser checks | Rejected |

The first two used frozen source fingerprint
`2c4d59d63ee3b5cf0cbbccadee37244fdcc762a8c63bfc0621241fd71c79b3e2`;
keyboard controls used
`c46cce7031dbbe1405f0275cbfe5b71790e024a3172f27855adff965f53b3f4d`.
Initial preparation attempts caught an ambiguous seed and an incorrect test filename;
neither was counted as a successful negative control. The corrected seed validation is
part of `eval:check`. These browser controls use no model.

`eval:product` provides a matched two-history/full comparison using the same frozen briefs,
source, checks, model and effort. The live three-task comparison has **not** been run.
Claims such as “50% less time/cost” remain unmeasured. Its reports retain autonomous
success separately from artifact grades, first-patch time, per-role usage, timeouts and
interventions. See [the eval commands](../../evals/README.md#product-regression-comparisons).
