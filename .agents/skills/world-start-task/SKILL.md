---
name: world-start-task
description: Start Herdr World development from a short goal, handling repository research, consequential interview questions, a task worktree, the bounded Ralph loop and authorized PR delivery.
---

Treat a short development goal as the task; do not demand a prepared specification or
make the owner select roles. Read AGENTS.md and docs/agent-development.md. Check the
existing task/run before starting another one. Reuse the current conversation for
coordination; do not spawn a research committee.

After the one-time agent:bootstrap and agent:image setup, start with:

```bash
npm run agent:goal -- "<owner's goal>"
# For a requested stacked change:
npm run agent:goal -- "<owner's goal>" --parent 78
```

The command creates a fresh worktree, inspects source in the lead session and either
continues into Ralph or saves intake questions. Relay those questions to the owner;
never supply their answers yourself. Save the reply in an ignored task-local file and
use agent:run resume RUN_ID --task-file <answers.md>. Human waiting uses no model
process or loop budget. Preserve the original constraints and existing authorization.

For an already prepared task use agent:run start --task-file <file>. Harness/control
changes use interactive implementation with evals, since the loop cannot modify its
own controls. Do not repeatedly launch workers against that deliberate boundary.

Read status and evidence. A blocked, exhausted or failed run is not a completed task.
For ready-for-review, inspect candidate.patch, apply it to the recorded task worktree,
run current required checks there and use world-deliver-pr for authorized delivery.
Use the recorded delivery.base for a stacked PR. Stop at the open PR; never merge.
