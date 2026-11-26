# Board notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Board or /board; host zones, workspace/tab cards and pane rows open qualified Inspectors.
- Work pill, Next, view menu, note handles and drawing palette expose distinct actions.
- Phone Board retains cards, notes, strings, fit/zoom and overflow; drawings are read-only there.
- TUI/core share the Board document; core pin labels and native moves retain their own authority.

**Code:**

- `web/src/world/board/`
- `web/src/world/board/boardAttention.ts`
- `web/src/world/BoardView.tsx`
- `web/src/world/board/BoardSketch.tsx`
- `web/src/world/board/boardModel.ts`
- `web/src/world/board/boardPlacement.ts`
- `web/src/world/useHostGroups.ts`
- `server/src/world/board-groups.ts`
- `server/src/storage/board-port.ts`
- `server/src/cli/world.ts`

**Tests:**

- `web/src/world/BoardView.test.ts`
- `web/src/world/board/boardModel.test.ts`
- `web/src/world/board/boardZones.test.ts`
- `web/src/world/board/boardSketchGeometry.test.ts`
- `server/src/service/board-storage.test.ts`

**Pitfalls:**

- Canvas position is not native workspace ancestry or identity.
- Strings require witnessed terminals; matching names or reused IDs are insufficient.
- Sending a note requires explicit recipient checks; drawing never sends to agents.
- Notes/drawings use conflict checks; layout last-writer behavior is not a note merge policy.
- CLI board card commands arrange cards; native moves share town-moves.

## Usage reference

