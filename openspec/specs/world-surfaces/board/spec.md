# World board

## Purpose

Define the user-facing board contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Board view

World SHALL offer a Board view next to Town in the view switcher and the phone
navigation.

#### Scenario: Board view acceptance rules

- **WHEN** World presents or edits Board
- **THEN** Board SHALL present each presented host as a labelled zone, each
  admitted Herdr workspace of that host as a workspace card inside its zone, each
  admitted tab as a tab card near its workspace, and the user's notes. Every
  admitted tab and pane SHALL remain reachable. A tab with several panes SHALL show
  a row per pane, each with its own status, selectable and openable on its own, up
  to four rows with an exact count and a chooser for the rest. A tab's status SHALL
  be its most urgent agent pane's; plain terminal panes SHALL NOT colour it. A tab
  whose panes are all plain terminals SHALL be drawn as a terminal without a status
  pulse. Board position SHALL NOT change an entity's
  authoritative host, workspace, tab or pane ancestry. A host whose topology is
  cached after failure SHALL be visibly stale and its cards SHALL be
  non-actionable. Town SHALL be unaffected.

  Board SHALL lead its bottom-right controls with a visible labelled Work pill,
  with a filled pressed state, opening the existing Work lens. It SHALL keep the
  label and a 44-CSS-pixel tap height on phones (36 on desktop). Needs a home SHALL
  remain a distinct detached-note action after Work, with its own count and tray;
  at zero it SHALL remain in the menu and open an explicit empty state. Note counts
  SHALL NOT appear as Work counts. On phones Tidy SHALL move to the menu. When the
  single row cannot fit, Needs a home SHALL move to the menu before Fit and then
  zoom in/out; Work SHALL retain its visible slot and text. The bar SHALL NOT wrap.
  A full-screen Inspector SHALL continue to cover Board until closed by X/Back;
  Work SHALL NOT be duplicated inside it.

  Next SHALL cycle through actionable panes needing the user: waiting agents or
  shared questions placed on their pane, including shell questions. It SHALL use
  Board's native order, retaining the selected pane's position after it stops
  qualifying, and open the pane's shared Inspector. It SHALL skip stale hosts and
  shells without questions and be unavailable when none qualify. Next SHALL remain reachable through overflow when the row
  cannot fit it. The Board menu SHALL also offer Help and a surface override:
  Follow theme, Whiteboard or Blackboard, saved in this browser when storage is
  available. A surface override SHALL NOT change the application's theme.

  A workspace card SHALL count its agents by status and its shells. The user MAY
  give any workspace or tab card a colour from a fixed palette, saved with the
  board; a tab card SHALL show its terminal colour (see Terminal colour), so a tab
  without its own colour takes its workspace's, then its default. A card's colour
  SHALL never stand for or hide a status: status keeps its own colours on the dot,
  ring, badge and overview squares. From an actionable workspace card the user MAY
  open a plain terminal tab or start an agent in a new tab without a note, and
  from a live host's label MAY open World's New workspace dialog.

#### Scenario: Next needs attention

- **WHEN** the user chooses Next with waiting agents or shared questions placed on their pane
- **THEN** Board opens the next qualifying pane on its exact host, wraps after
  the last, and does not select a stale card or a shell without a question

#### Scenario: Choose Board's surface

- **WHEN** the user chooses Whiteboard or Blackboard from the Board menu
- **THEN** that palette overrides the theme for Board alone and remains chosen
  after reopening Board in this browser; Follow theme removes the override

#### Scenario: Find Work and detached notes on a narrow phone

- **WHEN** the user returns from a full-screen Inspector to Board
- **THEN** Work is the first labelled control and opens Pull requests
- **AND** the separate Needs a home action remains reachable, including at zero
- **AND** secondary actions use the menu instead of wrapping or hiding Work text

#### Scenario: Open Board

- **WHEN** the user chooses Board with two hosts that expose workspaces and tabs
- **THEN** each host appears as a zone with its workspace cards, and each workspace's tabs appear around it with their status

#### Scenario: A tab with an agent and a shell

- **WHEN** a tab holds an agent that needs the user and an idle shell
- **THEN** its card shows both panes as rows and is marked as needing the user, and tapping the shell row selects the shell

