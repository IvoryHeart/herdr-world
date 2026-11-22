## Why

Issue #1130: in Town, a working agent whose session has stopped moving looks as
busy as one getting on with its work, so a hung agent goes unnoticed until
someone opens its terminal.

## What Changes

- Mark an agent quiet when it is working and its last activity time is at least
  a threshold old (10 minutes by default; a Settings entry offers Off, 5, 10, 20,
  30 or 60 minutes). No activity time means no mark.
- The agent stays seated with its room's working light on, stops typing and shows
  a static hourglass with how long it has been quiet; its card says
  "No progress for 23 m (last 14:02)".
- The Town board counts quiet agents under Busy; the line opens the first one and
  Next steps through the rest.
- `?scene=town-scale` gives some working agents activity times 15–40 minutes old.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `world-surfaces/town`: adds "Quiet working agents are marked, not acted on".

## Impact

Browser only: Town rendering, board, card, step bubble, Settings registry entry
and Town preferences. No new runtime calls, nudges, interruptions, restarts,
chimes or notifications.
