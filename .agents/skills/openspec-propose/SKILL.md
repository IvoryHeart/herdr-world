---
name: openspec-propose
description: Propose a new Herdr World contract change with OpenSpec artifacts when requested or a new contract needs a decision.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Use world-plan-change to inspect source, tests and existing specs first.
Use the pinned CLI via `npm run spec -- <arguments>`.
Create the change with `new change <name>`; inspect `status --change <name> --json`
and `instructions <artifact> --change <name> --json`. Use returned paths and
dependencies to write the required artifacts; do not infer completeness from file
existence alone. Validate with `validate <name> --strict --no-interactive`.
Keep unresolved decisions explicit. If only planning was requested, present the
artifacts and stop. If implementation was already authorized, continue through
openspec-apply-change without requiring another permission exchange.