#### Scenario: Colour a workspace

- **WHEN** the user selects a workspace and picks teal
- **THEN** the workspace and its tabs without their own colour are tinted teal on every device, and each tab still shows its status colour

#### Scenario: Stale host

- **WHEN** a host's topology is cached after a failure
- **THEN** its zone and cards are shown as stale and offer no actions

### Requirement: Board placement and movement

Board SHALL keep cards where the user places them.

#### Scenario: Board placement and movement acceptance rules

- **WHEN** World presents or edits Board
- **THEN** Each tab SHALL keep its
  position relative to its workspace and each workspace relative to its host, so
  moving a workspace moves its tabs with it. While the user drags, cards SHALL
  respond elastically; within about one second after the interaction ends the
  board SHALL come to rest and SHALL NOT move again until the user acts or the
  topology changes. Card movement SHALL NOT be a setting. Layout SHALL NOT depend
  on zoom.

  New tabs, unfolded tabs and new notes SHALL be placed in free space near their
  workspace or the requested point without displacing other cards. Folding a
  workspace SHALL gather its tabs into it and show their count; unfolding SHALL
  place them into free space. Tidy SHALL rearrange the selected workspace's tabs,
  or the whole board when nothing is selected, and SHALL offer an undo that
  restores the previous positions. Pinned tab cards SHALL occupy a derived shelf
  above their workspace in native tab order, under a shared tinted band, and
  SHALL follow that workspace. A pinned tab dragged away SHALL return to its
  shelf; unpinning SHALL place it in free space near its workspace. A pinned
  workspace card SHALL keep its absolute board position. Core tab pins SHALL
  derive from `herdr.pinned` as specified by Pinned Town desks; Herdr TUI tab
  pins and workspace pins SHALL remain World-owned.

#### Scenario: Pin a card

