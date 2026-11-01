### Fixed

- Keep large Worlds responsive: a refresh no longer rebuilds the focused host's
  World in the shell's render. Host filters reuse the World's index, Town
  indexes each room's tabs once and yields inside large rooms, and terminal
  colours are derived again only when the Board or the hosts change.
