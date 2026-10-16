## ADDED Requirements

### Requirement: Office town scene

Office SHALL present a town in which each presented host is one building along a
road, each admitted Herdr workspace of that host is a room on a carpet inside its
building, and each admitted tab is a desk in its room. A desk SHALL be a table
with one seat per admitted pane up to four drawn seats; an agent pane SHALL show
its agent character at its seat while seated, and a non-agent pane SHALL show a
screen without a character. Panes beyond the drawn seats SHALL remain
individually reachable through an exact count and chooser. Each building SHALL
contain a lounge and a reception, and the reception SHALL show the user behind
its counter. Scene position SHALL NOT change an entity's authoritative host,
workspace, tab or pane ancestry.

A building for a host whose topology is cached after failure SHALL be visibly
stale and its entities SHALL be non-actionable. Office SHALL NOT invent activity,
cost, completion or project data when no authoritative state or optional provider
supplies it.

#### Scenario: Several hosts with different workspaces

- **WHEN** three filtered hosts expose different numbers of workspaces, tabs and panes
- **THEN** Office shows three buildings, each containing exactly its host's rooms,
  desks and seats with qualified identities, and no room appears in another host's building

#### Scenario: A tab has more panes than drawn seats

- **WHEN** a tab contains six admitted panes
- **THEN** its desk draws four seats, shows the exact count of six, and the two
  remaining panes stay individually selectable through the chooser

#### Scenario: A host's runtime fails

- **WHEN** a presented host's connection fails and Office retains its cached topology
- **THEN** its building is marked stale, its desks and agents cannot start
  operations, and other buildings remain fully usable

#### Scenario: No observation provider is configured

- **WHEN** no optional provider supplies cost, activity or project data
- **THEN** Office shows authoritative Herdr state only and omits or labels the
  unavailable figures instead of showing estimates

### Requirement: Stable Office placement

Office SHALL derive room order from Herdr's native workspace order and desk order
from native tab order within each host. A room's capacity SHALL step through a
bounded set of grid sizes that always leaves at least one free desk spot. While a
scene is live, a topology change SHALL NOT move an existing desk to another spot
or reorder rooms: a new tab SHALL take the first free spot of its room, a closed
tab SHALL free its spot, and a room that reaches a new capacity step MAY shift
later rows of the same building without reordering rooms. Placement SHALL be
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

### Requirement: Office zoom levels

Office SHALL present town, overview, room and desk levels over the same
placement, selected by on-screen size. The town level SHALL show roofs with host
summaries. The overview level SHALL show one status card per room with its name,
desk count, working count, a status distribution, a waiting count when non-zero
and a project signal line when a provider supplies one, plus one reception board
per host showing waiting agents. The room level SHALL show tables with a status
mark per seat. The desk level SHALL show characters, screens and animation with
per-seat targets. Waiting attention SHALL be visible at every level. Status SHALL
be conveyed by text or accessible names in addition to colour. The desktop
default view SHALL fit every presented building at the overview level; the phone
default view SHALL fit the first building's width.

Activating a room at the overview or room level SHALL zoom to that room, and a
double tap or double click SHALL zoom in at its location. Zoom controls SHALL
remain available as visible buttons.

#### Scenario: Read the whole office at a glance

- **WHEN** the user opens Office on a desktop with three hosts and twenty-four rooms
- **THEN** every room's status card and every host's reception board are visible
  without panning, and rooms with waiting agents show their waiting count

#### Scenario: Zoom from a room card to its desks

- **WHEN** the user activates a room's status card
- **THEN** Office zooms to that room and its tables, seats and agents become
  individually targetable

#### Scenario: Zoom out past the overview

- **WHEN** the user zooms out beyond the fit-all view
- **THEN** roofs cover the buildings and each roof shows its host's room and desk
  counts while the reception boards keep showing waiting agents

### Requirement: Office agent locations

Office SHALL seat working and unknown agents at their pane's seat. A blocked agent
SHALL move to its host's reception and queue in order of when it became blocked,
oldest first, within a bounded number of queue positions; further blocked agents
SHALL stay at their seat with a waiting cue and the reception SHALL show the exact
overflow count. A done agent SHALL remain at its seat with a completion marker
until that qualified completion is inspected; this browser-local seen state SHALL
NOT represent approval or mutate Herdr. An idle agent SHALL move to a lounge spot
in its building or remain seated with an idle cue when no spot is free. When an
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
- **THEN** it stays at its seat with a completion marker until the user inspects
  that completion, and inspecting it does not change Herdr state

### Requirement: Office attention rail