- **WHEN** the user pins a selected card from its bar (on a phone, from its
  terminal's header) and then tidies its workspace
- **THEN** a tab card shows a pin badge on its workspace's shelf while the
  other cards are rearranged, and unpinning places it in free space nearby
- **AND** pinning a workspace card preserves its absolute board position

#### Scenario: Drag a workspace

- **WHEN** the user drags a workspace card and releases it
- **THEN** its unpinned tabs keep their arrangement around it, its pinned tabs
  follow on the shelf above it, and the board is still within about one second

#### Scenario: Unfold into free space

- **WHEN** the user unfolds a workspace whose neighbours are close by
- **THEN** its tabs appear in free space around it and no other card moves

#### Scenario: Undo tidy

- **WHEN** the user tidies the board and chooses Undo
- **THEN** every card returns to its position before the tidy

### Requirement: Board moves between workspaces

Dragging a tab card over another workspace card of the same host SHALL mark
that workspace as the drop target, and dropping it there SHALL ask "Move the
tab to <workspace>?" with an option not to be asked again.

#### Scenario: Board moves between workspaces acceptance rules

- **WHEN** World presents or edits Board
- **THEN** The move SHALL use
  World's qualified service move, the same as Town's, and strings to the moved
  tab and its panes SHALL follow the move result. Moving a workspace's last tab
  SHALL always ask, whatever the option says, and SHALL say that the workspace
  will close. A tab SHALL NOT be dropped on another host.

#### Scenario: Move a terminal

- **WHEN** the user drags a terminal's tab onto another workspace of its host and confirms
- **THEN** the tab moves there with its panes still running, and notes strung to its panes stay attached

#### Scenario: Last tab

- **WHEN** the user drops a workspace's only tab onto another workspace, even with "Don't ask again" chosen
- **THEN** Board asks first and says the workspace will close

A single-pane tab SHALL expose a distinct pane-drag grip, while the rest of
its card SHALL retain whole-card arrangement. Dragging that grip or a pane row
onto another tab SHALL move only that pane through Town's
qualified pane-move service, leaving the source card and its other panes in
place. A touch hold SHALL lift the pane; a quick swipe SHALL remain a pan.
Cancellation or a drop on empty board SHALL send no move. A tab covered by
another window or overlay SHALL NOT be a drop target. Host/runtime changes
or a stale/foreign destination SHALL refuse the move. A move that would close
the source room SHALL require explicit confirmation and revalidate the captured
pane before retrying. Strings to that pane SHALL follow the service's move result.

#### Scenario: Move one pane and preserve its peers

- **WHEN** the user drags one pane row onto another tab of the same current host
- **THEN** only that pane is moved with its terminal running and strings attached;
  other panes and the source card retain their position

#### Scenario: Move a single-pane tab's last room pane

- **WHEN** the user drags a single-pane tab's grip onto a tab in another room
- **THEN** Board moves only that pane and asks for confirmation before closing
  its source room; dragging the rest of the card still arranges the whole card

#### Scenario: Cancel a pane move

- **WHEN** a pane drag is cancelled, or the last-room warning is dismissed
- **THEN** no further native move is sent and the old room remains open

### Requirement: Board semantic zoom

Board SHALL zoom with the mouse wheel around the pointer, with pinch on touch
screens and with visible zoom controls, and SHALL fit everything on request.
Below an overview threshold Board SHALL hide tab cards and show each pane as a
square on its workspace card, filled in its status colour for an agent and
hollow for a plain terminal, with workspace, note and host labels
enlarged so they remain readable; above it the tab cards SHALL return. Strings
to a hidden tab SHALL attach to its workspace.

#### Scenario: Zoom out to the overview

- **WHEN** the user zooms out past the overview threshold
- **THEN** tab cards fade out, each workspace shows a status square per tab, and no card changes position

### Requirement: Board status pulses

Each tab card SHALL show its status (working, needs you, finished but not
checked, idle, no signal) by colour and badge.

#### Scenario: Board status pulses acceptance rules

- **WHEN** World presents or edits Board
- **THEN** By default a tab whose agent is
  working, and the selected tab, SHALL pulse; idle, finished, waiting and
  no-signal tabs SHALL stay still, with needs you marked by its border and badge.
  Pulses SHALL be switchable from the view's ⋯ menu and SHALL stop under reduced
  motion; status SHALL remain visible by colour and badge without them.

  The Board menu SHALL offer separate status colours for working, needs you,
  finished, idle and no signal, saved in this browser when storage is available.
  Those choices SHALL affect status dots, rings, badges and overview squares
  without changing shared card colours. Reset status colours SHALL restore the
  current surface's defaults.

#### Scenario: Set a status colour without recolouring a card

- **WHEN** the user changes Needs you in Status colours
- **THEN** its status marks use the chosen colour, the card's own colour remains
  unchanged, and Reset status colours restores the selected surface's default

#### Scenario: Turn pulses off

- **WHEN** the user turns Status pulses off in the ⋯ menu
- **THEN** no card pulses and each tab's status is still shown by its colour and badge

### Requirement: Board detail panel

Selecting a workspace, a tab or one of its panes on Board SHALL open World's
shared Inspector for that exact entity, with the same Terminal, Files, Changes
and Agent History tabs, docking and phone presentation as the other views,
rather than a Board-specific panel.

#### Scenario: Board detail panel acceptance rules

- **WHEN** World presents or edits Board
- **THEN** Answers to a waiting agent SHALL go through
  that Inspector's terminal and composer to the exact pane, qualified by
  connection and runtime generation. In the overview, a tap on a workspace SHALL
  centre it and zoom in instead of selecting it.

#### Scenario: Open a pane's detail

- **WHEN** the user taps the row of one pane in a tab with several panes
- **THEN** World's shared Inspector opens for that pane, with its Terminal, Files, Changes and Agent History

### Requirement: Board notes and strings

The user SHALL be able to create a note by double-click or double-tap on empty
board or from a card, and edit, colour and delete it.

#### Scenario: Board notes and strings acceptance rules

- **WHEN** World presents or edits Board
- **THEN** Notes SHALL belong to the whole board. The user SHALL be able to
  string a note or card to another card by dragging from a card's handle or with
  String to…, and to cut a string from the string itself or from the panel.
  Dragging a handle onto empty board SHALL create a note strung to that card.
  Stringing to a tab with more than one pane SHALL ask which pane; a single-pane
  tab SHALL select its pane. A string to a tab or workspace SHALL be context only.

  A note strung to an agent's pane SHALL offer to send the note to that agent.
  The note text SHALL be delivered as a prompt to that exact pane only when the
  user chooses Send, and only after World revalidates that the string is
  attached on the current runtime generation and that the agent the note was
  strung to is present on that pane; otherwise Send SHALL be refused with its
  reason.

  When a note is strung to a pane, the browser SHALL tell the service which agent
  it showed there (its kind and Herdr session), and the service SHALL record that
  agent as the string's recipient (kind, hashed session and foreground process
  group) only if its own read of the pane finds the same kind and session. A
  string whose agent could not be confirmed that way (no session shown, a
  replacement before the read, no answer) SHALL stay unbound. Only the service
  SHALL set a recipient, qualified by the anchor's connection, pane and terminal;
  a re-witnessed anchor (after Herdr restarts) SHALL drop it. At Send the service SHALL compare the pane's agent
  with the expected recipient: their kinds SHALL match, and an expected session
  SHALL remain present and equal in the observation. Only a group-only expected
  recipient MAY match by process group and learn its first session that way.
  If the expected session disappears while the agent kind and process group
  still match, World SHALL report that Herdr no longer reports the session,
  not claim that a replacement is known, and SHALL ask for confirmation.
  Another agent in the same pane and terminal, or a string whose recipient was
  never recorded, SHALL be refused with that agent named, and the note SHALL go
  to it only when the user confirms that agent; the confirmed agent becomes the
  string's recipient. An explicit confirmation SHALL select the expected recipient
  for that attempt; a match with the saved recipient SHALL NOT override it.
  Herdr cannot hold a pane between a check and the prompt, so
  the service SHALL read the pane's agent again after the prompt and report a
  change as possibly delivered to another agent, never as sent. A note SHALL offer to
  start a new agent, from a profile or an agent kind, in a chosen workspace
  through the shared launcher (see New agent from a profile or a kind), with the
  note as its first prompt, and SHALL string the note to the new pane whenever
  one was created. Only definite refused starts MAY retry within the launcher's
  bound; lost replies SHALL be inspected without relaunch. A timeout SHALL be
  reported as uncertain without sending the note, and a failure SHALL report
  what was created. Agent replies or results MAY be
  shown on the note when they are reported; World SHALL NOT invent them.

