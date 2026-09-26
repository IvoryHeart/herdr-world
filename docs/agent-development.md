# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. There is no repository-owned agent
supervisor, model scheduler, skill installer or evaluation harness. The local
`agent:usage` script reports recorded usage without scheduling agent work.

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
risk. Use a targeted test to reproduce a failure when needed. Once a coherent
implementation is complete, run its relevant focused tests before opening the PR;
do not repeat successful checks after every edit or commit. Run a repository-wide
quick type check after affected interfaces are integrated, or sooner to diagnose a
type failure. Agents with separate file ownership should report focused results;
the integrator owns repository-wide checks. Run
`CHROME_BIN=/path/to/chromium bun run test:browser` for browser-heavy changes and
`bun run build:site` for the project site.

CI runs `bun run check` on the PR head. It includes generated notices, formatting,
lint, type checking, all tests, production builds and strict OpenSpec validation.
Use its exact-head result as the final gate; run the full check locally only when CI
cannot cover the candidate or to investigate a failure. Open a ready PR after the
focused checks, then let CI finish. If CI fails, repair the cause, run the relevant
focused check, and let CI validate the new head. The local commit hook checks
formatting and lint; let it run automatically instead of issuing separate commands.
For an agent worktree without installed hooks, use
`git -c core.hooksPath=.githooks commit` to enable the tracked hook for that commit
without changing shared config. The hook does not replace CI.

Batch independent read-only inspections in one tool turn. Keep `rg` results and
source excerpts bounded, then read more only when needed. Keep complete check logs
outside the prompt; report a short status on success and the relevant diagnostics
on failure. Preserve the check's exit status. The commit hook is silent on success
and prints the failed check's output.
For review-only work, inspect the exact-head CI result and recorded evidence first.
Run a local check only to investigate a specific gap or reproduce a finding; do not
repeat a successful full gate on the same commit.
Check CI when its result affects a repair or merge decision; avoid repeated
status polling while it runs.

Inspect the final diff and history for unrelated edits, generated output and sensitive
data. Record exact verification and agent execution in the pull request using the
[PR template](../.github/pull_request_template.md). Reuse earlier results only
when their relevant inputs are unchanged. Open a ready PR and stop before merge.

For Codex token usage, run `bun run agent:usage -- --pr <number> --session
<session-id> --from <ISO-UTC> --until <ISO-UTC>` in the checkout. Repeat
`--session` for contributing agents, or omit it to use the current
`CODEX_SESSION_ID` for a root agent. Pass each subagent's rollout UUID explicitly:
its environment may inherit the parent's `CODEX_SESSION_ID` and misattribute usage.
Omit either time bound only when the whole session belongs
to the PR. The script reads local Codex rollout files under
`$CODEX_HOME/sessions` (or `~/.codex/sessions`), sums per-response
`token_usage_record` entries including compaction, and prints only aggregate
counts and the chosen boundary. Its `--pr` value labels the report; it cannot
infer which turns belong to a PR. Record the explicit session/time boundary in
the PR and rerun near handoff. Cached input is included in input, and reasoning
is included in output. These counts are not billed cost. The local Prometheus
`codex_turn_token_usage` series aggregates by model and token type without a
session label, so it cannot substitute for the PR-specific rollout count.
Add `--tooling` to report aggregate tool calls, recognized check commands, and
output size for the same boundary. Command counts are best effort for literal
shell commands; the report never prints command text or tool output.

## Revisit the process

After a batch of roughly five agent-assisted PRs, and during release preparation,
the agent closing the batch compares usage boundaries, model responses,
compactions, elapsed time, repeated full checks and review repairs. Try one
workflow change at a time and keep it only if it saves work without increasing
defects. Update this short guide when a practice is supported; keep detailed
evidence in the relevant PRs, separate from routine startup reading. This
review is not a gate for individual PRs.
