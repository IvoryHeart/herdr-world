# Agent development live trials — 2026-09-06

These are authenticated smoke trials of the development harness. They distinguish a
correct held-out artifact from a candidate that completed the full delivery workflow.
One attempt per case cannot establish general reliability or a model-quality improvement.

## Configuration and provenance

- Worker roles: `gpt-5.6-luna`, `xhigh`; product, planning, QA design, review and Oracle:
  `gpt-5.6-sol`, `xhigh`. The supervisor and verifier do not call a model.
- Ralph 2.10.1, Codex 0.153.4, OpenSpec 1.12.0, Harbor 0.22.0, Node 22.23.2,
  Rust 1.97.1 and cargo-about 0.9.2. Graphify was disabled.
- Corrected worker image:
  `sha256:0f4a93fcdd2705cc31137bd0a711f53e1fb438a42f2cdc116801466ff33bb698`.
- Fresh source and harness fingerprint:
  `758895bb935f8c143aa50689b9d7998ade5c66b93028d1f7e50e3c7890d193f4`.
  This identifies the working-source snapshot based on commit
  `fe193f3823cafd6ca1e9249b5de6c48d2e832f49`, including the uncommitted harness changes.
  The old commit alone does not identify the tested implementation. Later reporting,
  grader, CI and documentation changes did not alter these frozen running controls.
- Each full-loop trial allowed 1,800 seconds, 24 activations, three consecutive
  failures and at most two Oracle consultations. Dependency preparation had a separate
  bounded allowance. Knowledge and clean-review baseline calls allowed 600 seconds.
- Models used saved Codex authentication inside the production Docker boundary.
  Held-out graders ran separately, without model authentication or network access,
  and received only the declared artifact. API-key-backed Harbor model trials were
  not run; Harbor itself was exercised with reference and negative controls.

Raw reports, transcripts, frozen inputs, candidate patches and grading artifacts remain
in ignored `evals/jobs/` and `evals/.prepared/`. Completed trial dependency/build caches
were pruned; source and evidence were retained. No trial feature was applied to the
product checkout. Costs were not reported by the CLI and remain unknown.

## Completed model outcomes

All three fresh Ralph trials passed their held-out grade and reached `ready-for-review`.
Each completed review, every planned QA scenario and the deterministic repository check
without a repair cycle. Readiness included a candidate patch and matching source evidence.

| Case | Configuration | Artifact grade | Delivery outcome | Minutes | Model calls | Input tokens | Output tokens |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Reconnect regression | Luna baseline | 1 | Single session completed | 5.47 | 1 | 466,822 | 3,976 |
| Reconnect regression | Routine Ralph | 1 | Ready for review | 21.53 | 5 | 3,059,135 | 39,914 |
| Deployment-health helper | Feature Ralph | 1 | Ready for review | 24.29 | 6 | 3,598,145 | 39,598 |
| Reconnect with requested Oracle | Sensitive Ralph | 1 | Ready for review | 26.98 | 7 | 3,907,138 | 48,067 |
| Knowledge correction | Luna baseline | Original 0; corrected grader 1 | Single session completed | 1.96 | 1 | 314,083 | 1,586 |
| Clean review | Luna baseline | 1 | Single session completed; no invented findings | 4.33 | 1 | 853,884 | 9,717 |

The routine and sensitive candidates each satisfied four criteria through four QA
scenarios. The feature satisfied six criteria through five scenarios and added only the
helper, its tests and a current contract update. The sensitive run made one Oracle
consultation and applied security, protocol and performance review lenses. Verifier and
coordinator activations bring the total activation counts to 7, 8 and 9 respectively.

Reported input totals include cached/repeated input across tool calls, not unique context
size. Cached input was 2,784,128 / 3,268,608 / 3,519,744 tokens in the three Ralph trials.
Elapsed times include setup and verification. Runs overlapped on the same host, so timing
is observational rather than a controlled performance benchmark.

An earlier feature baseline also passed in 3.16 minutes, using 492,053 input and 5,149
output tokens. It used the corrected image but the earlier source snapshot `a604bcc00a87`,
so it is supplemental evidence, not an exact-snapshot paired feature comparison.

The fresh reports are jobs `live-2026-09-06T17-02-53.942Z-aa954fdb` (reconnect),
`live-2026-09-06T17-02-55.059Z-ea4c26b1` (feature),
`live-2026-09-06T17-02-56.239Z-0e45c1c8` (Oracle) and
`live-2026-09-06T17-03-29.340Z-decec38c` (knowledge/review).

