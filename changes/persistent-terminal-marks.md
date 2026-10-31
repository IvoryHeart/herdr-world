### Changed

- Keep Desk review marks and recent opens, watchlist pins and checked completions
  across World restarts. Every browser shares committed state; saved records
  reappear only after World verifies the same terminal and, where known, session.

### Fixed

- Preserve other hosts' disconnected state and notice revisions while marks commit.
- Refuse pending Desk/completion commands across observed session replacement,
  including unknown identities, and let exact Unpin remove unavailable saved
  watches without deleting a newer replacement.
