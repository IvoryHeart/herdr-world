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

## Run an optional visible team

The repository includes an opt-in
[Herdr Workflows recipe](../.hwf/workflows/agent-delivery.yaml) for two visible
Codex agents. It uses a startup handshake, one implementation pass, independent
diff review, one correction pass, a final review verdict, and the existing
candidate delivery gates. Herdr Workflows is an external operator tool; this
repository does not install it or require it for ordinary development or CI.

Create a clean branch worktree with `bun run agent:worktree -- create` first.
From a Herdr pane in the primary checkout, supply that worktree's absolute path
and a concrete task brief:

```bash
hwf run agent-delivery \
  --input worktree_dir=/path/to/repo/.agents/worktrees/example \
  --input agent_profile=codex \
  --input task_brief='Deliver the requested change and its acceptance criteria'
```

The tracked `.hwf/config.yaml` supplies a generic Codex profile; put local
overrides in ignored `.hwf/config.local.yaml`. The workflow rejects a dirty
worktree or `main`, and its final review must approve before the implementor
commits and pushes. A remaining review blocker stops the workflow for operator
inspection; do not treat a stopped run as a delivered candidate. The PR still
needs independent approval. OpenSpec is used only when the task meets the
repository's contract criteria above.

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
lint, and the pre-push hook checks the candidate. Code changes get the full
`bun run check`; a Markdown-only follow-up may use `bun run check:docs` after
this worktree has a successful full gate on an ancestor. Worktrees share the
same Git hook configuration.

Batch independent read-only inspections in one tool turn. Keep `rg` results and
source excerpts bounded, then read more only when needed. The pre-push hook writes
one ignored `.agents/delivery/pre-push.tsv` row per gate with UTC timestamp,
head SHA, exit code, elapsed seconds and gate name. This worktree-scoped file
is a local diagnostic, not durable PR accounting. The hook prints a short
success status; on
failure it prints a concise summary and the path to the complete retained log.
Inspect that log only when needed, preserving the check's exit status. For
review-only work, inspect exact-head CI evidence first. CI uses
`bun run check:docs` for Markdown-only PR diffs and skips the macOS lifecycle
on those diffs. On PR-description edits, a code PR can reuse successful full jobs on
the exact base and head; if that proof is missing or failed, CI runs the full
gate. The existing three required status names stay in place.
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

`agent:usage` remains available for [optional Codex usage audits](agent-usage-audit.md).
Do not make agent-run token accounting a routine pre-PR step. The measurement
follow-up owns durable task/session/PR-linked usage collection; local rollout
records are interim evidence.

## Revisit the process

For the next comparable task, the process review measures wait-only model turns
per six-minute gate from the Codex rollout; formatter writes per candidate from
`format:staged` output and the rollout; full checks per pushed candidate and
check wall time from the pre-push hook and CI run metadata; and review
outcomes from the PR timeline. A durable workflow artifact must join these
records to the task, session, PR and candidate head before the worktree is removed.
Add ingestion or upload for the local hook report in that measurement follow-up;
the ignored TSV alone is insufficient. `agent:usage --tooling` cannot count a check
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

The [UI scale browser test timing analysis](ui-scale-test-performance.md) records
the current slow-case measurements and a proposed test-design experiment.
The [World handoff browser test timing analysis](world-handoff-test-performance.md)
records its deadline shortcut, measured saving and scroll-race diagnosis.
