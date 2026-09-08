---
name: openspec-explore
description: Investigate a Herdr World design or OpenSpec change before deciding its implementation.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Read source, tests and relevant current specs. Explain findings, options and the
decisions that actually need the owner. A discussion alone does not authorize
implementation. When the user has authorized saving artifacts, create a change
through the pinned CLI and write the requested artifacts within that scope.
If the user authorizes implementation, use the selected development workflow and apply;
do not require them to invoke another command solely to leave exploration.
