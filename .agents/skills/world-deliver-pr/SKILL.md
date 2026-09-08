---
name: world-deliver-pr
description: Deliver an authorized Herdr World branch as a reviewed pull request with current validation evidence.
---

Follow AGENTS.md. Work on a branch and use npm run agent:verify -- check (or acceptance)
before delivery. Use npm run agent:deliver -- --title "..." --body-file <file> to
validate the receipt, push the current non-main branch and open a PR.
The helper also requires .agents/state/task.json. Ralph delivery must match its recorded
worktree, parent and exact reviewed/verified candidate, with native review/QA histories
independent from implementation. A test receipt alone does not prove harness execution.
It appends execution mode, run ID, role/model usage and review evidence to the PR body.
Use agent:task report to inspect that evidence before publishing. Do not bypass a rejected
delivery through direct git/gh commands. For an existing PR, run agent:task report and the
current verification checks before pushing its update; include the execution report in its body.
Harness maintenance uses a declared interactive exception; other exceptions require the owner's
explicit request. Interactive delivery is labelled and never counted as a successful Ralph trial.
For a stacked task pass --base <recorded-parent-branch>; otherwise the base is main.
The helper never commits, merges or pushes main. It rejects dirty or stale candidates.
Write the body around the problem, resulting behavior, checks and limitations.
Review for private data before publishing. Add the PR reference to relevant changelog
entries afterward, revalidate and push that attribution-only branch update. It is post-delivery
bookkeeping, not a new reviewed Ralph candidate; any product repair must return through the run.
Stop at the PR.
