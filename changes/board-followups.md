### Added

- Board's Next control opens the next pane that needs you, including shared
  shell questions, and keeps its place after an answer. Its menu now offers
  Whiteboard and Blackboard surfaces, separate status colours and Help.
- Drag a pane row or a single-pane tab's grip onto another tab on the same host
  to move just that pane, including with touch hold; cancelling sends no move,
  and closing the old room requires confirmation.

### Fixed

- Batch dense rooms' overview squares to keep terminal input responsive at
  maximum scale, preserving each pane's status and the status-pulse controls.
- Keep animated Town input responsive in dense snapshots by skipping empty
  question lookups and yielding automatic Town-master name searches between batches.
- Keep the Inspector pane map open when a delayed terminal-focus handoff runs
  after keyboard opening.
