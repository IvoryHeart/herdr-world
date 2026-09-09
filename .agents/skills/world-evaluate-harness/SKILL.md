---
name: world-evaluate-harness
description: Evaluate changes to Herdr World's agent rules, skills, native tooling and coding workflow experiments.
---

Use docs/agent-development.md for the native workflow and evals/README.md for
available checks. Run test:agent, spec:check and eval:check for deterministic
regressions. eval:skills checks a fresh App Server's actual discovery without a
model turn; it cannot establish current-session activation or model quality.

For live work, use agent:usage with the lead thread and explicit task interval.
Include descendant usage and separately scoped preparation/external review. Record
actual models, tool/source revisions, outcome, elapsed active intervals, retries,
interventions and missing coverage. Keep cost null when unavailable; cached input
is part of input. Raw logs and identifiers remain private.

Classify meaningful failures: missing requirement, navigation, implementation,
QA coverage, false-positive review or environment/tool failure. Add a reproducible
case only when it measures observable behavior. Validate positive, negative and
valid-alternative controls. Preserve original results when correcting a grader.
Keep held-out cases separate from examples used to tune instructions.

For OpenWiki/Skillgrade use docs/agent-pilots.md. Evaluate answer/patch correctness
and regression evidence, not skill-name mentions. Keep grader expectations outside
the candidate where supported and independently recheck final artifacts. Report
local-provider isolation and usage limitations. A smoke is not a reliability estimate;
an unmatched historical trace cannot establish percentage savings.

Change workflow or allocation separately where possible. Record intentional combined
experiments as such. Investigate a failed control before running more model trials.
Keep harness changes separate from a product worker's acceptance criteria.
