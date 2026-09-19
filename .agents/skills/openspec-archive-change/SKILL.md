---
name: openspec-archive-change
description: Archive a completed OpenSpec change after verifying implementation and synchronizing current specs.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Read status, tasks and verification evidence. Do not archive unfinished tasks or
an implementation with unresolved failures. Run openspec-sync-specs and verify
its result before moving the change. Use the pinned `openspec archive` command
rather than manually choosing a directory; inspect its help for flags.
Archive within the authorized delivery scope; never treat archiving as permission
to merge a PR. Keep limitations in the PR or relevant runbook.
