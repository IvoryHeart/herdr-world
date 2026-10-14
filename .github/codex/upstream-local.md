Handle exactly one queued upstream item in .agents/upstream-local/plan.json using
the upstream-integration skill in .agents/skills/upstream-integration/SKILL.md.
The launcher already validated that automation is enabled and acquired its local
worker lock. Read repository instructions. Preserve unrelated local work.

Use the trusted helper and prompts from this checkout, never candidate versions.
Run all gh operations against IvoryHeart/herdr-world explicitly. Do not change
repository settings, credentials or the schedule. If a required decision, failed
command or unresolved problem prevents completion, run the trusted helper's block
command, explain the blocker, and stop. Never claim success based on dispatch alone.
Do not loop on running jobs. Leave dispatched workflows to their completion events;
the next scheduled run can inspect the resulting queue.

For integration, create a dedicated worktree below this project's .agents/worktrees
from current origin/main (or the captured repair head). Install baseline dependencies
before preparing the merge. Use the trusted helper's prepare command with SYNC from
the plan. Apply the trusted upstream-integrate.md prompt and integration skill.
Leave HEAD unchanged and write the integration report to .agents/upstream/report.md.
Use the trusted helper's export command. Then create a separate publication worktree
at the saved start SHA and copy only candidate.patch into its ignored
.agents/upstream/export directory. Run the trusted helper's publish-local command
there with the original SYNC. This reconstructs the merge or repair, pushes through
the repository's pre-push delivery gate and dispatches bot PR publication. Preserve
both worktrees for operator inspection; do not remove other worktrees.

For review, create a separate review worktree at the plan's exact sync.head. Pass
only the trusted upstream-review.md prompt, SYNC and REVIEW_BASE to a NEW
`codex exec --ephemeral --sandbox read-only -c 'forced_login_method="chatgpt"'`
process with the trusted upstream-review.schema.json output schema. Do not resume
the implementation conversation or give the reviewer its reasoning. Save the JSON
verdict under .agents/upstream-local in this trusted checkout, outside the candidate.
The reviewer must not execute candidate scripts or use GitHub credentials. Invoke
the trusted helper's submit-review command with that file, SYNC and REVIEW_RUN_ID
from the plan. GitHub independently checks successful CI, current head and human
review policy before posting the verdict through the separate reviewer App.
Never replace the independent verdict with your own or submit an approving review
directly. Do not merge any PR yourself.
