---
name: world-plan-change
description: Plan an authorized Herdr World change using current repository knowledge and choose when OpenSpec is needed.
---

Read AGENTS.md, docs/knowledge-map.md and affected source/tests. Identify the
observable outcome, acceptance checks and real unresolved decisions.
Routine fixes, tests, refactors, dependencies and docs need no new proposal.
For an owner-requested spec or new contract, reuse or create one OpenSpec change
with the pinned CLI (npm run spec -- ...); inspect status/instructions JSON.
Keep tasks verifiable and scoped to the outcome. Update existing decisions when
direction changes. Do not let a planning phase discard implementation authorization.

Reuse the lead session's intake and source findings. Retrieve context in narrow steps:
search the knowledge map and likely paths, assess the concrete gap, then expand only
where needed. Check existing repository/dependency solutions before introducing a new
helper or tool. For external claims use primary sources and record their URLs/versions.
Keep the summary as a checkpoint: decisions, relevant paths, unresolved questions and
next work. Native compaction is automatic; summaries aid recovery but do not preserve
hidden model state or guarantee lower billed tokens. See harness/README.md for ECC provenance.
