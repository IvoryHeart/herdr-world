---
name: firstmate-merge-queue
description: Hand ready PRs to the owner in a sensible order, keep the rest mergeable after each merge, and watch main afterwards. Use when PRs report READY, after any merge to main, or when main goes red.
---

# FirstMate merge queue

The owner merges; the delegator decides what is ready and in what order, and
keeps everything else current. Never merge, approve, or bypass branch protection,
and never put a bypass flag even in a command you suggest to the owner.

## Verify READY yourself

An author's "READY #N" is a claim. Check it:

```bash
gh pr view <N> --json isDraft,mergeable,mergeStateStatus,headRefOid,statusCheckRollup,reviews
```

- `isDraft` false.
- `mergeable` MERGEABLE and `mergeStateStatus` not BEHIND (with an up-to-date
  rule, BLOCKED only because reviews are required is expected; BEHIND is not).
- CI green on `headRefOid`, not on an older run.
- Every finding confirmed (see firstmate-review-loop), and UI screenshots present.

## Order

When several PRs are ready, propose an order that minimises rework:

1. Fixes for CI, flakes or the check queue first: they unblock everyone.
2. Small and docs-only PRs next.
3. PRs that overlap many others early, so others rebase once.
4. Stacked PRs in stack order; retarget the child to main after the base merges.
5. The largest, most overlapping PRs after the ones they overlap.

A strict queue (only the head PR updates and reruns CI) is for crises such as a
red main; otherwise the order is a preference and any confirmed, green,
conflict-free PR may merge. Big mechanical refactors (file splits) wait until
the queue drains, since each one restales everything.

Tell the owner in one line per PR: number, title, why now. Use a Herdr
notification (`herdr notification show`) when the owner is away from the pane.

## After each merge

1. List open PRs that now conflict or are BEHIND.
2. Tell each author: no conflict → update the branch through the API
   (`gh api -X PUT repos/<repo>/pulls/<N>/update-branch -f expected_head_sha=<sha>`,
   then the author pulls before pushing again); conflict → merge `origin/main`
   locally, resolve, push, and post a one-line resolution note. Non-trivial
   resolutions get a quick check from the original reviewer.
3. Watch main's post-merge run (`gh run watch <run> --exit-status`). On red:
   - Fetch logs through `gh api repos/<repo>/actions/jobs/<id>/logs`
     (`--log-failed` can return nothing).
   - Match the error against open issues before rerunning; rerun only known
     flakes (`gh run rerun <id> --failed`).
   - A real break on main freezes new pushes except the fix; route it to the
     area owner.
4. Refresh any instance that tracks main, if the owner wants that.
5. Move the PR to done in the ledger, and add it to the post-merge re-review list
   if it was approved without a reviewer from each harness.

## Config

| Key | This repository's value |
|---|---|
| repo | `IvoryHeart/herdr-world` |
| merger | the owner only |
| known flakes | listed in the ledger; rerun only those |
| queue file | `.agents/firstmate/merge-queue.md` (crisis use) |
| main instance | 8788 tracks main; rebuild after merges |
| gh notes | the installed gh has no `pr update-branch`; use the API call above |
