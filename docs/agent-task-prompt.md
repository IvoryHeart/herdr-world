# General task delivery prompt

Use this for implementation or documentation tasks with a concrete outcome and
acceptance criteria. Replace the placeholders. The repo-local
`candidate-delivery` skill owns the delivery procedure; the Codex wait rule is
repeated here so a copied task prompt can apply it directly.

> Deliver [outcome] on a branch worktree from [parent ref]. Acceptance criteria:
> [criteria]. Follow `AGENTS.md` and invoke the repo-local `candidate-delivery`
> skill for the candidate, verification and handoff. State whether this is PR
> delivery or an explicitly local-only handoff.
> For code, let the pre-push hook run the full check once. A Markdown-only
> follow-up can use `check:docs` after a successful full gate on an ancestor;
> CI uses documentation checks for Markdown-only PR diffs and reuses exact-head
> full results for description edits. Do not run a duplicate full check before push.
>
> In Codex, when a command returns a running session, call `write_stdin` on
> that session with empty `chars` and `yield_time_ms: 300000`; wait again only
> if it actually times out and remains running. Apply the same rule to
> `gh run watch`. Do not issue 30-second status loops or separate
> `ps`/`gh pr checks` probes while the
> blocking command is running. Do not add a Codex lifecycle hook for polling;
> it cannot intercept `write_stdin`.
>
> Report the commands tested, check wall time and any unresolved limits.
