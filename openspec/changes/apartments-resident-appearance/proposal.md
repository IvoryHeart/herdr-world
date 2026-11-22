## Why

Apartments keeps one read-only resident record for each finished agent. The
Apartments window showed residents as a plain list, unlike every other agent
surface. A resident should look like the agent it was in Town, and a resident
whose look World never kept should still show a sensible avatar.

## What Changes

- A resident record gains an optional `appearance`: the profile World
  launched the agent from, its Town character and its colour, read while the
  agent was live and kept at move-in. Records written before this change, or
  without a readable appearance, keep `null`; no migration.
- The colour is the one live views show: the table's own colour, else the
  colour a spawned table inherits from its parent's table, else the room's
  chosen or default colour.
- The Apartments list and the opened resident draw that avatar with the same
  sprite, harness icon and colour tile as live agents, for Herdr TUI and
  herdr-core residents alike.
- A missing or unreadable look falls back to the nearest avatar: the kept
  profile's current look, else a profile of the same harness, else World's
  default character. The window never shows a blank or broken avatar.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/apartments`: Apartments residents show their kept or nearest avatar.
- `world-storage`: resident records carry an optional, leniently read
  appearance.

## Impact

Server: `shared/apartments.ts`, `server/src/world/apartments.ts`,
`server/src/service/apartments-service.ts`, `shared/relations.ts`
(`withInheritedColors`, now shared by the browser and the service).
Browser: `web/src/world/apartments/`. Docs: FEATURES.md (Apartments).

Apartments itself (#1034) has no current capability spec yet, so this delta
stays active and is synchronized with the Apartments capability when that
lands, instead of being written into the current specs on its own.
