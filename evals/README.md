# Agent development evals

The eight tasks cover cross-language navigation, planning boundaries, a seeded
reconnect regression, review of flawed and clean code, knowledge maintenance, feature
shaping and explicit Oracle consultation. The feature is a helper added only inside the
trial workspace. The Oracle case explicitly requests advice to test routing; it does not
measure whether an agent independently chooses the right moment to consult.
Deterministic supervisor tests separately cover time/failure budgets, stale evidence,
role boundaries, isolation and worktree placement.

## Grader validation

```bash
npm run eval:check
npm run agent:image
uv sync --project evals --locked
npm run eval:prepare
npm run eval:harbor -- run -p PATH_PRINTED_ABOVE -a oracle --n-attempts 1 --n-concurrent 1 --jobs-dir evals/jobs
npm run eval:harbor -- run -p PATH_PRINTED_ABOVE -a nop --n-attempts 1 --n-concurrent 1 --jobs-dir evals/jobs
```

Oracle should score 1 on every task; nop should score 0. These are grader controls,
not model trials. Preparation freezes current source and tool metadata, removes eval
graders/oracles and Git history from the agent snapshot, and produces normal Harbor tasks
under ignored `evals/.prepared/<fingerprint>/tasks`. Do not commit generated tasks or logs.
Use `eval:harbor` to keep temporary Compose files in ignored agent state and require an
explicit agent choice.

Harbor's verifier uses a separate container without network or model credentials.
It receives only the declared answer/document/helper artifact, then runs trusted tests.
For the code task, candidate code executes as an unprivileged child; the parent grader
owns the final reward. The reconnect task is a seeded regression in a real repository
helper, not a claim to replay an exact historical bug.

## Authorized live trials

Check conversational activation after changing onboarding or task-start skills:

```bash
npm run eval:activation
```

One actual Sol high coordinator receives a short Tree-theme request based on PR #80. Its
isolated repository contains the current AGENTS.md/skills and real goal/worktree/job/task
commands. The parent PR lookup and nested run are fixtures; intake stops with an owner
question. Publishing is denied. The evaluator checks the recorded run/parent and unchanged
source before intake, rather than matching instruction wording. Negative grader controls
run in `eval:check`. `--seconds` defaults to 180 (maximum 600); `--model` supports an explicit
comparison. Native usage, source/image fingerprints and outcomes are saved under ignored
`.agents/state/activation-evals/`. This measures routing, not full Ralph execution or Tree
design quality. Run the production Docker test for real supervisor routing and delivery gates.

Local trials can use saved Codex authentication through the production Docker boundary:

```bash
npm run eval:prepare
npm run eval:live -- --prepared PREPARED_TASKS --cases reconnect-regression,knowledge-maintenance --variants baseline,ralph --attempts 1 --seconds 1800
npm run eval:live -- --prepared PREPARED_TASKS --cases deployment-health-feature,oracle-reconnect --variants ralph --attempts 1 --seconds 1800
npm run eval:report -- evals/jobs/LIVE_JOB
```

`--cases` is required so a trial set is explicit. Each trial has the supplied model time
budget (30–3600 seconds), with bounded dependency preparation separately. Start with one
attempt before committing to repeated runs. `--auth-file` selects a saved auth file; it is
mounted read-only, never copied into a task or artifact. Graders run in a separate container
without network/model credentials and receive only the declared artifact. Source tasks and
executable harness controls are frozen once per job. Outputs remain ignored/private.
Completed trials discard generated dependency/build caches to bound disk growth while
retaining source, patches, controls and logs. Use --keep-caches for a debugging run that
needs them. Re-run a frozen task for another attempt; pruned trial workspaces need bootstrap
before interactive reuse.

The baseline is one Codex session using the selected implementer model (currently Sol high by default) and the same repository skills. Ralph uses
the committed worker/lead allocation, so this compares complete configurations, including
model allocation. To isolate orchestration, pass `--model gpt-5.6-luna` for a uniform-model
comparison. Tier overrides are --worker-model and --lead-model. Use `--sessions fresh` versus
`--sessions persistent` with otherwise identical Ralph inputs to compare context strategies. Reports record model/effort
per turn, task/source inputs, independent reward, delivery status, QA evidence, consultation
count, durations and token usage. Cost remains null when unreported.

A held-out artifact can be correct while the delivery loop fails its broader checks; both
outcomes are reported separately. In particular, a review-only task containing intentionally
broken source may earn its review grade while the general delivery verifier remains red.
Use the implementation/feature/knowledge cases for end-to-end delivery readiness claims.

For Harbor with scoped API-key authentication:

Use the exact same prepared tasks, model and attempt count for both variants. Harbor uses
--n-attempts (-k) for attempts and --n-concurrent (-n) for concurrency:

```bash
npm run eval:harbor -- run -p PREPARED_TASKS -a codex -m MODEL --ak version=0.153.4 --n-attempts 1 --n-concurrent 1 --jobs-dir evals/jobs
npm run eval:harbor -- run -p PREPARED_TASKS -a evals.adapters.ralph:WorldRalph -m MODEL --n-attempts 1 --n-concurrent 1 --jobs-dir evals/jobs
```

Use a scoped model key from secure local configuration. Do not put credentials in a command
argument, tracked file, task image, or PR job. These commands spend model usage and require
an explicit task/time/spending budget. Neither is run by ordinary PR CI.
A maximum trial timeout is not a financial cap; enforce spending limits with the provider.

