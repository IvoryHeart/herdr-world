# Crew worker delivery

The dispatcher includes this handoff in every implementation worker brief.
Follow [agent development](agent-development.md) and the
[candidate-delivery skill](../.agents/skills/candidate-delivery/SKILL.md).

```text
- Deliver the complete candidate in your own branch worktree, including tests,
  current documentation and a changelog fragment where required.
- After committing, prepare the final PR description in a local file.
- Run `bun run check:pr-body <file>`; fix all knowledge-map and changelog failures.
  Append the base ref when the PR targets another branch.
- Use that same file with `gh pr create --body-file <file>` to open a ready PR.
  Include `Fixes #<issue>` and set every required pod/track label at creation.
- Leave independent review and CI to report; fix findings in place. Do not merge.
```

The check uses CI's existing policy functions against the committed PR diff.
Keep live dispatch briefs and ledgers local. After merging a template change, the
owner copies the delivery steps above into the live dispatcher worker template.
