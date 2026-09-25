# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. There is no repository-owned agent
supervisor, model scheduler, skill installer, usage collector or evaluation harness.

## Start work

Read `AGENTS.md`, then use [the knowledge map](knowledge-map.md) to find the relevant
contract, source, tests and runbook. Resolve any requested parent pull request to its
actual branch and commit before creating a worktree:

```bash
bun run agent:worktree -- create <slug> <parent-ref>
```

The helper places `agent/<slug>` below the primary checkout's `.agents/worktrees/`
directory and rejects unsafe names or unknown refs. `bun run agent:worktree -- list`
is read-only. Do not move, clean or reuse another agent's worktree.

## Deliver a change

Start from the owner's requested outcome and inspect existing behavior before editing.
Clarify only choices that materially alter scope. Keep one writer for overlapping
files; use native subagents only for bounded parallel work or independent review.

OpenSpec is a decision aid for maintained product contracts. Use the project lifecycle
skills to explore, propose, update, apply, synchronize, verify or archive an applicable
change. Routine fixes, dependency refreshes, refactors, documentation, releases and
upstream synchronization do not require a new proposal. Invoke the pinned CLI with:

```bash
bun run spec -- status --change <name> --json
bun run spec:check
```

When implementation changes a current contract, source map or operational procedure,
update the affected spec, knowledge-map row or runbook in the same PR. Leave
machine- and user-specific data untracked and use synthetic examples in tests.

## Verify and hand off

Add a focused regression check for behavior changes, then verify in proportion to
risk. `bun run check` is the final candidate gate and includes generated notices,
formatting, lint, type checking, all tests, production builds and strict OpenSpec
validation. Run `CHROME_BIN=/path/to/chromium bun run test:browser` for browser-heavy
changes and `bun run build:site` for the project site.

Inspect the final diff and history for unrelated edits, generated output and sensitive
data. Record exact verification and agent execution in the pull request using the
[PR template](../.github/pull_request_template.md). The
[World package usage retrospective](agent-usage-retrospective.md) explains the
token fields, measurement limits and patterns worth tracking. Reuse earlier
results only when their relevant inputs are unchanged. Open a ready PR and stop
before merge.
