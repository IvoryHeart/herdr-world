# Reusable agentic development stack

This is the extraction guide for another repository. Current operation lives in
[agent-development.md](agent-development.md); optional experiments live in
[agent-pilots.md](agent-pilots.md). Carry over the small native workflow and adapt
product contracts/checks, rather than copying Herdr World implementation details.

## Packages and installation boundaries

| Component | Pin tested here | Responsibility | Installation |
| --- | --- | --- | --- |
| Native Codex CLI | @openai/codex 0.153.4 | Conversations, implementation, native subagents/completion, journals | harness/package.json |
| OpenSpec CLI | @fission-ai/openspec 1.12.0 | Deliberate contracts, active changes, archived decisions | harness/package.json |
| Superpowers | 6.3.0; commit/digest in harness/superpowers/release.json | Upstream development skills | Shared local cache, repository skill symlink |
| OpenWiki | 0.5.0, pilot | Source-backed wiki pages, Claims and freshness workflow | Optional evals/pilots package; local Codex MCP/skill |
| Skillgrade | 0.3.0, pilot | Repeatable tasks and behavioral grading | Optional evals/pilots package |

The native workflow delivered PR82–84. That is practical delivery evidence, not a
controlled performance benchmark. OpenWiki and Skillgrade are pilots and do not
belong in every project's default bootstrap. Normal CI contains no model calls.
The pilot lockfile includes its upstream transitive SDKs; application bundles and
ordinary developer installs do not depend on them.

## Skills

Fourteen Superpowers skills are installed unchanged:

- Design/planning: brainstorming, writing-plans, executing-plans.
- Implementation: subagent-driven-development, systematic-debugging, test-driven-development.
- Review/delivery: requesting-code-review, receiving-code-review, verification-before-completion, finishing-a-development-branch.
- Supporting workflows: using-superpowers, using-git-worktrees, dispatching-parallel-agents, writing-skills.

Six repository-adapted OpenSpec skills expose explore, propose, update-change,
apply-change, sync-specs and archive-change. Two small World skills cover knowledge
maintenance and harness evaluation. Rename/adapt those two for a new repository;
keep them short and point to the canonical runbooks instead of repeating policy.
The optional OpenWiki integration installs one additional upstream openwiki skill.
Skillgrade is an evaluator, not another required development skill or lead agent.

## Files to adapt

| File/directory | What another project needs |
| --- | --- |
| AGENTS.md | Product boundaries, privacy, worktree convention, actual check commands, PR policy |
| docs/agent-development.md | One canonical workflow; tailor model defaults and evidence requirements |
| docs/knowledge-map.md | Short map from current contracts to source and tests |
| openspec/specs and openspec/changes | That project's current contracts and decisions, not this project's specs |
| .agents/skills | OpenSpec adaptations and the few repository-specific practices |
| harness/package.json and lockfile | Pinned development CLIs |
| harness/superpowers | Upstream pin/digest and local native config template |
| scripts/agent/worktree.mjs, skills.mjs, task.mjs | Small setup/provenance helpers; no model scheduler |
| scripts/agent/native-usage.mjs and tests | Codex-specific accounting; replace for other clients |
| evals/tasks.json and graders | Real failure cases and controls relevant to the new project |
| CI | Deterministic tests, contract validation and relevant product acceptance |

Keep .agents/worktrees, caches, local configuration, task notes and raw telemetry
ignored. Task worktrees belong under the primary checkout so linked worktrees do
not recursively create worktree trees. Share download caches/build outputs when
compatible; preserve per-task dependency ownership.

## Execution pattern

Owner request → lead clarifies and plans → implementer when useful → independent
review → scoped correction in retained histories → lead acceptance → ready PR.

Small tasks may stay with the lead through implementation. Roles do not mandate
agents, separate worktrees or fixed phases. Current owner-selected defaults are
Sol/xhigh lead, Luna/xhigh coding and Terra/xhigh product/adversarial work. Oracle
is a concrete optional consultation with an explicitly selected available model.
These mixed defaults have not been established by PR84, which used Sol/high.
Record actual allocations and investigate mismatches before comparing results.

Use native completion and resume. Do not put another Codex-launching supervisor
inside the running coding agent. Missing skill catalog entries can be handled by
explicitly reading installed skills; a new worktree alone does not justify a fresh
conversation. Native settings/MCP connections may still need an actual client reload.

## Evidence and lessons

- Product correctness and independent review are acceptance. Passing setup checks,
  agent agreement or reading a skill file is insufficient.
- Reproduce real failures, establish positive/negative grader controls and assess
  outcomes/trajectories. Label deterministic controls separately from model evals.
- Use focused checks while editing and complete acceptance for the final candidate.
  Reuse evidence when relevant inputs are unchanged; PR attribution is not a reason
  to repeat unrelated product suites.
- Lead context and wait responses can dominate usage. Retain reviewers, send deltas,
  avoid repeated reports/polling, and count the lead as well as children.
- Measure task time, review defects, interventions, setup/storage and native usage.
  Cached input is included in input; unknown billing is not zero cost. Unmatched
  features cannot prove a percentage saving.
- Check representative UI integration and real container sizes. Passing a small
  visual fixture missed navigation and panel-layout defects in this project.
- Keep experimental tools optional and give each a concrete success criterion.
  A combined pilot can test usefulness; separate matched replays are needed to
  attribute gains to a particular tool or model.

Retired here: Ralph Orchestrator, the custom supervisor/model containers and role
protocols, legacy workflow skills/live adapters, the unused Harbor execution path,
and Graphify's unused tool pin. ECC was researched but no full ECC platform was
adopted. Historical evidence remains; these components should not enter a new
boilerplate simply because they appeared in an earlier experiment.
