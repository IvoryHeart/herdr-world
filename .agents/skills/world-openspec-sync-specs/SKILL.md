---
name: world-openspec-sync-specs
description: Synchronize an implemented OpenSpec change's delta requirements into current capability specs.
license: MIT
metadata:
  upstream: Fission-AI/OpenSpec
  generatedBy: "1.12.0"
  adaptation: Herdr World authorization and delivery policy
---

Feature PRs write change-folder deltas and capability notes, not current spec.md files.
Synchronization and archive happen after merge through the single bot archive PR;
use this skill within that PR's scope. Never push main or merge automatically.

Read the change's status and specs instructions with the pinned CLI.
For each selected delta, merge ADDED, MODIFIED, REMOVED and RENAMED requirements
into the corresponding main spec. Preserve unrelated requirements and scenarios.
Main specs use Purpose and Requirements, without delta-operation headings.
Handle explicit retirement without leaving an empty Requirements section.
Validate all specs, then re-read to confirm each delta is represented.
Synchronization must finish before archive moves the source change directory.
