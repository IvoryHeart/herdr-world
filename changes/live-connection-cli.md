### Changed

- Apply connection CLI add, remove and set-default changes to running World
  without restarting it. Preserve concurrent Settings edits and other open
  connections, terminals and browser sessions; keep `--restart` optional.
