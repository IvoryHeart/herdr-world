## Why

A machine running both a Herdr TUI and herdr-core showed two buildings, and a
machine with many rooms became a tall tower. The first attempt (#1123) grouped
rooms by overwriting their host key, which is also identity, and broke room
actions; it was reverted (#1197). This change redoes it with display-only keys.

## What Changes

- One building per machine by default through a display-only building key;
  each room in a two-runtime building names its runtime. A browser-local
  **Town buildings** setting (one per machine, one per runtime) restores a
  building per runtime. Host keys, qualified references and actions stay on
  the owning connection and generation.
- Two Herdr TUI connections to one socket present its rooms once, through
  the writable connection.
- Buildings choose rooms per row to stay about square, with a browser-local
  **Rooms per row** setting (Auto, 2, 3, 4, 5). Rooms without a saved spot
  fill the rows around saved ones, so one saved spot never narrows a building.

## Capabilities

### Modified Capabilities

- `world-surfaces/town`: Town scene (machine buildings, shared endpoints)
  and Stable Town placement (rooms per row, saved spots).

## Impact

Town web code (`web/src/world/town/`), Town settings, and the owner-topology
browser suite `web/src/world/TownOwnerTopology.browser.test.ts`.
