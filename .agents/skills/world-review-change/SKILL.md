---
name: world-review-change
description: Review a Herdr World candidate for correctness, boundary violations, missing tests and knowledge drift.
---

Read the original task, diff, relevant contracts and source in a fresh context.
Trace browser commands through HTTP to Rust instead of assuming language-local
call graphs are complete. Check host/generation admission, stale state, terminal
ownership, bridge parameter validation and release provenance when touched.
Report actionable findings with severity, path and a concrete failure scenario.
Accept a clean patch without inventing issues. Do not repair while reviewing.
Internal loop review does not replace the independent PR review in AGENTS.md.
