# General task delivery prompt

Use this for implementation or documentation tasks with a concrete outcome and
acceptance criteria. Replace the placeholders and follow `AGENTS.md` and
`docs/agent-development.md` in the repository worktree. The repo-local
`candidate-delivery` skill gives a detailed handoff procedure when needed. The
Codex wait rule below applies when the agent has a `write_stdin` tool.

> Deliver [outcome] on a branch worktree from [parent ref]. Read the relevant
> guidance and source first. During editing, run focused tests or quick type
> checks only when they answer a specific question; do not run mutating
> formatting after each patch. When the candidate and focused regressions are
> complete, stage only intended files, run `bun run format:staged` once, restage
> its changes, and inspect the final diff. The command rejects staged files
> with unstaged edits; separate those edits before formatting. Do not format
> the whole repository for a scoped change. Commit with the read-only
> pre-commit format/lint guard.
> For a PR, push the complete candidate once and let the pre-push hook run the
> full `bun run check`; CI checks the PR head. Do not run a separate final full
> check immediately before that push. For an explicitly local-only handoff,
> run one explicit full check instead. If a repair changes code, begin a new
> candidate cycle. Keep the changelog entry and do not amend solely to insert
> the new PR number. Prepare the final PR body before creation, without a
> self-link. Keep later usage accounting in the workflow output rather than
> editing the PR body and restarting CI.
>
> In Codex, when a command returns a running session, call `write_stdin` on
> that session with empty `chars` and `yield_time_ms: 300000`; wait again only
> if it actually times out and remains running. Apply the same rule to
> `gh run watch`. Do not issue 30-second status loops or separate
> `ps`/`gh pr checks` probes while the
> blocking command is running. Do not add a Codex lifecycle hook for polling;
> it cannot intercept `write_stdin`.
>
> For PR delivery, open one ready PR and report commands tested, check wall
> time, and review focus. For explicitly local-only delivery, stop after the
> full local check and report. Preserve independent review and CI for PRs.
