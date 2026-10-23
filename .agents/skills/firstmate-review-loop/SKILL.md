---
name: firstmate-review-loop
description: Run the author-driven review loop for a crew PR - pick two independent reviewers, route findings, confirm fixes, and decide when a PR is ready for the owner. Use when an author asks for reviewers or reports a review result.
---

# FirstMate review loop

Reviews are author-driven: the delegator assigns reviewers, then authors and
reviewers talk to each other directly and copy the delegator on outcomes. The
delegator's job is assignment, triage and the ready decision.

## Assign reviewers

- **Default:** two independent reviewers on different harnesses (one Claude, one
  Codex).
- **When one harness is unavailable:** two reviewers on *different models* of the
  other harness are enough. Large, cross-area or contract-changing PRs approved
  this way go on the **post-merge re-review list** in the ledger and get a review
  from the missing harness once it is back; findings become follow-up PRs.
- A fresh agent gives the independent first review; the same agent re-checks its
  own findings.
- With a stagger (second reviewer starts after the first), tell the second to form
  its own view before reading the first review, then reconcile. Disagreements on
  severity are useful; surface them.

Reviewer brief (fill in and send; see firstmate-dispatch for delivery):

```
[<delegator> -> <reviewer>] Review PR #<N> at <head-sha> (<task-id>).
Check: <criteria>. Post with `gh pr review <N> --comment`, starting
"<reviewer> review of <sha>:", one line per finding with a P1-P3 severity.
Do not approve, push or merge. Form your own view before reading other reviews.
Then prompt <author> with the review URL, and reply to <delegator> in one line:
RESULT #<N>: <count> findings (<severities>).
```

## The loop

1. The reviewer posts on GitHub and prompts the author with the review URL.
2. The author fixes **every** finding (P1-P3) in one pass after all reviews have
   landed, replies on the PR with one line per finding naming the fixing commit,
   and prompts each reviewer to confirm.
3. The reviewer confirms on the new head only (a focused check, not a fresh full
   review) and reports `RESULT #<N>: x/y resolved, z new`.
4. New findings: back to step 2. After a **second** round with findings still
   open, escalate to the owner or split the PR. Do not create re-review branches.

## Triage (delegator)

- Deduplicate and rank findings across reviewers; name disagreements.
- Prefer evidence over votes: two clean reviews plus green CI do not prove a PR
  correct. Read the riskiest finding yourself.
- Before calling anything ready, check that every commit after the reviews was
  itself reviewed.
- Prefer durable results (`gh pr view <N> --json reviews,comments`) over terminal
  scraping. All agents post under the owner's GitHub account, so the name prefix
  is the only provenance; insist on it.

## Ready

A PR is READY only when all hold:

- Not a draft (agents open PRs ready, not draft).
- Every finding from every reviewer is confirmed resolved.
- CI is green on the **current** head.
- `mergeable` is MERGEABLE and `mergeStateStatus` is not BEHIND.
- UI PRs have screenshots at every required viewport.

Then pass it to the owner (see firstmate-merge-queue). Nobody else merges.

## Config

| Key | This repository's value |
|---|---|
| reviewers | `rev4`, `rev3` (Claude); `rev1`, `rev2` (Codex, different models) |
| severity scale | P1 (must fix), P2 (should fix), P3 (minor); all are fixed before ready |
| UI viewports | 5: phone, laptop, wide desktop, half-width desktop, portrait |
| reviewer test limit | while the machine is contended, reviewers run unit tests and typecheck only; CI is authoritative |
| re-review list | the ledger |
