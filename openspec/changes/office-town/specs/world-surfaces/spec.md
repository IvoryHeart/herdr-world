## ADDED Requirements

### Requirement: Town scene

Town SHALL present a town in which each presented host is one building along a
road, each admitted Herdr workspace of that host is a room on a carpet inside its
building, and each admitted tab is a desk in its room. A desk SHALL be a table
with one seat per admitted pane up to four drawn seats, sized to its panes: a
one-pane desk SHALL be a solo desk, a two-pane desk a small table with one seat on
each side, and three or four panes a four-seat team table; an agent pane SHALL show
its agent character at its seat while seated, and a non-agent pane SHALL show a
screen without a character. Panes beyond the drawn seats SHALL remain
individually reachable through an exact count and chooser. Each building SHALL
contain a lounge and a reception, and the reception SHALL show the user behind
its counter. Scene position SHALL NOT change an entity's authoritative host,
workspace, tab or pane ancestry.

A building for a host whose topology is cached after failure SHALL be visibly
stale and its entities SHALL be non-actionable. Town SHALL NOT invent activity,
cost, completion or project data when no authoritative state or optional provider
supplies it.

#### Scenario: Several hosts with different workspaces

- **WHEN** three filtered hosts expose different numbers of workspaces, tabs and panes
- **THEN** Town shows three buildings, each containing exactly its host's rooms,
  desks and seats with qualified identities, and no room appears in another host's building

#### Scenario: A tab has more panes than drawn seats

- **WHEN** a tab contains six admitted panes
- **THEN** its desk draws four seats, shows the exact count of six, and the two
  remaining panes stay individually selectable through the chooser

#### Scenario: A host's runtime fails

- **WHEN** a presented host's connection fails and Town retains its cached topology
- **THEN** its building is marked stale, its desks and agents cannot start
  operations, and other buildings remain fully usable

#### Scenario: No observation provider is configured

- **WHEN** no optional provider supplies cost, activity or project data
- **THEN** Town shows authoritative Herdr state only and omits or labels the
  unavailable figures instead of showing estimates

### Requirement: Stable Town placement

Town SHALL derive room order from Herdr's native workspace order and desk order
from native tab order within each host. A room's capacity SHALL step through a
bounded set of grid sizes that always leaves at least one free desk spot. While a
scene is live, a topology change SHALL NOT move an existing desk to another spot
or reorder rooms: a new tab SHALL take the first free spot of its room, a closed
tab SHALL free its spot, and a room that reaches a new capacity step MAY shift
later rooms and rows of the same building without reordering rooms. Placement SHALL be
re-derived from native order when the scene is rebuilt. Desktop SHALL lay out
buildings in one row; phones SHALL stack buildings in one vertical column.

#### Scenario: A tab is created while the user watches

- **WHEN** a new tab is admitted in a room that has free spots
- **THEN** the new desk appears in the first free spot and every other desk and
  room keeps its position

#### Scenario: A tab closes in the middle of a room

- **WHEN** a tab whose desk sits between other desks closes
- **THEN** its spot becomes free and no other desk moves until the scene is rebuilt

#### Scenario: A room fills its capacity step

- **WHEN** a room's last free spot is taken
- **THEN** the room grows to the next capacity step with a free spot, rooms keep
  their order, and desks keep their room

### Requirement: Town zoom levels

Town SHALL present town, overview, room and desk levels over the same
placement, selected by on-screen size. The town level SHALL show roofs with host
summaries. The overview level SHALL show one status card per room with its name,
desk count, working count, a status distribution, a waiting count when non-zero
and a project signal line when a provider supplies one, plus one reception board
per host showing waiting agents. The room level SHALL show tables with a status
mark per seat. The desk level SHALL show characters, screens and animation with
per-seat targets. Waiting attention SHALL be visible at every level. Status SHALL
be conveyed by text or accessible names in addition to colour. The desktop
default view SHALL fit every presented building at the overview level; the phone
default view SHALL fit the first building's width. When the presented rooms are
too many for readable cards at the fit-all zoom, the desktop default MAY fit
every building at the town level instead, with cards appearing as the user
zooms in. Only on-screen buildings need to keep their room cards, plaques and
reception boards in the document.

Activating a room at the overview or room level SHALL zoom to that room, and a
double tap or double click SHALL zoom in at its location. Zoom controls SHALL
remain available as visible buttons.

#### Scenario: Read the whole office at a glance

- **WHEN** the user opens Town on a desktop with three hosts and twenty-four rooms
- **THEN** every room's status card and every host's reception board are visible
  without panning, and rooms with waiting agents show their waiting count

#### Scenario: Open a town too large for room cards

