### Changed

- Import the legacy ledger JSON only once, then move imported Board, ledger and
  agent-profile JSON, their backup copies and schema snapshots older than the
  newest three into the data folder's `legacy/` folder. Nothing is deleted.
