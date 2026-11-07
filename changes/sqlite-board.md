### Changed

- Store Board notes, strings, appearance, layout, interest and relations in the
  instance database, importing existing Board JSON once with a private exact-byte
  backup. Existing Board, Town, Spaces and CLI behavior stays the same.

### Fixed

- Bound retained payloads while Board edits wait for earlier commits, preserving
  small metadata updates from dense World observations.
