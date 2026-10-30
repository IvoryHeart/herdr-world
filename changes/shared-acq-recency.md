### Fixed

- Keep agent recency current through status transitions and retain the newest
  timestamp when a list reply races an activity update. Replaced agent sessions
  never inherit their predecessors' recency.
- Preserve the same agent session's recency across a World service restart, and
  ignore pushed activity when the service disables shared acquisition.
