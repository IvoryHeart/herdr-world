## ADDED Requirements

### Requirement: Board view

World SHALL offer a Board view next to Graph in the view switcher and the phone
navigation. Board SHALL present each presented host as a labelled zone, each
admitted Herdr workspace of that host as a workspace card inside its zone, each
admitted tab as a tab card near its workspace, and the user's notes. Every
admitted tab SHALL remain reachable. Board position SHALL NOT change an entity's
authoritative host, workspace, tab or pane ancestry. A host whose topology is
cached after failure SHALL be visibly stale and its cards SHALL be
non-actionable. Graph, Tree and the Pixel Office SHALL be unaffected.

#### Scenario: Open Board

- **WHEN** the user chooses Board with two hosts that expose workspaces and tabs
- **THEN** each host appears as a zone with its workspace cards, and each workspace's tabs appear around it with their status

#### Scenario: Stale host

- **WHEN** a host's topology is cached after a failure
- **THEN** its zone and cards are shown as stale and offer no actions

### Requirement: Board placement and movement

Board SHALL keep cards where the user places them. Each tab SHALL keep its
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
restores the previous positions. A pinned card SHALL keep its board position and
SHALL NOT follow its workspace.

#### Scenario: Drag a workspace

- **WHEN** the user drags a workspace card and releases it
- **THEN** its unpinned tabs follow and keep their arrangement around it, and the board is still within about one second

#### Scenario: Unfold into free space

- **WHEN** the user unfolds a workspace whose neighbours are close by
- **THEN** its tabs appear in free space around it and no other card moves

#### Scenario: Undo tidy

- **WHEN** the user tidies the board and chooses Undo
- **THEN** every card returns to its position before the tidy

### Requirement: Board semantic zoom

Board SHALL zoom with the mouse wheel around the pointer, with pinch on touch
screens and with visible zoom controls, and SHALL fit everything on request.
Below an overview threshold Board SHALL hide tab cards and show each tab as a
status square on its workspace card, with workspace, note and host labels
enlarged so they remain readable; above it the tab cards SHALL return. Strings
to a hidden tab SHALL attach to its workspace.

#### Scenario: Zoom out to the overview

- **WHEN** the user zooms out past the overview threshold
- **THEN** tab cards fade out, each workspace shows a status square per tab, and no card changes position

### Requirement: Board status pulses

Each tab card SHALL show its status (working, needs you, finished but not
checked, idle, no signal) by colour and, by default, by a pulse in that colour
whose pace reflects urgency, with needs you fastest. A workspace with a tab that
needs the user SHALL pulse. Pulses SHALL be switchable from the view's ⋯ menu
and SHALL stop under reduced motion; status SHALL remain visible by colour and
badge without them.

#### Scenario: Turn pulses off

- **WHEN** the user turns Status pulses off in the ⋯ menu
- **THEN** no card pulses and each tab's status is still shown by its colour and badge

### Requirement: Board detail panel

Selecting a tab SHALL open a panel with its status, its agent, its workspace
and host, Output, Files, Changes and History, and actions to open the terminal,
add a note, string it, pin it and close it with confirmation. A waiting tab
SHALL offer answers delivered to that exact pane, qualified by connection and
runtime generation. Selecting a workspace SHALL open a panel with its Tabs,
the combined Files and History of its tabs, its repository's Changes, and
actions to create a tab, fold, tidy, add a note and string it. Files, Changes
and History SHALL use World's existing agent history, file and git operations
and SHALL open the existing Inspector views for full detail. On phones the
panel SHALL be a bottom sheet that phone Back closes.

#### Scenario: Answer from the panel

- **WHEN** the user selects a waiting tab and chooses Yes
- **THEN** the answer is delivered to that pane only, and a retired runtime rejects it

#### Scenario: Workspace changes

- **WHEN** the user opens Changes on a workspace panel
- **THEN** the workspace repository's changed files are listed with additions and deletions, and choosing one opens its diff

### Requirement: Board notes and strings

The user SHALL be able to create a note by double-click or double-tap on empty
board or from a card, and edit, colour and delete it. The user SHALL be able to
string a note or card to another card by dragging from a card's handle or with
String to…, and to cut a string from the string itself or from the panel.
Dragging a handle onto empty board SHALL create a note strung to that card.

A note strung to an agent's tab SHALL offer to send the note to that agent; the
note text SHALL be delivered as a prompt to that exact pane only when the user
chooses Send. A note SHALL offer to start a new agent in a chosen workspace,
which creates a tab, starts the agent in it, prompts it with the note and
strings the note to it; a failure at any step SHALL be reported with what was
created and SHALL NOT be retried automatically. Agent replies or results MAY be
shown on the note when they are reported; World SHALL NOT invent them.

#### Scenario: Send a note

- **WHEN** a note is strung to an agent's tab and the user chooses Send
- **THEN** the agent in that pane receives the note text as a prompt, and nothing is sent to any other pane

#### Scenario: Cut a string

- **WHEN** the user selects a string and chooses Cut string
- **THEN** the string is removed and the note and card stay where they are

### Requirement: Board persistence and identity

The World service SHALL persist board layout, pins, folds, notes and strings
per connection profile, bounded in size, written atomically and revisioned, and
SHALL broadcast changes to other open clients. A board change based on an
outdated revision SHALL be rejected and re-read rather than overwrite newer
content. Notes SHALL leave the service host only when the user sends them to an
agent.

Board items SHALL be anchored to the connection profile and the Herdr workspace,
tab or pane ID, with a fingerprint captured when attached. A pane anchor SHALL
follow a pane moved by World through the move result. An item whose anchor is
missing or whose fingerprint no longer matches SHALL be detached into a "Needs a
home" tray, where the user can re-attach or discard it; detached items SHALL NOT
be deleted or re-attached without the user.

#### Scenario: Herdr restarts

- **WHEN** Herdr restarts and its workspaces, tabs and panes return with the same IDs and fingerprints
- **THEN** every note, string and card position is shown as before

#### Scenario: A reused workspace ID

- **WHEN** a new Herdr session reuses a workspace ID for a workspace with a different label and directory
- **THEN** notes anchored to the old workspace move to the Needs a home tray instead of attaching to the new one

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
