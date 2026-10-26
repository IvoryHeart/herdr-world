### Fixed

- Let `agent:worktree -- prune` remove eligible worktrees when unrelated processes
  use the filesystem root, ancestor directories or similarly prefixed sibling
  paths, while retaining worktrees when process inspection is unavailable.
