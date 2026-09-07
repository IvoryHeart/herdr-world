---
name: world-review-change
description: Review a Herdr World candidate for correctness, boundary violations, missing tests and knowledge drift.
---

Use a history independent from implementation. On the first review, read the task,
diff, relevant contracts and source. On repair rounds, resume that review history,
read the supervisor candidate delta and changed decisions, and revisit affected
dependencies. Confirm old findings and look for new defects; a prior checklist is
not exhaustive. If context was compacted or lost, recover from handovers and source.
Trace browser commands through HTTP to Rust instead of assuming language-local
call graphs are complete. Check host/generation admission, stale state, terminal
ownership, bridge parameter validation and release provenance when touched.
Report actionable findings with severity, path and a concrete failure scenario.
Accept a clean patch without inventing issues. Do not repair while reviewing.
Internal loop review does not replace the independent PR review in AGENTS.md.
