---
name: world-openspec-archive-change
description: Archive a completed OpenSpec change after verifying implementation and synchronizing current specs.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Feature PRs write change-folder deltas and capability notes, not current spec.md files.
Synchronization and archive happen after merge through the single bot archive PR;
use this skill within that PR's scope. Never push main or merge automatically.

Read status, tasks and verification evidence. Do not archive unfinished tasks or
an implementation with unresolved failures. Run world-openspec-sync-specs and verify
its result before moving the change. Use the pinned `openspec archive` command
rather than manually choosing a directory; inspect its help for flags.
Archive within the authorized delivery scope; never treat archiving as permission
to merge a PR. Keep limitations in the PR or relevant runbook.
