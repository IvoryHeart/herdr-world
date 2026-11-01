### Fixed

- Retry transient local Herdr connection failures with capped backoff so a runtime
  that starts after World can recover automatically. Explicit Reconnect remains
  available, and failed topology stays non-actionable until freshly observed.
