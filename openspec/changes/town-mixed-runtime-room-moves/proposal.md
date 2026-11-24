## Why

Tidy rooms refuses a mixed machine building when its first room is a herdr-core
app space. Room placement incorrectly depends on rename permission.

## What Changes

- Share room movement authority across drag, neighbour moves, Tidy and Undo.
- Move live core rooms through World layout only; reorder live TUI workspaces.
- Keep unavailable rooms in place and name skipped rooms with their reasons.

## Capabilities

### Modified Capabilities

- `world-surfaces/town`: durable room placement with per-room movement authority.

## Impact

Town room actions, collision placement and focused regression tests. Existing
room_pins storage and connection/generation qualification remain unchanged.
The owner authorized this fix in issue #1249; parked #1184 is no dependency.