Office SHALL present the agents that need the user in the same order as Desk
attention triage: blocked agents oldest first, then done agents newest first. On
desktop the list SHALL be a left rail grouped by host and then room, with
collapsible host groups, and the user SHALL be able to hide it to a count and
restore it; this choice SHALL persist per browser. On phones the list SHALL be a
bottom tray that remains reachable while a peek or card is open. Activating an
entry SHALL open that exact pane's terminal on desktop and its peek on phones;
activating a room entry SHALL zoom to that room. A keyboard command SHALL open the
next agent that needs the user.

#### Scenario: Work through waiting agents on desktop

- **WHEN** three agents in two hosts are blocked and the user presses the next-agent key repeatedly
- **THEN** Office opens each agent's exact terminal in age order and the rail
  reflects each answer without reordering unrelated entries

#### Scenario: Hide the rail

- **WHEN** the user hides the desktop rail and reloads Office
- **THEN** the rail stays hidden, shows the waiting count, and can be restored with one action

### Requirement: Office agent peek

Hovering an agent, a reception entry or a rail entry with a pointer SHALL open a
peek after a short delay, and tapping one SHALL open a pinned peek. The peek SHALL
show the agent's name, location and status, the latest bounded lines of its pane,
answer options only when the agent integration exposes a structured choice, a
reply box, and actions to open the terminal, open the profile and moves, and go to
the next waiting agent. While a peek is open, digit keys SHALL choose the
corresponding answer and other printable keys SHALL go to its reply box. Answers
and replies SHALL be sent only to the exact qualified pane through the existing
input path. If the target closes, moves away or its runtime generation retires,
the peek SHALL close or show it as unavailable and SHALL NOT send input elsewhere.
Opening the terminal from a peek SHALL follow the Inspector presentation preference.

#### Scenario: Answer from a hover

- **WHEN** the user hovers a waiting agent whose pane exposes a permission choice and clicks Yes
- **THEN** exactly that pane receives the answer, the agent becomes working, and
  no other pane receives input

#### Scenario: Reply by typing

- **WHEN** a peek is open and the user types a message and presses Enter
- **THEN** the message goes to that peek's exact pane without first clicking the reply box

#### Scenario: The target retires during a reply

- **WHEN** the peeked pane closes or its runtime generation retires before the reply is sent
- **THEN** World rejects the reply and does not redirect it to another pane, tab or host

#### Scenario: No structured choice is available

- **WHEN** a blocked agent's integration does not expose a structured choice
- **THEN** the peek offers the reply box and terminal action without guessed answer buttons

### Requirement: Office desk and agent moves

Office SHALL let the user move a desk to a free spot in another room of the same
host and move an agent pane to a free seat at another desk of the same host, by
dragging and by a visible Move action. A request SHALL be qualified by connection
ID and runtime generation and SHALL be refused across hosts, for retired
generations, or when the runtime does not offer pane moves. A desk move SHALL
move the tab's first pane to a new tab in the target workspace and then move each
remaining pane into that tab, confirming each step from Herdr before the next. If
a step fails, World SHALL move the already-moved panes back into the original tab
and report the outcome; it SHALL NOT retry an uncertain step, and if rollback
fails it SHALL report the actual resulting topology. An agent move SHALL be a
single confirmed pane move into the target tab. While a move is pending, Office
SHALL reserve the source and target spots; the final placement SHALL follow
confirmed Herdr topology.

#### Scenario: Move a desk to another room

- **WHEN** the user drags a three-pane desk to a free spot in another room of the same host
- **THEN** World moves the three panes into one new tab in that workspace, Office
  shows the desk at the target spot after Herdr confirms, and the agents keep their pane identities

#### Scenario: A desk move fails part-way

- **WHEN** Herdr rejects the second pane move of a three-pane desk
- **THEN** World moves the first pane back into the original tab, Office returns
  the desk to its original spot, and the user sees that the move failed

#### Scenario: Drop on another host

- **WHEN** the user drops a desk over another host's building
- **THEN** no Herdr operation is sent, the desk returns to its spot, and Office
  explains that desks move only within one host

#### Scenario: Move an agent to another desk

- **WHEN** the user moves an agent to an empty seat at another desk in the same host
- **THEN** World moves exactly that pane into the target tab and the agent sits at
  the chosen seat after Herdr confirms

### Requirement: Office agent identity

Office SHALL derive an agent's identity from its connection profile and the agent
session identity reported to Herdr when present, and otherwise from its qualified
pane. Its appearance SHALL be a deterministic function of that identity. The agent
profile SHALL show only figures backed by authoritative state or an optional
provider and SHALL identify figures that are unavailable.

