### Changed

- Local development uses less disk.
  - Behavioral verification's checker is downloaded once per user and shared by
    every worktree, and each worktree keeps only its newest verification runs.
  - Test runs, including a direct `bun test`, remove their temporary and test
    Chrome directories (and any Chrome still using them) however they end.
  - `bun run agent:worktree -- prune` removes merged, clean agent worktrees, or
    only their build output while an agent still works in them.
  - Heavy checks refuse to start below 3 GB of free space.
