### Changed

- The crew watcher starts a PR's review round as soon as a new head is pushed, in parallel with CI; green checks still gate READY and `crew/merge-ready`. When a fix, ci or conflict step is due and the author seat is busy with another PR, it starts a fresh fixer on the author's roster model in the PR's own worktree, which pushes, replies signed `[fixer #N]` and hands the PR to the next round.
