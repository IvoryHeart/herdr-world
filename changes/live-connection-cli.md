### Changed

- Apply connection CLI add, remove and set-default changes to running World
  without restarting it. Preserve concurrent Settings edits and other open
  connections, terminals and browser sessions; keep `--restart` optional.
  Live edits need a loopback or wildcard listener. For a specific non-loopback
  listener, `--restart` still saves the change and restarts the managed service;
  omitting it refuses the edit without changing saved profiles.
