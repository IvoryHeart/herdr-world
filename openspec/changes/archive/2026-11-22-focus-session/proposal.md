## Why

Every question and finish can chime or notify the moment it happens, which
breaks deep work. A focus session holds those interruptions for a chosen time
while the crew keeps working, then gives one chime and one recap (#1131).

## What Changes

- The service owns one World-wide focus state (`world.focus.get`,
  `world.focus.start`, `world.focus.end`), persisted and published as
  `world_focus_changed`, so every device holds the same session and it
  survives page reloads and service restarts.
- While focused, chimes, browser notifications, Web Push and the tab-title and
  app-badge count hold on every device; Town, marks and Needs you keep showing
  everything. Agents see nothing different.
- Start from the Town center ring, the Town status board, the Menu and the
  command box; the status chip shows a focus mark and the time left, with
  **End now**.
- A timed session expires on its own; each open device then plays the for-you
  motif once and shows "While you focused", read by the Since you left model
  over the session's window.

## Capabilities

### Modified Capabilities

- `world-surfaces/notifications`: focus sessions hold interruptions; the tab
  and app badge show no count during a session.

## Impact

Server: `shared/focus.ts`, `server/src/world/focus.ts`,
`server/src/rpc/world.ts`, `server/src/notifications/web-push.ts`.
Browser: `web/src/world/focus.ts`, `web/src/world/FocusControls.tsx`,
`web/src/world/town/TownFocus.tsx`, `web/src/chimes/chimeCenter.ts`,
`web/src/store/notifications.ts`. Usage: `world-surfaces/town` notes.
