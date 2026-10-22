### Changed

- Local checks from parallel worktrees share one machine-wide queue: one World
  browser lane and one behavioral verification at a time, at most two static or
  unit lanes, with a "waiting for" message naming the holder. A pre-push that only
  merges `origin/main` runs static checks only (`bun run check:static`); CI stays
  the full gate.
