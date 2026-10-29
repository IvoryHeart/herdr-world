### Added

- Edit the native tab name, shared colour and status, and individual pane avatars
  from terminal title bars on desktop and phone. Board, Town, Desk and Spaces
  show the same choices, with field-specific resets and visible save failures.

### Fixed

- Keep bound appearance from attaching to a reused Herdr tab or pane ID, and
  preserve choices through confirmed moves without changing runtime status colours.
- Keep the latest explicit colour or reset through lost move acknowledgements,
  whether edited before or after native close cleanup; bind profile colours to newly launched terminals on reused IDs.
- Reclaim closed terminals' appearance settings from complete current evidence,
  and discard unsaved phone drafts when their pane moves into a different tab.
- Retry closed-tab colour and pin cleanup after concurrent Board edits, without
  removing a replacement tab's settings.
- Keep an unverified question unplaced when any candidate local Herdr cannot
  confirm whether it owns the claimed pane.