- **Board** (`/board`) shows hosts as zones, workspaces as cards and tabs as
  cards around their workspace, beside your notes. Cards are elastic while you
  move them (on phones, hold a card still before dragging it; a quick swipe
  pans the board, as in Town) and settle within a second; workspaces fold into a count and open
  into free space; Tidy (with Undo) rearranges a workspace or the board and
  carries strung notes along. Zoomed out, workspaces show a square per pane.
  - **Zones follow Group runtimes** (Settings → This World). With **One per
    machine**, this computer's Herdr TUI and herdr-core share one zone that
    names the machine once, with a row per runtime (colour, counts, its own
    **+** or recovery banner); dragging the zone label moves both runtimes.
    Each runtime keeps its own cards, saved positions and operations
    (`groupBoardZones` / `zoneHostKeys` in `boardModel.ts`), so switching the
    setting moves no card; a runtime that joins later is placed under its
    machine's cards (`boardPlacement.ts`).
  - **Town's facts on Board.** Board reads the same read models as Town, so
    each number matches Town's for the same thing. The chip at the top left
    counts **Busy**, **Waiting** (including open questions), **Done** (finished
    and not yet reviewed) and **Quiet** agents across all hosts; tap it for the
    **Board summary**: those counts with the number of agents and hosts,
    expenses today and over 7 days (UTC, estimated from harness logs, with
    what the totals leave out), each harness's limits with the reading's age,
    the finished work not yet reviewed (each with its room, host and last
    activity; tap one to show it on the board) and each host's counts,
    expenses and limits. Escape or the chip closes it. Each host zone's label
    is a heading with the host's name and agent counts, then short lines
    under it: expenses today and over 7 days, and each harness's limits on
    its own line; each workspace card shows its usage today and over 7 days, as Town's room
    card does. A single agent's tab card ends its line with what the agent is
    doing now, and a pane row shows it as its state: the running step and its
    time (amber once it has run long, as Town's thought bubbles), **Not
    reviewed** or **Reviewed** for a finish, or **Idle** and how long. Board
    reads steps only for working agents on tab cards it draws; nothing moves.
    Town and Board share one record of finishes, so an agent that finished
    while Town was open is still a finish when you switch to Board, and the
    other way round.
  - **Board's hub** stands beside the bin at the bottom centre and offers the
    town center's actions as compact buttons: **+** opens World's launcher
    (preselecting the selected card's workspace when it can start one there,
    and the new agent's card appears on Board), the crown opens the **Town
    master**'s Chat (found as the town center finds it) and **⋯** lists
    **New agent**, **Town master**, **Needs you**, **Summary** (which takes
    you to Town with the Town summary open), **Profiles**, **Past sessions**
    (Town's Apartments, with how many finished agents), **Memory** (Town's
    Library, on the selected agent or workspace) and **New workspace**
    (disabled with the reason when no host is ready) in a plain menu. Names
    follow the view: Town's building names stay in Town, and the dialogs
    keep their own titles. Arrow keys, Home and End move through the menu; Escape, a press
    outside or **Back** on a phone closes it. Board's controls leave the hub
    and bin room on their row, folding into Board's **⋯** menu as needed.
    The bin itself works as before.
  - **Lenses**, **Since you left** and pull request badges work on Board as
    in Town, from the same facts. **Lenses** in Board's controls (in its
    **⋯** menu when the row is short of room, as on a phone) or `L`
    (`Shift+L` back) opens Town's legend at Board's top left: each workspace
    card takes its room's reading, each tab card its desk's and each agent's
    pane row its agent's, on a tag along the card's top edge and in its
    outline; cards with nothing to show step back. Hover, focus or tap a
    card to read it in the legend; Escape or **✕** leaves the lens, and the
    browser remembers the last lens for Town and Board alike. After a return
    of 30 minutes or more, the same **Since you left** recap as Town's board
    sign stands at Board's top left. A tab whose agent has a linked pull
    request or ticket shows Town's desk badge (`#123 ✓`, `#123 ✗`, `#123 ●`
    or `ABC-12`) beside its name; for one of your open pull requests, tap it
    for the pull request card. With `?scene=town-scale` the lenses and badges
    have synthetic data, and `?awaySince=120` pretends you left two hours ago.
  - **Next** cycles waiting agents and shared questions placed on their panes,
    including shell questions, while skipping stale hosts and shells without
    questions. It stays reachable in the Board menu when the controls need more space.
  - The Board **⋯** menu offers **Surface** (Follow theme, Whiteboard or
    Blackboard), **Status colours…** and **Help** (Board's help entries, each
    with **Try**). Surface and status choices
    persist in this browser and stay separate from shared card colours;
    **Reset status colours** restores the chosen surface's defaults.
    Following a dark theme, Board takes Town's night: its ground, its agent
    state colours (blue working, amber waiting on you, green done) and its
    sign lettering on host and workspace names, and a workspace waiting on
    you glows amber as Town's reception does. A light theme or Whiteboard
    shows the whiteboard; Blackboard keeps its green chalk palette.
  - Drag a pane row or the grip on a single-pane tab onto another tab on the
    same host to move only that pane, or hold the row or grip first on a phone.
    The move keeps its terminal running and its strings attached; cancelling sends nothing. Moving the
    old room's last pane asks before closing that room.
  - Tapping or double-clicking a tab or pane row opens an agent on Chat (as in
    Town, by **Agents open**), and a plain shell, or an agent without Chat, on
    its terminal. Without a conversation yet, an agent starts on Terminal and
    switches to Chat when its session arrives unless you choose another view.
  - **Pin** in a selected card's bar puts the card first: a workspace's
    pinned tab cards sit directly above it, in tab order, in rows of up to
    three, on one tinted band, and follow it when it moves. Tidy and
    placement keep them there and clear other cards off the band; a pinned
    card dragged away glides back. **Unpin** returns the card to free space
    beside its workspace. A pinned workspace card keeps its place on the
    board. Bands hide in the zoomed-out overview. On a phone, where the
    card's terminal covers Board, the pin in the terminal's header pins its
    card. Pins are saved with the board on the World service.
  - Tabs list each pane as a row; plain-shell tabs look like terminals; only a
    working agent's tab (or the selected one) pulses (a ⋯ setting).
  - An agent with a quest shows a ⚑ chip with its progress (such as 2/5, or
    Loop ×3); hover it for the quest and the current step.
  - **+** on a workspace opens New tab (Terminal, one of your agent profiles,
    or any agent kind the host's Herdr supports, an optional name, then
    Create; a note's Start an agent uses the same dialog, and **Edit profiles**
    opens the profile editor); **+** on a host creates a workspace. Workspace cards count their
    agents by status; tabs show their terminal colour and workspaces take a
    colour the user picks, while status keeps its own colours.
  - Notes and strings are saved by the World service and shared across your
    devices. Strings attach to an exact pane, tab or workspace; a note strung to
    a pane is sent to its agent only when you press Send. When you make the
    string, World records the agent you saw in the pane, once it confirms that
    agent (by its Herdr session) is still there; otherwise the first Send asks. Send checks the runtime, the witnessed
    pane and terminal, and that agent. If another agent now holds the pane,
    even in the same terminal, nothing is sent: World names the new agent and
    sends to it only if you choose **Send to** it. World also asks again if
    Herdr stops reporting a previously captured session, even when the pane
    and terminal stay the same, without claiming a known replacement. An
    explicit **Send to** choice selects the recipient for that attempt; it
    cannot fall back to the original agent if that agent returns.
    Recipient checks cannot reserve the agent
    across the prompt submission: a change detected afterwards is reported as
    possibly delivered to another agent. Check the pane before sending again.
    A note offers **Start an agent** in a chosen workspace: World starts the
    agent in a new tab and sends the note once it is ready.
  - Drawing (desktop): the tools on Board's left edge draw beside the live
    cards, on the same pan and zoom, beneath cards and strings. **Pen** draws
    freehand (it stays chosen; Escape puts it down); **Rectangle**,
    **Ellipse** and **Diamond** drag out a shape or, with a click, draw one at
    a standard size; **Text** places text where you click; **Arrow** drags
    from one place to another, and an end dropped on a card, a note or a
    drawing attaches to it and follows it as it moves; **Note** places a
    note. With **Select**, click a drawing to select it, drag it to move it
    (a moved arrow lets go of what it was attached to), drag a corner to
    resize it or an arrow's end to re-attach it, and double-click a shape or text
    to type its label. The colour dots and **Fill** change the selected
    drawing, or the next one. Delete or Backspace (or the bin button) deletes
    the selection; an arrow attached to it stays where it pointed. Undo
    (Ctrl/⌘+Z) and redo (Ctrl/⌘+Shift+Z or Ctrl+Y) cover drawings made on this
    device since Board opened; a drawing changed elsewhere since is left
    alone, with a notice. A move, resize or text edit of a drawing someone
    changed elsewhere meanwhile is refused with the same notice and their
    version stays; typed text reopens on their version. If you have already
    started another text edit, it stays open and the refused drafts reopen in
    turn when you finish it, so nothing typed is lost. Drawings are saved with
    the board on the World service (at most 1,000; a stroke keeps at most 2,000 points, simplified
    as it is drawn) and are visual only: an arrow never sends anything to an
    agent. Issues and pull requests are reached through their agent's tab
    card. A phone shows drawings but has no drawing tools; drawings there
    take no touches, and double-tapping empty board still makes a note.
  - Town's room and agent actions are in a selected card's bar too: a
    workspace offers **Rename…** and **Close…** with Town's dialogs and
    confirmation; workspaces and tabs offer **Herdr order ‹ Earlier / Later
    ›**, which moves the room or tab in Herdr's own order (Town's buildings
    and desks and Spaces follow; Town's saved room spots swap with it), while
    dragging and Tidy arrange only the Board. Resting the mouse on an agent's
    tab or pane row opens a peek like Town's (latest Chat message, its
    question and answer buttons, **Mark reviewed**, **Open**); on a phone,
    **Preview** in the tab's bar opens it, and a finished agent's bar offers
    **Mark reviewed** (done, or idle after a turn World saw end, as Town
    counts it). The `?scene=town-scale` preview's synthetic hosts take all of
    these actions in the page, so they can be tried without real hosts.
  - Drag a tab onto another workspace of its host to move it (asks first,
    with **Don't ask again**; moving a workspace's last tab always asks,
    because that workspace closes). Strings follow the move.
    On phones, hold a card still before dragging; adding a second finger switches
    to pinch zoom without committing a move. Settling pauses while you type in
    an open terminal.
  - After a Herdr restart, strings that cannot be confirmed ask Keep or Detach;
    strings whose target closed wait in Needs a home. Selecting a card opens
    the shared Inspector. Development builds add an event trace for bug reports
    ([development tools](../../../../docs/development.md#development-tools)).
  - **Work**, the first labelled pill in Board's bottom-right controls, lays your pull
    requests out as columns: In review, Fixing (changes requested, checks
    failing or conflicts), Green (checks pass, a required review is pending),
    Ready to merge (approved, or passing where no review is required) and
    Merged; the Tickets tab
    groups Jira tickets and assigned GitHub issues by status. Each card links
    to the pull request or ticket and names the agents working on it; tap an
    agent to jump to its card. Escape, Back or a press outside closes it. See
    [Sources](../work-sources/notes.md#sources-github-and-jira).
    On phones, close a full-screen Inspector with X/Back to return to these
    controls. Work keeps its label and 44-pixel tap height. **Needs a home · n**
    remains a separate action for detached note strings; at zero or when space
    is tight, find it in **⋮ → Needs a home (n)**. Phone **Tidy** lives in **⋮**;
    Fit and zoom buttons also move there as needed to keep one row.
  See the [Board exercise](../../../../docs/TUTORIAL.md#board).
