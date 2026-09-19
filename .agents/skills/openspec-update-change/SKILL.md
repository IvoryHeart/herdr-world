---
name: openspec-update-change
description: Revise an existing OpenSpec change and reconcile its planning artifacts when direction changes.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Read `npm run spec -- status --change <name> --json` and the affected artifact
instructions. Update existing artifacts coherently using returned concrete paths,
including relevant requirements, design and tasks. Preserve unrelated decisions.
Validate the result. This operation edits planning artifacts; when implementation
is already authorized, continue with openspec-apply-change afterward.
