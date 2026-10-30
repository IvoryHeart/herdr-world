---
name: candidate-delivery
description: Deliver a Herdr World branch candidate or review repair through staged formatting, repository hooks, and PR handoff. Use for implementation or documentation handoff, not advice-only work.
---

# Candidate delivery

Work in the required branch worktree. During editing, run focused tests or quick
type checks only when they answer a specific question. Do not run mutating
formatting after each patch.

When the candidate and focused regressions are complete, stage only intended
files. Run `bun run format:staged` once, restage its changes, and inspect the
final diff. The command rejects staged files that also have unstaged edits;
separate those edits first. A docs-only candidate is a safe no-op. Do not format
the whole repository for a scoped change.

Commit with the existing read-only pre-commit format/lint guard when committing
is part of the requested handoff. For PR delivery, push
the complete candidate once and let the pre-push hook run
`bun run check:changed` for code (gate or configuration changes select the full
gate; the explicit agent-tooling allowlist shares CI's shorter path). A
Markdown-only follow-up may use
`bun run check:docs` when this worktree has a successful code gate on an ancestor. CI
runs the applicable gate on the PR head, and reuses successful full results or scoped results with identical selections on
the exact PR, base and head for description edits and label changes. Do not run a separate final full check
immediately before that push. For an explicitly local-only handoff, run one
explicit `bun run check:delivery` instead. If a later repair changes code, begin a new
candidate cycle.

In Codex, when a command returns a running session, call `write_stdin` on that
session with empty `chars` and `yield_time_ms: 300000`; wait again only if it
actually times out and remains running. Apply the same rule to `gh run watch`.
Do not issue 30-second status loops or separate `ps`/`gh pr checks` probes while
the blocking command is running. Do not add a Codex lifecycle hook for polling;
it cannot intercept `write_stdin`.

When delivering a PR, keep its changelog fragment (`changes/<pr-number-or-slug>.md`,
format in `changes/README.md`) and mention it in the PR description; for a change
with nothing user-facing, put `Changelog: none — <specific reason>` in the
description instead. Do not edit `CHANGELOG.md` directly. The PR URL supplies the
link; do not amend the branch solely to rename the fragment after the PR number
or require a self-link in the description.
Prepare the PR body in a local file after committing the candidate. Run
`bun run check:pr-body <file>` (append the base ref for a stacked PR), then use
that same file with `gh pr create --body-file <file>` to open one ready PR.
The check uses CI's knowledge-map and changelog policies against committed HEAD.
Preserve independent review and CI. For a local-only handoff, finish after the
requested artifacts
and one explicit full check; a PR is not required to count the work as delivered.
Keep later usage and process measurements in workflow output or artifacts
instead of editing the PR body solely for totals.
