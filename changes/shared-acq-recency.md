### Fixed

- Keep agent recency current through status transitions and retain the newest
  timestamp when a list reply races an activity update. Replaced agent sessions
  never inherit their predecessors' recency.
