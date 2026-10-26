### Fixed

- Let `agent:worktree -- prune` remove eligible worktrees when unrelated processes
  use the filesystem root or ancestor directories, while retaining worktrees when
  process inspection is unavailable.
