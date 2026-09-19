---
name: openspec-apply-change
description: Implement an authorized OpenSpec change and track progress against its tasks.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Use the pinned CLI to read status and `instructions apply --change <name> --json`.
Read its context files, relevant source and tests. Complete authorized tasks, keeping
checkboxes accurate and updating the same plan when implementation reveals new facts.
Run the relevant repository checks and update affected knowledge. Stop for an actual missing
decision, permission or external dependency; routine failed checks are work to resolve.
Do not claim completion from checked tasks alone. Follow the selected workflow's
delivery procedure when publishing is authorized; no automatic merge.
