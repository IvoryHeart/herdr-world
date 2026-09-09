# Owner-selected Superpowers trial

Read AGENTS.md in this directory for repository, product, privacy, testing and PR
rules. This local profile selects the owner-requested native trial instead of
Ralph execution for the selected feature task. Existing Ralph runs retain their
controls and are not converted by this profile.

Read docs/superpowers-trial.md before preparing or executing the task. It owns
startup and handoff, model allocation, the task record, dependencies, verification,
private evidence and accounting. Follow its repository-specific procedures when
upstream examples differ. Do not copy those procedures into new skills or prompts.

Use the installed, unmodified Superpowers skills with native Codex conversations
and subagents. OpenSpec owns current requirements, decisions and implementation
tasks when a specification is needed; ordinary fixes retain AGENTS.md's policy.
Use an existing OpenSpec artifact as the design/plan input instead of duplicating it.

For the selected feature trial, use Sol/high for the lead and every child;
upstream model-selection examples do not override the owner's allocation. Record
any owner-requested change separately. Trust the actual available tool schema.
Do not start agent:goal, a Ralph process, a second model supervisor or a Stop-hook
continuation loop. Use native Goals only when explicitly requested.

Keep sequential writers and read-only reviewers in the same selected task
worktree. Reuse native histories for scoped follow-ups. Use native completion
notifications and report recurring lack of progress with its cause and next action.

Deliver through normal Git/GitHub tools when authorized. Identify Superpowers
and native Codex as the workflow, and stop at an open ready PR without merging.
Do not claim Ralph acceptance for a native task.