#### Scenario: Send a note

- **WHEN** a note is strung to an agent's pane and the user chooses Send
- **THEN** the agent in that pane receives the note text as a prompt, and nothing is sent to any other pane

#### Scenario: Another agent in the same pane

- **WHEN** a note was strung to agent A, A exits and agent B starts in the same shell, keeping the pane and terminal, and the user chooses Send
- **THEN** nothing is sent; World says B is now in that pane and offers to send to B, and sends to B only if the user chooses that

#### Scenario: The agent changes during Send

- **WHEN** the pane's agent is replaced between the service's last check and the prompt
- **THEN** World reports that the note may have reached another agent and does not report it as sent

#### Scenario: A captured session becomes unavailable

- **WHEN** Herdr stops reporting the session captured for a note or an explicit confirmation, while the pane, terminal, agent kind and process group stay the same
- **THEN** Send submits no prompt, reports the missing session without claiming a known replacement, and asks the user to confirm the current recipient

#### Scenario: The original agent returns before a replacement confirmation

- **WHEN** a note was bound to A, World offers Send to B, and A returns before that confirmation is submitted
- **THEN** confirmation of B is refused and no prompt is submitted, even if A still matches the saved recipient or its group-only evidence

#### Scenario: A group-only recipient reports its first session

- **WHEN** the expected recipient has only process-group evidence and the observed agent has the same kind and group plus its first session
- **THEN** the observation matches and a successful Send records the newly reported session

#### Scenario: String to a tab with two agents

- **WHEN** the user drags a note's string onto a tab with two agent panes
- **THEN** World asks which pane, and the string attaches to the chosen pane

#### Scenario: A new agent is slow to start

- **WHEN** the user starts an agent from a note and it is not interactive within the bound
- **THEN** World reports that the agent may still be starting and that the note was not sent, and offers Send

#### Scenario: Cut a string

- **WHEN** the user selects a string and chooses Cut string
- **THEN** the string is removed and the note and card stay where they are

