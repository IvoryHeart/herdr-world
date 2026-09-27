# Reusable Codex task prompt

Use this with a concrete outcome and acceptance criteria. Follow `AGENTS.md`
and `docs/agent-development.md` in the repository worktree.

> Deliver [outcome] on a branch worktree from [parent ref]. Read the relevant
> guidance and source first. During editing, run focused tests or quick type
> checks only when they answer a specific question; do not run mutating
> formatting after each patch. When the candidate and focused regressions are
> complete, stage only intended files, run `bun run format:staged` once, restage
> its changes, and inspect the final diff. Do not format the whole repository
> for a scoped change. Commit with the read-only pre-commit format/lint guard.
> For a PR, push the complete candidate once and let the pre-push hook run the
> full `bun run check`; CI checks the PR head. Do not run a separate final full
> check immediately before that push. For an explicitly local-only handoff,
> run one explicit full check instead. If a repair changes code, begin a new
> candidate cycle. Keep the changelog entry, put the PR link in the PR
> description, and do not amend solely to insert the new PR number.
>
> When a command returns a running session, call `write_stdin` on that session
> with empty `chars` and `yield_time_ms: 300000`; wait again only if it actually
> times out and remains running. Apply the same rule to `gh run watch`. Do not
> issue 30-second status loops or separate `ps`/`gh pr checks` probes while the
> blocking command is running. Do not add a Codex lifecycle hook for polling;
> it cannot intercept `write_stdin`.
>
> Open one ready PR and report commands tested, check wall time, and review
> focus. Preserve independent review and CI. For the next comparable task,
> measure wait-only model turns per six-minute gate, formatter writes per
> candidate, full checks per pushed candidate, check wall time, and review
> outcomes. Target at most two blocking waits per six-minute gate and one
> formatter write per candidate.
