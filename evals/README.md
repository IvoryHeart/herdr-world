# Agent development evals

The six initial tasks cover cross-language navigation, planning boundaries, a seeded
reconnect regression, review of flawed and clean code, and knowledge maintenance.
Deterministic supervisor tests separately cover time/failure budgets, stale evidence,
role boundaries, isolation and worktree placement.

## Grader validation

```bash
npm run eval:check
npm run agent:image
uv sync --project evals --locked
npm run eval:prepare
npm run eval:harbor -- run -p PATH_PRINTED_ABOVE -a oracle -n 1 --jobs-dir evals/jobs
npm run eval:harbor -- run -p PATH_PRINTED_ABOVE -a nop -n 1 --jobs-dir evals/jobs
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

Use the exact same prepared tasks, model and attempt count for both variants:

```bash
npm run eval:harbor -- run -p PREPARED_TASKS -a codex -m MODEL --ak version=0.153.4 -n 1 --jobs-dir evals/jobs
npm run eval:harbor -- run -p PREPARED_TASKS -a evals.adapters.ralph:WorldRalph -m MODEL -n 1 --jobs-dir evals/jobs
```

Use a scoped model key from secure local configuration. Do not put credentials in a command
argument, tracked file, task image, or PR job. These commands spend model usage and require
an explicit task/time/spending budget. Neither is run by ordinary PR CI.
A maximum trial timeout is not a financial cap; enforce spending limits with the provider.

The Ralph adapter reuses `harness/ralph.yml`, roles, response validation and candidate gate.
Harbor supplies the outer container, so its execution driver runs commands within that
container instead of nesting Docker. The local Docker boundary is tested separately.
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

No live baseline is claimed until authenticated trials have actually run. Graphify should
be evaluated as an additional navigation variant only after the core baseline exists.