### Requirement: Board drawing

On desktop the user SHALL be able to draw on Board to brainstorm: freehand pen
strokes, rectangles, ellipses, diamonds, text, and arrows whose ends attach to a
drawing, a note or a card.

#### Scenario: Board drawing acceptance rules

- **WHEN** World presents or edits Board
- **THEN** A tool palette SHALL offer select, the drawing
  tools, a note, colour, fill, undo, redo and delete. The user SHALL be able to
  select, move, resize, recolour, label and delete drawings. Attached arrow ends
  SHALL follow their targets; when a target is gone the end SHALL stay at its last
  saved point. Drawings SHALL be saved with the Board document, each with its own
  revision, beneath strings and cards, and SHALL never send anything to an agent.
  Pan and zoom SHALL be unchanged. A move, resize, end drag or text edit SHALL
  be saved against the drawing revision it began from: when the drawing changed
  elsewhere meanwhile, the edit SHALL be refused with a reason and the newer
  drawing kept, and a refused text edit SHALL retain the typed text and reopen on
  the newer drawing. If another text editor is already open when the refusal
  arrives, it SHALL keep its current text and the refused draft SHALL wait until
  that editor finishes; multiple refused drafts SHALL each remain available in
  turn, including separate drafts for the same drawing. A moved arrow SHALL let go
  of its targets from the ends it is drawn at. Undo and redo SHALL cover this browser's
  drawing changes and SHALL refuse, with a reason, to revert a drawing someone
  changed since. On a phone, drawings SHALL be shown but not editable, and notes
  keep working.

#### Scenario: Draw and connect

- **WHEN** the user draws a rectangle and an arrow from it to a card, then moves the card
- **THEN** the arrow end follows the card and both drawings survive a reload

#### Scenario: Text edit after another edit

- **WHEN** the user is typing a drawing's text and another client saves a new text, colour and place for it
- **THEN** finishing the edit keeps the other client's drawing, says why, and reopens the editor on it with the typed text

#### Scenario: Text refusal arrives while editing another drawing

- **WHEN** a user finishes text A, starts typing text B, and A's save is refused because another client changed A
- **THEN** World explains the refusal and keeps B's editor and typed text unchanged
- **AND** finishing B reopens A's refused draft with its typed text on the newer drawing
- **AND** if B is also refused, its draft stays available after A finishes

#### Scenario: Undo after another edit

- **WHEN** another client changes a drawing after the user's last change to it
- **THEN** Undo leaves it as it is and says why

#### Scenario: Drawings on a phone

- **WHEN** Board opens on a phone
- **THEN** saved drawings are shown, no drawing tools appear and drawings do not take the pointer

### Requirement: Board persistence and identity

The World service SHALL persist board layout, pins, folds, notes and strings as
one board document, with every Herdr anchor qualified by its connection profile,
bounded in size, written atomically and revisioned, and SHALL broadcast changes
to other open clients.

#### Scenario: Board persistence and identity acceptance rules