- **WHEN** the user opens Town on a desktop where the presented rooms are too
  many for readable cards at the fit-all zoom
- **THEN** every building is visible under its roof with its host summary, and
  zooming in shows the room cards of the buildings on screen

#### Scenario: Zoom from a room card to its desks

- **WHEN** the user activates a room's status card
- **THEN** Town zooms to that room and its tables, seats and agents become
  individually targetable

#### Scenario: Zoom out past the overview

- **WHEN** the user zooms out beyond the fit-all view
- **THEN** roofs cover the buildings and each roof shows its host's room and desk
  counts while the reception boards keep showing waiting agents

### Requirement: Town agent locations

Town SHALL seat working and unknown agents at their pane's seat. A blocked agent
SHALL move to its host's reception and queue in order of when it became blocked,
oldest first, within a bounded number of queue positions; further blocked agents
SHALL stay at their seat with a waiting cue and the reception SHALL show the exact
overflow count. A done agent SHALL also go to its host's reception, queued after
the blocked agents, show a completion marker, and leave finished work on its
desk until its status changes or the user checks the completion by opening its
terminal or marking it reviewed; a checked agent SHALL then go to the lounge.
Because Herdr may report a finished agent as idle, Town SHALL also treat an
agent it observes going from working or blocked to idle as done until checked.
This browser-local state SHALL NOT represent approval or mutate Herdr. Desks
SHALL carry their tab's name from the room level, and each seat its agent's or
terminal's name at the desk level. An idle agent SHALL move to a lounge spot in its
building, or remain seated with an idle cue when no spot is free. When an
agent's status changes, it SHALL move to its new location, and an answered agent
SHALL return to its seat. Location and movement SHALL be presentation only: they
SHALL NOT delay operational state, and every agent SHALL keep its exact qualified
pane target wherever it stands.

#### Scenario: An agent asks for input and is answered

- **WHEN** a working agent becomes blocked and the user answers it
- **THEN** the agent walks to its host reception and joins the queue in age order,
  and after the answer it walks back to its seat while its pane identity and
  terminal target stay unchanged

#### Scenario: More agents are blocked than queue positions

- **WHEN** a host has more blocked agents than its reception's queue positions
- **THEN** the oldest fill the queue, the rest show a waiting cue at their seats,
  the reception shows the exact total, and every blocked agent remains reachable

#### Scenario: An agent finishes

- **WHEN** an agent becomes done
- **THEN** it walks to its host's reception behind any waiting agents and shows a
  completion marker, and inspecting it does not change Herdr state

### Requirement: Town attention rail

Town SHALL present the agents that need the user in the same order as Desk
attention triage: blocked agents oldest first, then done agents newest first. On
desktop the list SHALL be a left rail grouped by host and then room, with
collapsible host groups, and the user SHALL be able to hide it to a count and
restore it; this choice SHALL persist per browser. On phones the list SHALL be a
bottom tray that remains reachable while a peek or card is open. Hovering an
entry SHALL open its peek, and activating an entry SHALL open that peek pinned,
where its reply line takes a reply. A keyboard command SHALL open the next agent that
needs the user.
The rail SHALL list a bounded number of entries and count the rest.

#### Scenario: Work through waiting agents on desktop

- **WHEN** three agents in two hosts are blocked and the user presses the next-agent key repeatedly
- **THEN** Town opens each agent's exact pane in age order and the rail
  reflects each answer without reordering unrelated entries

#### Scenario: Hide the rail

- **WHEN** the user hides the desktop rail and reloads Town
- **THEN** the rail stays hidden, shows the waiting count, and can be restored with one action

### Requirement: Town agent peek

Hovering an agent, a reception entry or a rail entry with a pointer SHALL open a
peek after a short delay, and tapping one SHALL open a pinned peek. The peek SHALL
show the agent's name, location and status, the latest bounded lines of its pane
(the question when it is waiting), answer options only when those lines present a
numbered menu or a yes/no prompt, and actions to reply, open the Inspector, open
the terminal and go to the next waiting agent. Tapping an agent in Town
SHALL open its peek and SHALL NOT open an Inspector; tapping a room SHALL only
zoom to it.

Peek keyboard shortcuts SHALL apply only while keyboard focus is in the Town
scene or in the peek; pointer hover alone SHALL NOT capture keys. In that context,
digit keys SHALL choose the corresponding answer. Town SHALL NOT capture keys while a terminal, search field or other editable
control has focus, during IME composition, or with Ctrl, Alt or Meta held, and a
hover peek SHALL NOT change the keyboard target. Answers
and replies SHALL be sent only to the exact qualified pane through the existing
input path. If the target closes, moves away or its runtime generation retires,
the peek SHALL close or show it as unavailable and SHALL NOT send input elsewhere.
Opening the terminal from a peek SHALL follow the Inspector presentation preference.

