---
name: world-deliver-pr
description: Deliver an authorized Herdr World branch as a reviewed pull request with current validation evidence.
---

Follow AGENTS.md and the canonical
[delivery procedure](../../../docs/agent-development.md#delivery-and-evaluation).
Inspect `agent:task report`, the actual diff and current evidence before publishing.
Use the recorded parent branch for stacked work; preserve the execution report in the
PR body. A rejected delivery needs diagnosis, not a direct git/gh bypass.

Write the PR for a reviewer who has not seen the conversation: concrete problem,
resulting behavior, meaningful validation and remaining limitations. Review for private
data. The helper never commits for you. For an existing PR, confirm the task report and
current verification before pushing its update and refreshing the execution report.

Add the PR reference to relevant changelog entries after opening, then revalidate that
attribution-only update. Any product correction returns through the run. Stop at the
ready PR; merging needs the owner's direction.
