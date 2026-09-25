# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. There is no repository-owned agent
supervisor, model scheduler, skill installer, usage collector or evaluation harness.

## Start work

Read `AGENTS.md`, then use [the knowledge map](knowledge-map.md) to find the relevant
contract, source, tests and runbook. Locate relevant headings in large contracts
before reading full sections, and widen the read when the change crosses them.
Resolve any requested parent pull request to its actual branch and commit before
creating a worktree:

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

## Keep agent work bounded

For an independent PR or focused review repair, start a fresh agent session when
the current context is large. Hand off the branch tip, requested invariant,
relevant files, review comments and latest check result; inspect other context
on demand. For changes across async, identity, failure or UI focus boundaries,
review those transitions against the diff and add applicable focused regressions
before the final gate. Match model and reasoning effort to the risk, then assess
quality and correction rate alongside tokens and time.

## Verify and hand off

Add a focused regression check for behavior changes, then verify in proportion to
risk. `bun run check` is the final candidate gate and includes generated notices,
formatting, lint, type checking, all tests, production builds and strict OpenSpec
validation. Run `CHROME_BIN=/path/to/chromium bun run test:browser` for browser-heavy
changes and `bun run build:site` for the project site.
While a stacked parent or review repair is still changing, use focused checks;
run the full gate on the final candidate branch tip.
For long check output, retain the complete log outside the prompt and inspect a
short success summary or the relevant failure excerpt first.

Inspect the final diff and history for unrelated edits, generated output and sensitive
data. Record exact verification and agent execution in the pull request using the
[PR template](../.github/pull_request_template.md). Reuse earlier results only
when their relevant inputs are unchanged. Open a ready PR and stop before merge.

## Revisit the process

After a batch of roughly five agent-assisted PRs, and during release preparation,
the agent closing the batch compares usage boundaries, model responses,
compactions, elapsed time, repeated full checks and review repairs. Try one
workflow change at a time and keep it only if it saves work without increasing
defects. Update this short guide when a practice is supported; keep detailed
evidence in the relevant PRs, separate from routine startup reading. This
review is not a gate for individual PRs.
