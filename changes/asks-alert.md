### Added

- `herdr-world ask` also alerts you through the asking pane's Herdr, so a
  question reaches Herdr's toasts, every connected World and phone
  notifications even with no World tab open. An ask nobody was alerted to
  exits 6 (`not_delivered`) with its recorded ID, and one World could not
  record still sends the alert, names the failure and exits 1.
- `HERDR_WORLD_DATA_DIR` gives a World instance its own data folder.

### Changed

- One running World owns its data folder: a second World on the same folder
  stops with a message naming the running one, instead of overwriting its
  files.
- The session signing key is always `session-secret.json` in the data folder.
  A World started with a custom `HERDR_WORLD_SETTINGS_PATH` creates a new key
  once, so its browsers log in again after the upgrade.

### Fixed

- A test run no longer rewrites the installed World's signing key, which made
  the agent CLI's token stop working and could log browsers out.