The Ralph adapter reuses `harness/ralph.yml`, roles, response validation and candidate gate.
Harbor supplies the outer container, so its execution driver runs commands within that
container instead of nesting Docker. Harbor keeps an explicit fresh-session baseline:
it isolates the trial as a whole and does not provide the local driver's per-role mounts.
Use local Ralph trials for persistent-versus-fresh comparisons. The local Docker
boundary is tested separately.
The configured loop also runs the repository check profile; the baseline agent is free
to choose its own verification. Both receive the same independent final grader.

The initial navigation/planning/review graders measure specific observable obligations
with structured answers. They do not measure all reasoning quality or replace human
inspection of transcripts. Add a real task after a meaningful agent failure, with both
positive and negative controls; avoid tests that merely reward quoting a skill.

## Interpret results

`inputs.json` beside the prepared tasks records source revision/fingerprint, task IDs and
tool pins. Harbor records its job config, model, agent version, time, errors and reward.
Ralph adds `agent/world-run.json` with role activations and reported token usage.

```bash
npm run eval:report -- evals/jobs/JOB_DIRECTORY
```

Report success rate, failures by category, duration and tokens; show cost as unknown when
unreported. Retain the exact prepared snapshot for a fair baseline comparison. Use multiple
attempts before claiming a reliability improvement. Check clean-review false positives,
blocked outcomes, and regressions as well as aggregate success.

Inspect the [sanitized live trial findings](../docs/evidence/agent-development-live-trials.md);
raw logs and generated candidates must not be committed. A small live smoke set
proves execution paths and specific outcomes, not general reliability. Graphify should be
evaluated as an additional navigation variant only after the core baseline exists.

## Native session regression

```bash
npm run eval:sessions
```

This focused live test uses the production model adapter and Docker mounts against a
tiny synthetic retry helper, with the pinned image and saved Codex authentication.
It checks a missing-decision interview and exact native continuation after the answer,
then a resumed reviewer rejecting a new defect after the first defect is repaired.
It also checks lead continuation into writable implementation and a focused separate Oracle
consultation. The corrected helper must pass Sol high review and QA in the same independent
history with the current role schema. Calls are sequential, bounded to 30 minutes total
with the production stage budget policy; raw evidence stays under ignored `.agents/state/session-evals/`.
Reports include actual models, native IDs, token usage, source fingerprint and image ID.
This is a persistence regression, not a measured reliability or token-savings benchmark.

The credential-free `test:agent:containers` separately covers the production goal command,
parent worktree selection, interview stop/resume, killed backend recovery, isolation,
and verifier rejection of falsely claimed success. CI stand-ins do not prove model quality.


## Product regression comparisons

Three medium regression workloads exercise federated host navigation, capability enforcement
across UI/terminal entry points, and keyboard Settings/focus behavior. Each combines seeded
defects with frozen unit and browser acceptance checks. These are regression workloads,
not a claim that open-ended design work has been benchmarked.

```bash
npm run eval:product -- prepare
npm run eval:product -- controls --prepared PREPARED_DIR
npm run eval:product -- run --prepared PREPARED_DIR --model gpt-5.6-sol --reasoning-effort high --seconds 3600
npm run eval:report -- evals/jobs/PRODUCT_JOB
```

Preparation freezes source, briefs, mutations, runner dependencies and acceptance tests.
The worker receives no eval definitions, reference solution, Git history or the selected browser
acceptance file. Other repository tests remain available, and live runs use the acceptance
profile so prepared Chromium and normal browser checks are present. Grading restores frozen controls and executes unit/browser checks in an
independent container without model authentication or network. Reference controls must pass;
seeded negatives must fail. Controls use no model and do not measure autonomous success.

Live comparisons require one explicit model and effort across both workflows. Compare
`two-history,full` first; change model allocation only in a separately recorded experiment.
Use `--cases ID,ID`, `--variants two-history`, and `--attempts 1` to bound a trial; the full
matrix is three tasks and two workflows. A time ceiling is not a spending cap. No live
matrix runs automatically in CI. Prepared artifacts and reports are private/ignored.

Reports separate delivery readiness from the independent grade and record autonomous
success, execution/grading time, first observed patch (sampled within five seconds),
response/cache usage per model and role, timeout count and interventions. Background
supervision has no monitoring model calls; any additional interactive assistance must be
recorded separately and invalidates an unassisted comparison. Failed checks remain visible.
Missing usage is labelled a lower bound and cost stays null. Reconcile native response IDs
with OTEL using agent:metrics before relying on model usage totals. Generated trial caches
are pruned after grading; source, native histories, checks and logs remain.

Do not claim a percentage saving from historical PR #79 versus a different task, from
reference controls, or from one short persistence trial. Repeated matched task results
are needed to evaluate the new default.

## Pair workflow regression and next trial

`npm run test:agent` includes pair handoff/self-review, stall escalation, budget separation,
command receipt reuse, infrastructure classification, worktree exclusion and legacy recovery
regressions. `node --test scripts/agent/container.test.mjs` exercises both the legacy control
and the real pair supervisor using a fake Codex executable: native continuation, alternating
edits/review, delivery evidence and prepare-only recovery. No paid model is involved.
These are mechanics tests, not evidence that a model follows the brief well or saves quota.

For the next authorized live comparison, include the entire task lineage and host coordinator:
accepted outcome and interventions, elapsed time excluding owner waiting, model invocations,
per-model/per-role input (including cached input), output, repeated command counts, command
wall time and disk growth. Do not count timed-out turns wholesale as waste: some retained
useful edits or a usable final response. Label polling-only activity separately. Preserve
unmeasured cost as null. Keep raw transcripts, local identifiers and environment data private.
The two-history/full fixtures remain historical comparisons; do not describe their results
as validation of the new default pair policy.
