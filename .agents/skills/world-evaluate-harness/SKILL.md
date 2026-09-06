---
name: world-evaluate-harness
description: Evaluate changes to Herdr World's agent rules, skills, Ralph configuration or execution adapters.
---

Run npm run test:agent and npm run eval:check for deterministic regressions.
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
Propose harness/prompt/grader changes in a separate development PR. An in-flight worker
cannot modify its own control copy or acceptance to improve its score. Report sample size,
task mix and unresolved failures alongside aggregate results; a smoke trial is not a
reliability estimate. No autonomous harness self-modification or production deployment.