#### Scenario: An agent's pane moves

- **WHEN** an agent with a reported session identity moves to another desk
- **THEN** it keeps the same appearance and profile identity

#### Scenario: No session identity is reported

- **WHEN** an agent pane reports no session identity
- **THEN** Office uses the qualified pane identity and does not merge it with another agent

### Requirement: Room project signals

A room status card SHALL reserve a line for project signals, such as open pull
requests, the latest deployment and spend, supplied by optional providers mapped
to that workspace. Office SHALL omit the line when no provider supplies values and
SHALL convey a failed deployment with text as well as colour.

#### Scenario: Provider supplies deployment status

- **WHEN** a configured provider reports a failed deployment for a workspace
- **THEN** that room's card shows the failure in text and colour and its room card details show the same value

#### Scenario: No project provider

- **WHEN** no provider supplies project signals for a workspace
- **THEN** its room card shows no project line and no placeholder values

### Requirement: Office targets, motion and phone layout

Office SHALL provide keyboard- and pointer-accessible semantic targets for
buildings, rooms, desks, seats, agents, reception entries and rail entries, with
names that include status text. Compact targets inside desks and the reception
SHALL be at least 24 by 24 CSS pixels and other targets at least 48 by 48. Every
gesture SHALL have a visible control. Office SHALL honour reduced-motion
preferences and offer a calm setting that removes ambient motion and shortens
camera moves. On phones, Office SHALL keep one vertical navigation direction,
open peeks as a sheet above the tray, and close the peek, card and terminal
through the shared system Back behaviour. Office SHALL keep the established input
acknowledgement budgets at the dense fixtures and at three hosts with eight rooms,
fifteen desks per room and four panes per desk.

#### Scenario: Navigate Office by keyboard

- **WHEN** a keyboard user moves through Office targets
- **THEN** each building, room, desk, seat and agent is reachable with a name that
  includes its status, and activating it performs the same action as a pointer

#### Scenario: Use Office on a phone

- **WHEN** the user opens Office at a 390 px width
- **THEN** buildings are stacked vertically, room cards and the reception board are
  readable, the tray stays at the bottom, and Back closes an open peek before leaving Office

#### Scenario: Maximum observed scale

- **WHEN** three hosts present eight rooms each with fifteen desks of four panes
- **THEN** Office renders every room and keeps terminal input acknowledgement within the established budgets

### Requirement: Office within the World shell

Office SHALL render as a view inside the shared World shell and SHALL keep the
shell's existing view switching between Office, Graph, Desk and Spaces on desktop
and phone. Office SHALL NOT add a second application top bar. On desktop, the
Office attention rail SHALL occupy the shell's left sidebar slot while Office is
active and SHALL use the sidebar's hide control. Office search, settings and
terminals SHALL use the shell's search, common menu and shared Inspector, so a
terminal opened from Office remains the same presentation after switching views.

#### Scenario: Switch from Office to Graph with a terminal open

- **WHEN** the user opens an agent's terminal from an Office peek and switches to Graph
- **THEN** the shell's view switcher changes the view and the same qualified
  terminal presentation remains open without being recreated

#### Scenario: Switch views on a phone

- **WHEN** the user is in Office on a phone
- **THEN** the shell's bottom navigation remains available to switch to Graph,
  Desk or Spaces, and the Office tray sits above it

## REMOVED Requirements

### Requirement: Pixel Office scene

**Reason**: The CEO Office, Agent Bar and road-separated room bands are replaced
by the Office town, and content-packed room geometry is replaced by stable
placement.

**Migration**: See Office town scene, Stable Office placement and Office zoom
levels. Qualified identity, stale-host and provider-absent behaviour carry over.

### Requirement: Office pane-linked devices

**Reason**: Pane devices around a desk are replaced by one seat per pane at a team
table.

**Migration**: See Office town scene. Exact pane targets, counts and chooser
access for undrawn panes carry over.

### Requirement: Office reception capacity

**Reason**: Reception becomes a queue for blocked agents only.

**Migration**: See Office agent locations. The bounded presentation with an exact
overflow count and roster access carries over.

### Requirement: Office state and room operations

**Reason**: Agent locations change (done agents stay at their desk and idle agents
use the lounge instead of the Agent Bar), and room operations gain moves.

**Migration**: See Office agent locations, Office attention rail, Office agent peek
and Office desk and agent moves. The browser-local seen rule, capability-gated room
and seat creation through the shared creation coordinator, and the Docked/Floating
Inspector preference carry over unchanged.
