### Fixed

- Finish standalone installer upgrades by bringing Herdr, detected harness
  integrations and the installed World plugin up to date, then restarting the
  matching running World service on Linux and macOS. Report every step and explain
  skipped restarts; `HERDR_WORLD_SKIP_HERDR=1` still permits the World restart.