#### Scenario: Answer from a hover

- **WHEN** the user hovers a waiting agent whose pane exposes a permission choice and clicks Yes
- **THEN** exactly that pane receives the answer, the agent becomes working, and
  no other pane receives input

#### Scenario: A terminal has focus while another agent is hovered

- **WHEN** agent A's terminal has keyboard focus and the pointer hovers agent B so
  that B's peek opens, and the user types digits and letters
- **THEN** every key reaches only A's terminal and no answer is sent to B

#### Scenario: The target retires during a reply

- **WHEN** the peeked pane closes or its runtime generation retires before the reply is sent
- **THEN** World rejects the reply and does not redirect it to another pane, tab or host

#### Scenario: No recognizable choice is on screen

- **WHEN** a blocked agent's latest lines contain neither a numbered menu nor a
  yes/no prompt
- **THEN** the peek offers Reply and the terminal without answer buttons

### Requirement: Town peeks show recent chatter and take replies

An agent's peek SHALL show the agent's recent output, read from the exact
qualified pane, in a small box that scrolls back and follows the newest lines
unless the user has scrolled up. A waiting agent's question SHALL be set apart
from its earlier output, with its answers as one-tap buttons. The peek SHALL end
with a reply line and Send. On desktop the reply line SHALL be typed in the peek
itself and typing while a peek is pinned SHALL go to it. On the phone layout
tapping the reply line SHALL grow World's own terminal composer in place, with
its keys, attachments and the draft it shares with the pane's terminal, and the
composer SHALL stay visible above the keyboard while the screen lines shrink.
The peek's Terminal action, and the composer's Direct mode, SHALL open the
pane's full terminal. The peek's Inspector action SHALL open World's Inspector
on the agent's Files view, from which Changes and History are one tap away,
using the same path as the shell's Actions menu. Answers and replies SHALL be
sent only to the exact qualified pane, and the result SHALL be confirmed by a
short notice; a finished agent SHALL announce itself once.

#### Scenario: Reply from a desktop peek

- **WHEN** the user types in a waiting agent's peek and presses Send
- **THEN** the text and Enter reach that agent's pane and the terminal does not
  open

#### Scenario: Reply to a waiting agent on a phone

- **WHEN** the user taps the reply line in a waiting agent's peek
- **THEN** the peek shows World's composer for that pane without opening the
  terminal, and the keyboard does not cover the message field or Send

#### Scenario: Open the Inspector from a peek

- **WHEN** the user taps Inspector in an agent's peek
- **THEN** World's Inspector opens on that agent's Files view

### Requirement: Town desk and agent moves

Town SHALL let the user move a desk to a free spot in another room of the same
host and move an agent pane to a free seat at another desk of the same host, by
dragging and by a visible Move action. A request SHALL be qualified by connection
ID and runtime generation and SHALL be refused across hosts, for retired
generations, or when the runtime does not offer pane moves. Before sending any
move, a desk move SHALL capture the source tab's complete split tree, including
each split's direction and ratio, and SHALL refuse the move without mutation if
any source pane is missing or the tree does not account for every pane. It SHALL
then move the captured tree's first pane to a new tab in the target workspace and
replay the captured tree by moving each remaining pane into that tab with its
captured direction and ratio, confirming each step from Herdr before the next.

Because a move can replace a pane's operational ID, World SHALL record each
confirmed replacement from `pane.moved` and SHALL address every later split
target, rollback step and Town target by the current ID, including any further
replacement during rollback. If a step fails, World SHALL move the already-moved
panes back into the original tab using their current IDs and report the outcome.
It SHALL NOT retry an uncertain step, and if rollback fails it SHALL report the
actual resulting topology.

An agent move SHALL be a single confirmed pane move into the target tab with its
replacement ID recorded. While a move is pending, Town SHALL reserve the source
and target spots; the final placement SHALL follow confirmed Herdr topology.

#### Scenario: Move a desk to another room

- **WHEN** the user drags a three-pane desk to a free spot in another room of the same host
- **THEN** World captures the desk's split tree before moving anything, moves the
  three panes into one new tab in that workspace with the same split directions
  and ratios, shows the desk at the target spot after Herdr confirms, and the
  agents keep their agent identities while Town follows each replacement pane ID

#### Scenario: A moved pane receives a new ID

- **WHEN** Herdr confirms the first pane of a desk move with a different `pane_id`
  than its `previous_pane_id`
- **THEN** World addresses the next split and any rollback by the new ID, and
  Town's seat, peek and terminal targets for that agent use the new ID

