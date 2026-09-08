---
name: world-review-change
description: Review a Herdr World candidate for correctness, boundary violations, missing tests and knowledge drift.
---

Use a native history different from the latest editor. In pair mode, earlier authorship
does not prevent reviewing the other partner's later changes. On the first review, read the task,
diff, relevant contracts and source. On repair rounds, resume that review history,
read the supervisor candidate delta and changed decisions, and revisit affected
dependencies. Confirm old findings and look for new defects; a prior checklist is
not exhaustive. If context was compacted or lost, recover from handovers and source.
Trace browser commands through HTTP to Rust instead of assuming language-local
call graphs are complete. Check host/generation admission, stale state, terminal
ownership, bridge parameter validation and release provenance when touched.
Report actionable findings with severity, path and a concrete failure scenario.
Accept a clean patch without inventing issues. A writable pair partner may correct a
concrete defect and hand it back for the other partner to review; never accept your own
latest edit. In a read-only reviewer phase, return findings without repairing source.
Internal loop review does not replace the independent PR review in AGENTS.md.
