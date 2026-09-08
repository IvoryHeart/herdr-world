---
name: world-evaluate-harness
description: Evaluate changes to Herdr World's agent rules, skills, Ralph configuration or execution adapters.
---

Run npm run test:agent and npm run eval:check for deterministic regressions.
For the opt-in Superpowers/native trial, follow docs/superpowers-trial.md and run
eval:skills in its prepared worktree. Keep native discovery, live skill activation,
full delivery quality and usage comparisons separate. The Ralph activation fixture
does not grade a native workflow.
Use agent:usage with the native lead thread ID to summarize completed responses
across its descendants. Read actual model allocations, include the lead, and label
unfinished turns or missing histories as provisional. An in-session report cannot
include that session's later final response. See the trial guide for scope and handoff.
For changes to Ralph conversational onboarding or world-start-task, run the bounded eval:activation
trial. It uses an actual coordinator with the owner's short request, real goal/worktree/job
commands and a stopped fixture for nested intake. Record its routing result separately from
full supervisor/model-quality trials; a passing wording check cannot establish activation.
Use the Harbor tasks and commands in evals/README.md for real model trials only
within the authorized model/time/cost budget. Compare baseline and configured
harness on identical frozen tasks, with the verifier outside the agent workspace.
Record input revisions, versions, model, outcome, retries, elapsed time, token
usage and measured cost (null when unavailable). Do not call oracle or fake-backend
results model quality. Inspect failures and negative controls before expanding autonomy.
Graphify needs a measured navigation benefit before it becomes a default.

After a meaningful failure, preserve a sanitized reproduction and classify the cause:
missing requirement, navigation, implementation, QA coverage, false-positive review,
tool/environment failure, or supervisor routing. Add a task with positive and negative
controls only when it measures observable behavior. Keep held-out cases separate from
examples used to tune prompts. Compare one workflow/model change at a time where possible.
Grader controls must include valid alternative answers; do not require details present
only in the reference solution. Preserve original results when correcting a grader and
record regrades separately with their input and grader revisions.
Use eval:live for local saved-auth trials; Harbor remains available for scoped API-key jobs.
Use eval:product for frozen browser regression workloads. First compare two-history/full
with the same model and effort, then change model allocation separately. Include autonomous
success, time to first patch, per-role usage/cache coverage, timeouts and interventions.
Reconcile response IDs with agent:metrics against OTEL; missing usage is not zero cost.
Do not infer a percentage saving from an unmatched historical trace or reference controls.
Propose harness/prompt/grader changes in a separate development PR. An in-flight worker
cannot modify its own control copy or acceptance to improve its score. Report sample size,
task mix and unresolved failures alongside aggregate results; a smoke trial is not a
reliability estimate. No autonomous harness self-modification or production deployment.
