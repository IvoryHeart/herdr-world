# Owner-selected Superpowers trial

Read AGENTS.md in this directory for repository, product, privacy, testing and PR
rules. This local profile selects the documented Superpowers trial instead of
Ralph execution for this fresh task. Read docs/superpowers-trial.md for setup and
evaluation; do not read the Ralph runbook to start a native task.

Use the installed upstream Superpowers skills for development. OpenSpec owns
requirements, decisions and implementation tasks when a specification is needed.
Use an existing OpenSpec design/tasks artifact as the design/plan input to
Superpowers; do not maintain a second copy under docs/superpowers/.
Ordinary fixes retain AGENTS.md's specification policy.

Use the current Codex conversation and native subagent tools. Keep upstream
skills unmodified. Follow their task batching, scoped review and implementer
resumption practices. Trust the actual tool schema when upstream examples differ.
For the next trial, use Sol/high for the lead and subagents. The local config
records that allocation. Upstream model-selection examples do not override this
owner-selected experiment; record any owner-requested allocation change separately.
Do not start agent:goal, a Ralph process, an additional model supervisor or a
Stop-hook continuation loop. Use native Goals only when explicitly requested.

Work in one prepared task worktree, with sequential writers. Reuse this worktree
when it is already the selected task branch. Resolve a requested parent PR's
actual branch and ancestry before starting; sibling PRs are not implicitly included.
New task worktrees belong under the primary checkout's .agents/worktrees/.

An existing Ralph task must remain in its existing workflow. Before implementing
a fresh, owner-selected native task, record:
~~~
npm run agent:task -- interactive --reason owner-request --note "Owner selected the Superpowers/native Codex trial"
~~~
Read-only discussion needs no task record. This is an execution label, not a
launcher or evidence of autonomous completion.

Workers run focused checks for their changes; the lead owns complete acceptance.
Reuse recorded checks when the relevant source and command inputs are unchanged.
Follow the verification and handoff guidance in docs/superpowers-trial.md, then
publish through normal Git/GitHub tools when authorized. State that execution
used Superpowers and native Codex. Do not claim Ralph acceptance or use its
delivery gate for this trial. Stop at a ready PR; do not merge.
For design work, agree on concrete visual direction with the owner and inspect
the rendered result against that direction before presenting delivery.

Use native child completion events while continuing useful work. Reuse the
current threads for follow-up work when supported. A saved report is not a user
notification. Report recurring lack of progress with its cause and next action;
do not restart a task to conceal retries or increase its allowance.
Keep follow-ups to the changed facts; avoid re-reading full skills or reports
without a concrete gap. Record validation and run facts once. Use agent:usage
for native accounting, with incomplete turns labelled provisional.
