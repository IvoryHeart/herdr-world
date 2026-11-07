### Added

- Show Codex subscription limits as fuel gauges on the Town board: each window
  (for example 5 h and week) with the percent left, amber and "low" under 15 %,
  and reset time, age and source on hover, focus or tap. The phone chip adds
  the lowest percent left. Claude reads "not available" on the board, and the
  Town summary lists each host's windows and says why Claude limits are not
  available. `world.usage.get` gains `limits`, read
  from Codex session logs on local and SSH hosts.
