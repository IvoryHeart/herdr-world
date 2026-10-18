## ADDED Requirements

### Requirement: Board view

World SHALL offer a Board view next to Graph in the view switcher and the phone
navigation. Board SHALL present each presented host as a labelled zone, each
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
non-actionable. Graph, Tree and the Pixel Office SHALL be unaffected.

A workspace card SHALL count its agents by status and its shells. The user MAY
give any workspace or tab card a colour from a fixed palette, saved with the
board; a tab without its own colour SHALL take its workspace's. A card's colour
SHALL never stand for or hide a status: status keeps its own colours on the dot,
ring, badge and overview squares. From an actionable workspace card the user MAY
open a plain terminal tab or start an agent in a new tab without a note, and
from a live host's label MAY open World's New workspace dialog.

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

### Requirement: Board moves between workspaces

Dragging a tab card over another workspace card of the same host SHALL mark
that workspace as the drop target, and dropping it there SHALL ask "Move the
tab to <workspace>?" with an option not to be asked again. The move SHALL use
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
checked, idle, no signal) by colour and badge. By default a tab whose agent is
working, and the selected tab, SHALL pulse; idle, finished, waiting and
no-signal tabs SHALL stay still, with needs you marked by its border and badge.
Pulses SHALL be switchable from the view's ⋯ menu and SHALL stop under reduced
motion; status SHALL remain visible by colour and badge without them.

#### Scenario: Turn pulses off

- **WHEN** the user turns Status pulses off in the ⋯ menu
- **THEN** no card pulses and each tab's status is still shown by its colour and badge

### Requirement: Board detail panel

Selecting a workspace, a tab or one of its panes on Board SHALL open World's
shared Inspector for that exact entity, with the same Terminal, Files, Changes
and Agent History tabs, docking and phone presentation as the other views,
rather than a Board-specific panel. Answers to a waiting agent SHALL go through
that Inspector's terminal and composer to the exact pane, qualified by
connection and runtime generation. In the overview, a tap on a workspace SHALL
centre it and zoom in instead of selecting it.

#### Scenario: Open a pane's detail

- **WHEN** the user taps the row of one pane in a tab with several panes
- **THEN** World's shared Inspector opens for that pane, with its Terminal, Files, Changes and Agent History

### Requirement: Board notes and strings

The user SHALL be able to create a note by double-click or double-tap on empty
board or from a card, and edit, colour and delete it. Notes SHALL belong to the whole board. The user SHALL be able to
string a note or card to another card by dragging from a card's handle or with
String to…, and to cut a string from the string itself or from the panel.
Dragging a handle onto empty board SHALL create a note strung to that card.
Stringing to a tab with more than one pane SHALL ask which pane; a single-pane
tab SHALL select its pane. A string to a tab or workspace SHALL be context only.

A note strung to an agent's pane SHALL offer to send the note to that agent.
The note text SHALL be delivered as a prompt to that exact pane only when the
user chooses Send, and only after World revalidates that the string is
attached on the current runtime generation and that an agent is present on that
pane; otherwise Send SHALL be refused with its reason. A note SHALL offer to
start a new agent in a chosen workspace, which creates a tab, starts the agent
in it, waits within a bound for the agent to become interactive, then prompts
it with the note and strings the note to it. A timeout SHALL be reported as
uncertain without sending the note; a failure at any step SHALL be reported
with what was created; no step SHALL be retried automatically. Agent replies or results MAY be
shown on the note when they are reported; World SHALL NOT invent them.

#### Scenario: Send a note

- **WHEN** a note is strung to an agent's pane and the user chooses Send
- **THEN** the agent in that pane receives the note text as a prompt, and nothing is sent to any other pane

#### Scenario: String to a tab with two agents

- **WHEN** the user drags a note's string onto a tab with two agent panes
- **THEN** World asks which pane, and the string attaches to the chosen pane

#### Scenario: A new agent is slow to start

- **WHEN** the user starts an agent from a note and it is not interactive within the bound
- **THEN** World reports that the agent may still be starting and that the note was not sent, and offers Send

#### Scenario: Cut a string

- **WHEN** the user selects a string and chooses Cut string
- **THEN** the string is removed and the note and card stay where they are

### Requirement: Board persistence and identity

The World service SHALL persist board layout, pins, folds, notes and strings as
one board document, with every Herdr anchor qualified by its connection profile,
bounded in size, written atomically and revisioned, and SHALL broadcast changes
to other open clients. An edit to a note based on an outdated revision of that
note SHALL be rejected with the current board rather than overwrite newer
content. Authenticated World clients of the service MAY receive board content;
note text SHALL go to Herdr or an agent only on the user's explicit Send.

Strings SHALL be anchored to the connection profile and the Herdr workspace,
tab or pane ID. Labels, directories and agent kinds SHALL NOT decide identity;
renames and agent start or stop SHALL NOT detach a string. With each anchor the
store SHALL keep the terminal IDs last observed in its target as a continuity
witness. An anchor SHALL be:

- attached when its target exists on the current runtime generation and at
  least one witnessed terminal ID is still present in it;
- unresolved, keeping its saved anchor, while its host is connecting, offline,
  stale or filtered or its target is outside the admitted topology;
- unconfirmed when its host is current and its ID exists but no witnessed
  terminal ID survives, until the user keeps or detaches it;
- detached into a "Needs a home" tray only on authoritative absence: a close
  observed on the current generation, or a qualified get on the current
  generation answering not found.

Only attached strings SHALL be actionable. Unresolved and unconfirmed strings
SHALL be drawn as such with their reason. A pane anchor SHALL follow a pane
moved by World through the move result. Items SHALL NOT be deleted or
re-attached without the user.

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
