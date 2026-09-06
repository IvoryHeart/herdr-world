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
