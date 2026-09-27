# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. The local `agent:usage` script
reports recorded usage without scheduling agent work.

## Start work

Read `AGENTS.md`, then use [the knowledge map](knowledge-map.md) to find the relevant
contract, source, tests and runbook. Use the [foundation source guide](foundation-guide.md)
when work crosses service, browser or distribution modules. For visual tasks, start
with the [World component routes](../web/src/world/README.md). Locate relevant
headings in large contracts before reading full sections, and widen the read when
the change crosses them.
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
update the affected spec, knowledge-map row, foundation guide or runbook in the same PR.
New foundation modules need an owner and focused evidence in the guide. Leave
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

Add focused regression tests for behavior changes. The repo-local
[candidate-delivery skill](../.agents/skills/candidate-delivery/SKILL.md) gives
the detailed staged formatter, commit, push and local-only gate procedure for
multi-step handoffs and review repairs. Use
`bun run test:browser` when the browser suite answers a specific question, and
`bun run build:site` for site changes.

Run `bun run install-hooks` once per clone. The pre-commit hook checks format and
lint, and the pre-push hook checks the full candidate. Worktrees share the same Git
hook configuration.

Batch independent read-only inspections in one tool turn. Keep `rg` results and
source excerpts bounded, then read more only when needed. The pre-push hook writes
one ignored `.agents/delivery/pre-push.tsv` row per full gate with UTC timestamp,
head SHA, exit code and elapsed seconds. It prints a short success status; on
failure it prints a concise summary and the path to the complete retained log.
Inspect that log only when needed, preserving the check's exit status. For
review-only work, inspect exact-head CI evidence first.
Run a local check only to investigate a specific gap or reproduce a finding; do
not repeat a successful full gate on the same commit. When a command returns a
running session, call `write_stdin` on that session with empty `chars` and
`yield_time_ms: 300000`; wait again only if it actually times out and remains
running. Apply the same rule to `gh run watch`. Do not issue 30-second status
loops or separate `ps`/`gh pr checks` probes while the blocking command is
running. A Codex lifecycle hook cannot intercept `write_stdin`; do not add one
for polling. The reusable [task prompt](agent-task-prompt.md) repeats this rule.

Inspect the final diff and history for unrelated edits, generated output and sensitive
data. Prepare the PR body with available verification and agent execution using the
[PR template](../.github/pull_request_template.md) before creating the PR; use
`unknown` for values not yet available. Include the Unreleased changelog entry
before the first push; the PR number need not be added to it or linked from the
PR body. Keep later usage accounting in the workflow output and final handoff
instead of editing the PR body solely for totals, because an edit starts another
CI run. Reuse earlier results only when their relevant inputs are unchanged.
Open a ready PR and stop before merge.

For Codex token usage before PR creation, run `bun run agent:usage -- --session
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
the initial PR body; a later rerun can use `--pr <number>` for its output label,
with its new totals retained in workflow output. Cached input is included in
input, and reasoning is included in output. These counts are not billed cost.
The local Prometheus
`codex_turn_token_usage` series aggregates by model and token type without a
session label, so it cannot substitute for the PR-specific rollout count.
Add `--tooling` to report aggregate tool calls, recognized check commands, and
output size for the same boundary. Command counts recognize executable positions
in literal shell commands, excluding comments, quoted data and heredoc bodies;
dynamic or opaque shell scripts may be missed. The report never prints command
text or tool output.

## Revisit the process

For the next comparable task, the process review measures wait-only model turns
per six-minute gate from the Codex rollout; formatter writes per candidate from
`format:staged` output and the rollout; full checks per pushed candidate and
check wall time from the local hook report and CI run metadata; and review
outcomes from the PR timeline. `agent:usage --tooling` cannot count a check
executed inside the pre-push hook as a literal agent command. The first targets
are at most two blocking waits per six-minute gate and one formatter write per
candidate. Keep measurements in workflow artifacts and the process review; do
not edit a PR body later solely for these totals. Targets do not replace gates.

After a batch of roughly five agent-assisted PRs, and during release preparation,
the agent closing the batch compares usage boundaries, model responses,
compactions, elapsed time, repeated full checks and review repairs. Try one
workflow change at a time and keep it only if it saves work without increasing
defects. Update this short guide when a practice is supported; keep detailed
evidence in the relevant PRs, separate from routine startup reading. This
review is not a gate for individual PRs.
