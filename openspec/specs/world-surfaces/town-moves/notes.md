# Town Moves notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town moves desks by mouse drag or touch hold-and-drag; M on a focused target opens destinations.
- A desk can reorder within its room or move rooms; an agent can join another desk.
- Board cross-workspace moves and CLI town desk/group membership moves share service orchestration.
- TUI exports/replays split trees; core uses placement operations in herdr-core-runtime.

**Code:**

- `web/src/world/town/TownCanvas.tsx`
- `web/src/world/TownView.tsx`
- `web/src/world/officeRoomActions.test.ts`
- `web/src/world/town/townMoveActions.tsx`
- `web/src/world/town/townMoveMenu.ts`
- `web/src/components/PaneMoveMenu.tsx`
- `server/src/world/town-move.ts`
- `server/src/herdr-core/town-move.ts`
- `server/src/cli/world-groups.ts`

**Tests:**

- `web/src/world/town/townMoves.test.ts`
- `server/src/world/town-move.test.ts`
- `server/src/herdr-core/town-moves.test.ts`
- `server/src/cli/world-groups.test.ts`

**Pitfalls:**

- Do not infer all move entry points from scene buttons: Town has drag and M controls.
- Also inspect Spaces pane handles/tab menus and Inspector split-pane controls (the #990 trap).
- The service queue is per connection; captured generations cannot fall back.
- Replacement pane IDs must flow through every later step and compensation.
- Last-room confirmation and unknown outcomes cannot be bypassed or automatically retried.

## Usage reference

  - Drag a table onto another room of the same host, or an agent onto another
    table, to move it (hold, then drag on phones; **M** on a focused table or
    agent from the keyboard). Tables lift from the room-summary zoom in, even
    under a room summary, whose tap still zooms in; agents lift once zoomed
    into a room. A carried table lifts and sways after the
    pointer, lands with a bounce and a puff of dust, and shakes and springs
    back when a move is refused; calm and reduced motion keep it under the
    pointer and end with a short fade. The live panes move, agents keep running, a failed
    move attempts rollback and reports partial or unknown results. Moving a
    room's last table asks first because the room closes. When a table closes, the tables after it close up.
  - Tables sit in Herdr's tab order, left to right and row by row, so moving a
    tab in Spaces or Herdr moves its table. Drag a table onto another table in
    its room to put it in that place, or onto the room's free spot to put it
    last of the tables shown (**M** lists the same places). Rooms extend as
    tabs open: wide screens show three columns of rooms up to eight tables
    wide, portrait and half-width screens two columns up to six, and phones
    three columns up to four, growing downward, so a phone opens on compact
    room cards spread across each building rather than one long column. A folded room normally shows up to
    24 tables: pinned desks first, then the first tabs in the same order as
    Spaces, without promoting later working or recent tabs into that prefix. The bottom-right
    **» +N** tile sits beside the dashed **+** seat and counts hidden tables.
    Each click appends the next 20 tables until all are shown; **Fold** is
    available after the first expansion and returns to the first 24 in one click.
    A red **!** in the tile's top-left marks hidden desks that need you; a green
    **✓** in its top-right marks hidden unreviewed completions. These icons clear
    as desks are revealed or their attention is resolved. Plaques count all
    agents, including hidden desks. A growing room moves
    only the rooms below it, and never
    while you hold the town. Town asks Herdr to move the tab and
    shows the new order when Herdr reports it; agents stay with their table.
