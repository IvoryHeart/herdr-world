---
name: firstmate-handoff
description: Move in-flight work between agents or harnesses through PR branches, pause and resume agents around usage limits, and restart agents without losing their task. Use when an author is paused, rate-limited, restarted or replaced.
---

# FirstMate handoff

Work moves between agents through **git branches and file briefs**, never through
an agent's memory. A handoff is safe when the receiver can start from the branch
tip and a brief alone, and the original author can resume by pulling.

## Hand a PR to a fixer

Use this when an author is paused (usage limit, outage) and its PR has open
review findings.

1. Brief the fixer with a table: PR, its own worktree and local branch, the PR
   branch to push to, and the findings to fix (link the reviews).
2. The fixer creates its own branch from the remote PR branch:
   `git worktree add -b fix/<N> <worktrees>/fix-<N> origin/<pr-branch>`.
   - **Never** `git checkout -B` or `git branch -f` an existing agent branch. If
     that branch is checked out in the author's worktree, the reset hides the
     author's unpushed commits. (Recovery, if it happens:
     `git update-ref refs/heads/<branch> <sha-from-reflog>`.)
   - Never check out a PR branch in a second worktree.
3. The fixer pushes without force: `git push origin HEAD:<pr-branch>`. A rejected
   push means the author pushed meanwhile: stop and tell the delegator.
4. The fixer follows the review loop (one line per finding naming the fixing
   commit, then prompts the reviewers to confirm).
5. Tell the author, in the resume prompt: "`git pull --ff-only` before anything
   else; <fixer> pushed <commits> to your branch."

When the author resumes, give the PR back explicitly: the fixer stops touching
that branch and says so.

## Pause and resume around usage limits

- When the owner reports a low budget, tell agents on that harness to finish the
  in-flight step (commit, push, review post) and then idle. Route new work to
  another harness.
- Schedule a one-shot resume for each known reset time (harness crons die with
  the delegator's session, so record them in the ledger too). At each resume:
  1. Read the ledger.
  2. List agents (`herdr agent list`) and read each stopped agent's screen.
  3. Prompt only agents that are idle or done at a normal input; never answer a
     permission or question prompt.
  4. Give each a concrete next step with its open items listed in the prompt.
  5. Restart any background watchers you rely on.
  6. Write the owner a short status.

## Restart an agent

A restart wipes the agent's context, and its Herdr name goes with it.

1. Make sure its work is on a pushed branch, or note the unpushed commits.
2. Start the new agent in the same worktree; rename it to the same name.
3. Prompt: "You are <name>. Read <briefs-dir>/<name>.md. Open items: <list>.
   Run `git status` and `git log origin/<branch>..` first."
4. Update the roster if the harness or model changed.

## Ownership rules

- One writer per branch at a time; record who holds each PR in the ledger.
- A handoff names the exact commit the receiver starts from.
- If the target commit changes under a task (a new push, a merge of main), cancel
  or re-brief rather than letting work land on a stale base.

## Config

| Key | This repository's value |
|---|---|
| worktrees | `.agents/worktrees/` below the primary checkout |
| briefs-dir | `.agents/firstmate/briefs/` |
| fixer | a Codex agent named `fixer` (see firstmate-dispatch for its flags) |
| reset schedule | the owner's Claude limit resets about every 5 hours; times are in the ledger |