#### Scenario: A source pane disappears before the move

- **WHEN** a pane of the selected desk closes between the user's drop and the
  capture of the split tree
- **THEN** World sends no pane move, the desk stays in place, and the user sees
  that the move could not start

#### Scenario: A desk move fails part-way

- **WHEN** Herdr rejects the second pane move of a three-pane desk
- **THEN** World moves the first pane back into the original tab by its current
  ID, Town returns
  the desk to its original spot, and the user sees that the move failed

#### Scenario: Drop on another host

- **WHEN** the user drops a desk over another host's building
- **THEN** no Herdr operation is sent, the desk returns to its spot, and Town
  explains that desks move only within one host

#### Scenario: Move an agent to another desk

- **WHEN** the user moves an agent to an empty seat at another desk in the same host
- **THEN** World moves exactly that pane into the target tab and the agent sits at
  the chosen seat after Herdr confirms

### Requirement: Town agent identity

Town SHALL derive an agent's identity from its connection profile and the agent
session identity reported to Herdr when present, and otherwise from its qualified
pane. Its appearance SHALL be a deterministic function of that identity. The agent
profile SHALL show only figures backed by authoritative state or an optional
provider and SHALL identify figures that are unavailable.

#### Scenario: An agent's pane moves

- **WHEN** an agent with a reported session identity moves to another desk
- **THEN** it keeps the same appearance and profile identity

#### Scenario: No session identity is reported

- **WHEN** an agent pane reports no session identity
- **THEN** Town uses the qualified pane identity and does not merge it with another agent

### Requirement: Room project signals

A room status card SHALL reserve a line for project signals, such as open pull
requests, the latest deployment and spend, supplied by optional providers mapped
to that workspace. Town SHALL omit the line when no provider supplies values and
SHALL convey a failed deployment with text as well as colour.

#### Scenario: Provider supplies deployment status

- **WHEN** a configured provider reports a failed deployment for a workspace
- **THEN** that room's card shows the failure in text and colour and its room card details show the same value

#### Scenario: No project provider

- **WHEN** no provider supplies project signals for a workspace
- **THEN** its room card shows no project line and no placeholder values

### Requirement: Town targets, motion and phone layout

Town SHALL provide keyboard- and pointer-accessible semantic targets for
buildings, rooms, desks, seats, agents, reception entries and rail entries, with
names that include status text. Compact targets inside desks and the reception
SHALL be at least 24 by 24 CSS pixels and other targets at least 48 by 48. Every
gesture SHALL have a visible control. Town SHALL honour reduced-motion
preferences and offer a calm setting that removes ambient motion and shortens
camera moves. On phones, Town SHALL keep one vertical navigation direction,
open peeks as a sheet above the tray, and close the peek, card and terminal
through the shared system Back behaviour. Town SHALL keep the established input
acknowledgement budgets at the dense fixtures and at three hosts with eight rooms,
fifteen desks per room and four panes per desk.

#### Scenario: Navigate Town by keyboard

- **WHEN** a keyboard user moves through Town targets
- **THEN** each building, room, desk, seat and agent is reachable with a name that
  includes its status, and activating it performs the same action as a pointer

#### Scenario: Use Town on a phone

- **WHEN** the user opens Town at a 390 px width
- **THEN** buildings are stacked vertically, room cards and the reception board are
  readable, the tray stays at the bottom, and Back closes an open peek before leaving Town

#### Scenario: Maximum observed scale

- **WHEN** three hosts present eight rooms each with fifteen desks of four panes
- **THEN** Town renders every room and keeps terminal input acknowledgement within the established budgets

### Requirement: Town within the World shell

Town SHALL be a separate World view next to Office, with its own route and
entries in the shell's view switcher and phone navigation; Office SHALL keep the
Pixel Office scene unchanged. Town SHALL render inside the shared World shell and
SHALL NOT add a second application top bar. Its attention rail SHALL live inside
the Town view and be hideable there. Town search, settings and full terminals
SHALL use the shell's search, common menu and shared Inspector, so a terminal
opened from Town remains the same presentation after switching views.

#### Scenario: Switch from Town to Graph with a terminal open

- **WHEN** the user opens an agent's terminal from a Town peek and switches to Graph
- **THEN** the shell's view switcher changes the view and the same qualified
  terminal presentation remains open without being recreated

#### Scenario: Switch views on a phone

- **WHEN** the user is in Town on a phone
- **THEN** the shell's bottom navigation remains available to switch to Office,
  Graph, Desk or Spaces, and the Town tray sits above it

#### Scenario: Office is unchanged

- **WHEN** the user opens Office after Town is added
- **THEN** Office shows the Pixel Office scene, settings and room actions it had
  before
