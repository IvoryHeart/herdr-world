### Changed

- Tap a Town table to open its default pane, including on a phone; only a crowded table with nothing focused asks you to choose.
- Town's board folds into a compact status chip with the attention count; hover or tap it to open the board as a popover.
- New room offers the host's recent folders, defaults to the most recent one (else home), browses subfolders and completes a typed path with Tab.

<!-- detail -->

- Tapping a Town table opens its default pane: its one pane, else the focused
  one, else an agent that needs you, else the most recently active one. Only a
  crowded table with nothing focused still asks which pane. On a phone one tap
  opens it; the table's card comes first only when there is nothing to open.

### Fixed

- Tapping a live herdr-core table or pane opens its terminal or Chat instead of showing "World can't mark core work reviewed yet".
- herdr-core rooms can be created in a chosen folder, a Windows host's drive or UNC folder too; their terminals start there.