- **WHEN** World presents or edits Board
- **THEN** An open Board SHALL apply layout changes saved by other
  clients; while it has a local drag or save in progress its own save follows and
  replaces the layout (last writer wins). An edit to a note based on an outdated
  revision of that note SHALL be rejected with the current board rather than
  overwrite newer content; a note being edited SHALL keep its draft and the
  revision editing started from, and a draft that cannot be saved (the note
  changed or was deleted elsewhere) SHALL stay available, across view switches and
  reloads in that browser, until the user saves it over the note, saves it as a
  new note, or discards it. When the browser cannot store it, Board SHALL say the
  draft lasts only in that tab. Authenticated World clients of the service MAY receive board content;
  note text SHALL go to Herdr or an agent only on the user's explicit Send.

  Strings SHALL be anchored to the connection profile and the Herdr workspace,
  tab or pane ID. Labels, directories and agent kinds SHALL NOT decide identity;
  renames and agent start or stop SHALL NOT detach a string. With each anchor the
  store SHALL keep the terminal IDs last observed in its target as a continuity
  witness. An anchor SHALL be:

  - attached when its target exists on the current runtime generation and at
    least one witnessed terminal ID is still present in it, or, for a workspace
    or tab that held no terminals when strung or kept, while it exists (weak
    evidence, acceptable because such anchors never authorise Send); a pane
    anchor always needs a matching witnessed terminal;
  - unresolved, keeping its saved anchor, while its host is connecting, offline,
    stale or filtered or its target is outside the admitted topology;
  - unconfirmed when its host is current and its ID exists but no witnessed
    terminal ID survives, until the user keeps or detaches it;
  - detached into a "Needs a home" tray only on authoritative absence: a close
    observed on the current generation, or a qualified get on the current
    generation answering not found. The detach SHALL apply only if the string
    still names the checked target, so a reply about an ID the string no longer
    uses (after a move) changes nothing.

  While an anchor is attached on a current host, Board SHALL keep its witness in
  step with the target's present terminals, so continuity survives panes opening
  and closing. Only attached strings SHALL be actionable, and Send SHALL be
  offered only for a current, actionable pane. At Send the service SHALL check
  that the saved board still strings that note to that pane and that the note is
  the revision the user sent, and SHALL send the saved text. Unresolved and
  unconfirmed strings SHALL be drawn as such with their reason, at the target's
  last known position or its host's zone when the target is not on the board. A
  pane or tab anchor SHALL follow a pane or tab moved by World, from any view or
  client, through the move result, rewritten by the service. After a move that
  failed or rolled back, the service SHALL reconcile witnessed anchors from the
  terminals the outcome positively observed and leave the rest unresolved. Items SHALL NOT be
  deleted or re-attached without the user.

  Card positions, World-owned pins, folds and workspace/host colours are layout
  preferences keyed by connection profile and native ID, not claims of identity:
  a new entity that reuses an ID may inherit that arrangement. Tab colour and
  terminal appearance SHALL instead follow Shared terminal appearance and
  require continuing terminal evidence; a replacement with conflicting terminal
  witnesses SHALL NOT inherit bound choices. Core pins derive from runtime labels.
  Strings SHALL retain the continuity rules above.

#### Scenario: World restarts while Herdr keeps running

- **WHEN** World restarts and its first observation of a host has no children yet
- **THEN** that host's strings are unresolved, and when the host's topology arrives with the same terminals they are attached again without any prompt

#### Scenario: A host disconnects

- **WHEN** a host goes offline
- **THEN** its notes stay where they are, their strings are drawn as unresolved, Send is disabled, and nothing moves to Needs a home

#### Scenario: Herdr restarts

- **WHEN** Herdr restarts and its workspaces, tabs and panes return with the same IDs but new terminals
- **THEN** the host shows one prompt listing the affected notes, and nothing is sent to those panes until the user keeps them

#### Scenario: A new session reuses IDs with identical names

- **WHEN** a new Herdr session reuses a workspace ID with the same label, directory and agent kind
- **THEN** the strings to it are unconfirmed rather than attached, because no witnessed terminal survives

#### Scenario: A renamed tab

- **WHEN** the user renames a tab that a note is strung to
- **THEN** the string stays attached

#### Scenario: A closed tab

- **WHEN** a tab that a note is strung to closes while its host is observed
- **THEN** the note stays on the board and its string moves to Needs a home

#### Scenario: A string to an empty workspace

- **WHEN** the user strings a note to a workspace with no tabs, and later opens a tab in it
- **THEN** the string is attached throughout, and the new tab's terminal becomes its witness

#### Scenario: A move made in another view

- **WHEN** a note is strung to a pane and the user moves that agent to another desk in Town
- **THEN** the service rewrites the string to the pane's new ID, and Board shows it attached to the moved pane

#### Scenario: Phone and desktop

- **WHEN** the user adds a note on the desktop while the board is open on a phone
- **THEN** the phone shows the note without a reload

### Requirement: Board on phones

On phones Board SHALL present the same board with hosts stacked vertically.
One finger SHALL drag a card or pan empty board, pinch SHALL zoom, double-tap on
empty board SHALL create a note, and tapping a card SHALL select it and centre it
above the panel.

#### Scenario: Phone board

- **WHEN** the user opens Board on a 390 px wide screen
- **THEN** the hosts' zones are stacked, cards can be dragged directly, and selecting a card opens the bottom sheet with the card visible above it
