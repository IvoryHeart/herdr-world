---
name: world-start-task
description: Start a Herdr World feature from a short goal through the recorded Ralph harness, including research, interview, task worktree, independent review and PR delivery. Use before researching or implementing the feature; control maintenance and read-only analysis are separate.
---

Treat a short development goal as the task; do not demand a prepared specification or
make the owner select roles. Read AGENTS.md and docs/agent-development.md. Check the
existing task/run before starting another one. Reuse the current conversation for
coordination; do not spawn a research committee. The coordinating agent must launch the
entrypoint before feature research, design discussion or edits. Reading this skill and
using OpenSpec/test commands is not a substitute. A supervisor-assigned worker is already
inside the loop and must follow its phase instead of invoking this entrypoint again.

After the one-time agent:bootstrap and agent:image setup, start with:

```bash
npm run agent:goal -- "<owner's goal>" --background
# For a requested stacked change:
npm run agent:goal -- "<owner's goal>" --parent 78 --background
```

Substitute the requested parent PR number; do not hard-code 78. Do not first create a
manual worktree and implement there. Report execution mode Ralph, the printed worktree
and job ID; obtain the run ID from agent:job wait/status or agent:task status in that worktree.

The command creates a fresh worktree, inspects source in the lead session and either
continues into Ralph or saves intake questions. Relay those questions to the owner;
never supply their answers yourself. Save the reply in an ignored task-local file and
use agent:run resume RUN_ID --task-file <answers.md> --background. Human waiting uses no model
process or loop budget. Preserve the original constraints and existing authorization.

Default to the persistent pair workflow: lead for intake/guidance/acceptance, A and B
for sequential implementation/review in one worktree, and conditional Oracle advice.
Do not redo the inner lead's work or relay routine pair handoffs. Native context is
retained independently; focused deltas do not mean free/shared model context.
The background job owns supervision. Prefer host completion events. Never repeatedly
spend model turns polling a healthy job, including 30/60-second write_stdin waits.
If the host has no wake-up integration, report the running job once and return; it
continues independently. Reopen status for a real completion, question or failure.
Do not claim an unattended host callback exists merely because the job runs in background.

If the owner attaches a reference image, save the supplied image to a private local file and
pass --reference-image <absolute-path> to agent:goal. PNG/JPEG/WebP are copied into the frozen
control directory and attached to model phases. For a later interview image, add the flag to
agent:run resume together with --task-file <owner-answer>. Do not commit the reference merely
to transport it; if the host cannot expose the attachment as a file, state that limitation.

For an already prepared task use agent:run start --task-file <file>. Harness/control
changes use interactive implementation with evals, since the loop cannot modify its
own controls. Do not repeatedly launch workers against that deliberate boundary.
Before control edits record agent:task interactive --reason harness-maintenance --note "<task>".
An ordinary feature can use interactive mode only when the owner explicitly requests it.

Read status and evidence. A blocked, exhausted or failed run is not a completed task.
Never silently complete a failed/exhausted harness task yourself or relabel it a successful trial.
For ready-for-review in pair mode, the task worktree already contains the edits. Inspect
the current delta and saved evidence; do not reapply candidate.patch or repeat passing
whole suites. agent:task report and agent:deliver check exact source, different native
histories for the latest proposal/review, and independent lead acceptance. Commit the
verified contents and use the recorded delivery.base for a stacked PR.

For changed harness controls, incorporate the updated branch into the existing task
branch and use agent:run recover OLD_RUN_ID --prepare-only, inspect, then resume the
new ID. Legacy pending patches and native histories are imported explicitly. Old run
evidence remains intact; remaining time/activations carry forward unless an extension
is explicitly authorized. Never restart research or create a new task merely to reset limits.
Optional early drafts remain incomplete; final delivery gates still apply. Stop at the
ready PR and never merge.
