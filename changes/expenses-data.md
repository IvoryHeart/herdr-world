### Added

- Read bounded agent token usage from Claude Code, Codex, Pi and Gemini session
  files through qualified local and SSH connections, with shared World usage
  records, attribution, source health and optional local price-table estimates.
  Recovered counters and copied transcripts count once; incomplete or changing
  claims remain host-level, and cancelled or oversized reads release owned resources.
  Reuse bounded host-local parser caches for incremental reads. Old Codex trees
  may be pruned from numeric discovery; incomplete identity evidence never
  establishes a unique title-prefix match.
