### Added

- Show agent panes as chats with questions, activity, recorded Claude commands,
  artifact links and image previews; optionally use Vim editing and choose a
  terminal submit key for each agent.
- Name default agent tabs from their bound sessions while preserving custom names.

### Fixed

- Preserve generated third-party dependency copyright emails during privacy
  checks, exempting only the root licence artifact's email rule. Keep all other
  privacy rules active and use a synthetic path in the pane-chat fixture.

- Let Ranger use workspaces it creates in the current chat and turn, and run fixed
  tasks over still-open original workspaces with restart and omission notices.
- Synchronize Roamgate through bf3879f93 while preserving World runtime ownership,
  memory-only drafts, mobile navigation, security fixes and dependency boundaries.

### Changed

- Upgrade the Diff viewer to Roamgate's Pierre diffs 1.6.1 with Shiki 4.6,
  preserving World's supported languages and light/dark appearances. Keep grammars
  lazy and shared with the worker; allow the remaining lazy backend/theme assets
  in the total web budget without increasing startup limits.
