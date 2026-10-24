### Fixed

- Mark failed-host Town buildings, receptions, agents and Board cards stale,
  keep live actions disabled, and offer an explicit Reconnect control.
- Continue automatic recovery from transient SSH tunnel failures with capped
  backoff instead of leaving a reachable host permanently failed after six tries.
