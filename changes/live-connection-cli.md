### Changed

- Apply connection CLI additions, removals and default changes through the running
  service without restarting it or dropping other hosts' terminals and browser
  sessions. Concurrent Settings edits are retained; `--restart` remains optional
  on loopback and still saves and restarts a managed service bound to one other
  address. Unreachable services retain offline editing; persistence failures
  report service errors rather than usage errors.
