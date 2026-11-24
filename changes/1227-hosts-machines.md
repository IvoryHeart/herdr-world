### Changed

- The Hosts filter lists each machine once, summarises its runtimes' status and hides all of them together; saved selections follow their machine.

<!-- detail -->

- The Hosts filter lists one row per machine instead of one per runtime: a
  computer running both Herdr TUI and herdr-core appears once, its status
  summarises both (for example "1 of 2 reconnecting"), and unchecking it hides
  both runtimes' rooms, even when it is the only machine (the menu then
  reads No hosts). Saved selections map to their machine.
