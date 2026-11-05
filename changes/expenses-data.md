### Added

- Read bounded agent token usage from Claude Code, Codex, Pi and Gemini session
  files through qualified local and SSH connections, with shared World usage
  records, attribution, source health and optional local price-table estimates.
  Recovered counters and copied transcripts count once; incomplete or changing
  claims remain host-level, and cancelled or oversized reads release owned resources.
  Reuse bounded host-local parser caches for incremental reads. Old Codex trees
  use bounded metadata discovery for recent activity; incomplete identity evidence
  never establishes a unique title-prefix match. Verified file handles, retryable
  offsets and owned reader failures preserve containment and cache recovery.
