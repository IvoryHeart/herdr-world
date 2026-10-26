### Fixed

- Let `agent:worktree -- prune` remove eligible worktrees when unrelated processes
  use the filesystem root, ancestor directories or similarly prefixed sibling
  paths, while retaining worktrees referenced by Docker mounts or shell commands
  and when process inspection is unavailable.
