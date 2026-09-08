---
name: world-integrate-work
description: Assemble authorized dependent Herdr World changes from multiple worktrees into one verified delivery branch.
---

Identify the coherent outcome, input branches/commits, dependencies and current contracts.
Use a dedicated non-main worktree under the primary .agents/worktrees directory. Preserve
other workers' dirty trees. Integrate only the authorized changes; resolve conflicts against
the intended behavior, including semantic conflicts where Git reports a clean application.

Run the relevant combined checks on the assembled source and obtain fresh review for that
candidate. Individual branch receipts do not establish the combined result. Keep one current
OpenSpec change for the outcome. Deliver through a PR and stop there under AGENTS.md.
This skill supports explicitly coordinated work; the bounded Ralph runner currently executes
one candidate at a time and does not start a parallel backlog scheduler.
