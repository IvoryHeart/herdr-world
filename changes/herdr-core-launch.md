### Added

- Start agents and plain shells in herdr-core from World. When a host has a
  connected core, New agent starts there by default and says so: Herdr's
  apps show the agent in their space, with World's room and tab names, and
  keep it running. Plain shells start unplaced. A Herdr (TUI) room stays a
  per-launch choice.
- Add, rename and close World's rooms of a core. Rooms live in World's
  database; the desktop app's own spaces stay the app's.
- Put core agents in the bin. Before the bin, a room close or any other kill
  ends a core terminal, World names every sub-agent that core will end with
  it and ends nothing more it has seen. A sub-agent started since, or a
  program replaced meanwhile, stops the kill and shows the new list. One
  started while core carries out the kill can still end with it, since core
  has no conditional kill; World then names it.
- `herdr-world task-summary` and `herdr-world stamp` work inside core
  terminals, with no World service needed.

### Changed

- Core agents are no longer view only: only Open terminal, Chat, answers and
  Mark reviewed stay disabled, with "World can't open herdr-core terminals or
  chat with them yet".
