---
name: world-deliver-pr
description: Deliver an authorized Herdr World branch as a reviewed pull request with current validation evidence.
---

Follow AGENTS.md. Work on a branch and use npm run agent:verify -- check (or acceptance)
before delivery. Use npm run agent:deliver -- --title "..." --body-file <file> to
validate the receipt, push the current non-main branch and open a PR.
The helper never commits, merges or pushes main. It rejects dirty or stale candidates.
Write the body around the problem, resulting behavior, checks and limitations.
Review for private data before publishing. Add the PR reference to relevant changelog
entries afterward, revalidate and push that branch update. Stop at the PR.
