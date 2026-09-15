# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts, and ordinary project checks. There is no repository-owned agent
supervisor, model scheduler, skill installer, usage collector, or evaluation harness.

## Start work

Read `AGENTS.md`, then use [the knowledge map](knowledge-map.md) to find the relevant
contract, source, tests, and runbook. Resolve any requested parent pull request to its
actual branch and commit before creating a worktree. New worktrees belong under the
primary checkout:

```bash
npm run agent:worktree -- create <slug> <parent-ref>
```

The helper creates branch `agent/<slug>` and rejects unsafe names or unknown refs.
Use `list` for read-only inspection. Do not move, clean, or reuse another agent's
worktree without coordination.

## Deliver a change

Start from the owner's requested outcome and inspect existing behavior before editing.
Clarify only choices that materially change scope. Keep one writer for overlapping files;
use native subagents only for bounded parallel work or independent review. Continue an
authorized correction in the same conversation when practical.

OpenSpec is a decision aid for maintained product contracts. Use the five project skills
to explore, update, apply, synchronize, or archive an applicable change. Routine fixes,
dependency refreshes, refactors, documentation, release work, and upstream synchronization
do not need a new proposal. Invoke the pinned CLI through:

```bash
npm run spec -- status --change <name> --json
npm run spec:check
```

When implementation changes a current contract, source map, or operational procedure,
update the affected spec, knowledge-map row, or runbook in the same PR. Keep synthetic
examples in tracked evidence and leave machine- or user-specific data untracked.

## Verify and hand off

Establish a focused regression check for behavior changes, then run verification in
proportion to risk. `npm run check` is the final repository candidate check and includes
strict OpenSpec validation. `npm run check:acceptance` adds browser, security, and
independence checks when the change affects those boundaries.

Inspect the final diff and status for unrelated edits or sensitive data. Record the exact
commands and results in the pull request. Reuse successful evidence only when its relevant
inputs have not changed. Open a ready PR and stop before merge; repository review policy
remains in `AGENTS.md`.
