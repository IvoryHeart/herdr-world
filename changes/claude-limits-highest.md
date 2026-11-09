### Fixed

- Claude limits no longer jump backwards when several Claude sessions run:
  within one limit window World keeps the highest reading, and starts fresh
  when the window resets.
- Installer and update output says a harness integration was installed when it
  is new, updated when World changed it, and already current when nothing
  changed, instead of "updated" for every harness.
- The installed World skill now says World installs it automatically and how
  to remove it, instead of asking for an explicit install command.