The baseline is one Luna session with the same repository skills. The default Ralph
configuration also uses Sol for lead roles and requires more verification. This compares
complete configurations, not the isolated effect of orchestration. A uniform-model
ablation is supported with `--model gpt-5.6-luna` but was not run here.

## Failures found by running the setup

1. **Incomplete eval source archive.** The initial task snapshot omitted `.github`, but
   repository checks read tracked workflow files. Preparation now retains those files
   while excluding the eval answers and graders.
2. **Login-shell tool discovery.** An early successful baseline artifact reported that
   Cargo was unavailable. Codex's login shell reset the tool PATH. The image now installs
   a profile fragment and checks Cargo, cargo-about, Ralph and Codex in a login shell.
3. **Cancellation under load.** An early reconnect loop produced the correct artifact
   and passed model review/QA, but its deterministic verifier failed the detached-child
   cancellation test. Spawning `ps` could consume the cancellation window. Linux now
   reads process ancestry directly from procfs; the regression test also removes `ps`
   from PATH. The full Docker test suite passed after this correction. The original
   loop remains recorded as exhausted, with artifact reward 1 and no delivery readiness.
4. **Inherited inactivity timeout.** An early feature loop reached implementation, but
   Ralph killed a buffered model call after approximately 301 seconds. Its custom
   backend inherited a five-minute inactivity timeout. The pinned configuration now
   allows 960 seconds of inactivity while the repository adapter enforces a 900-second
   model-call deadline and the overall run deadline. That feature trial is recorded as
   exhausted with artifact reward 1, without review/QA or delivery readiness. Its parent
   job and an obsolete Oracle job were stopped by the operator before further trials
   and superseded with fresh frozen inputs.
5. **A grader false negative.** Luna correctly replaced the stale statement that the
   bridge cannot authenticate browsers with an optional-password authentication
   statement, preserving Herdr's topology ownership. The original grader additionally
   required the word “session,” which the task did not require. The grader now accepts
   that concise valid correction while still rejecting the stale claim. Positive and
   negative controls cover both forms. The original reward 0 is retained; independently
   regrading the identical artifact produced reward 1, without rerunning the model.

The interrupted Oracle diagnostic also rejected two QA plans that added a scope-check
scenario with no acceptance references. The guard refused those plans; it did not silently
drop the unmapped scenario. The fresh Oracle trial produced a valid plan and completed.
This earlier rejection remains a failure observation, not evidence of successful recovery.

The knowledge regrade records artifact SHA-256
`19872d93333d5524ff60db56d318b768af5f46c57b736087a09c01d64acdc7bb`
and corrected grader SHA-256
`41472b21da638d848b9f0ee33aa57e03f974dc66f95d87ae0452bf950ef0992c`.
The report command shows original and regraded results separately.

## Deterministic and grader validation

- Complete repository check, including frontend tests/lint/build and Rust checks: passed.
- Twenty-two harness tests: passed locally and inside a read-only Docker source mount.
  They cover model routing, acceptance immutability, full QA coverage, stale evidence,
  bounded Oracle returns and mandatory sensitive-task review lenses.
- Production Docker supervisor fixture with stand-in model output: passed, including
  successful delivery, blocked outcomes, interruption/resume, repeated verification
  failure, Oracle escalation, source isolation and read-only QA. This validates control
  behavior; it is not model-quality evidence.
- Strict validation of five current OpenSpec contracts and repository skill schemas:
  passed. Security and independence audits passed with the existing permitted advisory
  findings unchanged.
- Harbor reference controls: 8/8 reward 1; negative controls: 8/8 reward 0; zero
  infrastructure errors in both jobs. The controls used frozen source `a604bcc00a87`.
  The subsequently corrected knowledge grader also passed local positive/negative checks.

## What these trials establish

Luna remains a reasonable initial worker default for the tasks observed here. The full
role pipeline has substantial latency and token overhead on these small tasks. There is
no demonstrated quality advantage over the single-agent baseline from this sample.

The Oracle task explicitly requested a consultation; it tests real advice and return
routing, not whether the agent spontaneously chooses the right escalation. Automatic
escalation after repeated failures is covered by deterministic supervisor tests.
Clean-review behavior was tested in a single baseline trial, not across the full workflow
or a statistically meaningful sample.

Keep automatic runs bounded to authorized tasks and retain independent PR review.
Repeated representative feature, defect, knowledge and blocked-task trials should guide
future role/model changes. This evidence does not authorize automatic merging, production
access, autonomous backlog selection or an additional orchestration framework.
