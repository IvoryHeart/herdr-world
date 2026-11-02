### Added

- Read bounded agent token usage from Claude Code, Codex, Pi and Gemini session
  files through qualified local and SSH connections, with shared World usage
  records, attribution, source health and optional local price-table estimates.
  Recovered counters and copied transcripts count once; incomplete or changing
  claims remain host-level, and cancelled or oversized reads release owned resources.
  Older Codex metadata still participates in title-prefix ambiguity checks after
  its token rows expire.
