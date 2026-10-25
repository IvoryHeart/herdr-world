### Fixed

- Keep Inspectors, terminal output, split layouts and unsent Message drafts through
  mobile backgrounding and browser network interruptions. Reconnect to the same
  runtime without replaying input; terminal recovery now offers local retry and
  explicit app reload instead of automatically reloading the page.

- Keep cached Files and Changes content while the same worktree is being
  readmitted after reconnect, and preserve other Inspectors' Message drafts
  until a fresh catalogue confirms their runtime was replaced or removed.
  Keep the stale Inspector notice above the phone Message editor so retained
  drafts remain visible.
