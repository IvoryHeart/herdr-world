## ADDED Requirements

### Requirement: Complete Office content with bounded viewport rendering

Office SHALL provide logical rooms, tab desks and room-agent positions for all
entities in the admitted filtered World observation, without fixed Office-owned
room, tab or room-agent totals. Room height SHALL grow with tab and standing-row
content on desktop and phones. Rendering, physical surfaces and semantic-control
admission SHALL remain bounded around the viewport, including inside a large room.
Scrolling or revealing later items SHALL NOT require rendering all preceding items
or allocating a surface for the full logical room.

Every pane SHALL retain its exact qualified target. Multiple agents or panes in
one tab SHALL retain one tab desk, separate selectable pane targets and the
established deterministic seated occupant with additional room agents standing.
The existing compact device artwork and complete pane chooser SHALL remain usable.

#### Scenario: Room grows beyond its former bounds

- **WHEN** a workspace contains nine, twelve or one hundred tabs and more than
  sixteen room-destination agents
- **THEN** every observed tab and room agent has reachable logical geometry,
  additional rows grow that room independently, and painting remains bounded

#### Scenario: Reach a room beyond the former scene cap

- **WHEN** more than 128 workspaces are in the admitted filtered observation
- **THEN** a later workspace and its tabs remain reachable without replacing the
  old room cap with a larger fixed Office total or inventing unobserved entities

#### Scenario: Reveal a late desk in a very tall room

- **WHEN** a user reveals the last observed tab in a room much taller than the
  viewport or native backing limits
- **THEN** its row and qualified controls become usable without preparing the
  whole room, losing earlier logical content or exceeding physical surface bounds

#### Scenario: Share one desk among panes and agents

- **WHEN** one tab has more than four panes and several working agents
- **THEN** its desk remains one tab, all exact pane targets remain available and
  the additional room agents have distinct reachable standing targets

### Requirement: Office room navigation and presentation continuity

Office SHALL provide reachable room navigation and collapse/expand controls on
phones and desktop. Collapsing a room SHALL retain its qualified header and exact
observed counts without changing native work, agent state or Inspector ownership.
Choosing an offscreen room or entity SHALL expand and reveal it as needed before
focusing or activating its matching semantic target.

Observation refreshes and additions above the viewport SHALL preserve the visible
qualified room/row anchor when it still exists. Responsive layout changes and
invalid or legacy scroll preferences SHALL produce a valid position in the new
layout. Rendered and semantic geometry SHALL agree before activation; stale or
replaced runtime targets SHALL remain non-actionable without another-host fallback.

#### Scenario: Skip past a large room

- **WHEN** a phone user is in a 100-desk room and selects a later workspace from
  the reachable room navigation
- **THEN** the later room is revealed without traversing every earlier desk,
  horizontal swiping or opening another workspace's Inspector

#### Scenario: Collapse an active room

- **WHEN** a user collapses a room whose agent has an open terminal Inspector
- **THEN** the room retains its header and counts while the Inspector keeps the
  same qualified resources and native tabs continue running

#### Scenario: Refresh while a late row is visible

- **WHEN** an observation adds rooms or rows above the visible qualified row
- **THEN** that row remains the user's viewing anchor when still present and an
  existing focused control does not become another entity

#### Scenario: Reveal retires during preparation

- **WHEN** an offscreen entity's runtime retires before its new geometry and
  semantic target are ready
- **THEN** the obsolete target cannot activate or open a replacement host's or
  generation's equal identifier

## MODIFIED Requirements

### Requirement: Pixel Office scene

Office SHALL preserve the Pixel Office artwork and spatial composition, with
qualified host receptions, status and optional-observability boards, a separate
Agent Bar, work rooms, tab desks and agent characters. Desktop SHALL retain its
CEO Office, user/CEO, reception tables, Agent Bar counter and rear shelf, roads
and independently content-sized workspace rooms. Work rooms SHALL represent real
Herdr workspaces, desks SHALL represent observed tabs, and scene relocation SHALL
NOT change authoritative host or workspace ancestry.

Phone Office SHALL use one vertical flow: receptions with waiting or completed
agents needing attention, Economy, Workforce, then workspace rooms. Empty receptions SHALL be absent
from the phone scene. Host order SHALL remain stable among attention receptions;
reordering SHALL preserve qualified identities. Workforce SHALL retain observed
agent-state counts rather than inventing metrics. Neither reception navigation nor navigation between rooms
SHALL require horizontal scrolling. The decorative CEO room SHALL be absent from
the phone layout; useful host status and access to reception and idle agents
SHALL remain available. Sections and room headers SHALL fit the usable viewport.
An unavailable optional expense provider SHALL NOT appear as invented zero cost.

Room geometry SHALL derive from complete admitted tab and room-agent content and
title/action requirements. Small rooms SHALL retain readable forms, and larger
rooms SHALL add desk and standing rows rather than truncate at eight desks or
sixteen room agents. Desktop desk and standing columns SHALL adapt to usable width and content,
without a four-column room restriction. Desktop SHALL pack independently sized
rooms into available openings, including multiple smaller rooms beside a tall
room, without shared tallest-room row spacing or corridors crossing rooms.
Room placement SHALL be deterministic for equal inputs and SHALL retain qualified
identities and logical roster order. Left/center/right alignment SHALL apply to
the packed footprint; phone rooms SHALL stack vertically within the viewport width. Title,
action and decoration containment, stable gaps and full-name access SHALL remain
available. A large room SHALL NOT enlarge unrelated rooms.

#### Scenario: Switch between hosts with unequal rooms

- **WHEN** several filtered managed hosts expose workspaces with different tab counts and title lengths
- **THEN** Office groups content-sized rooms under clearly identified hosts, preserving each room's
  qualified identity and required headers without equalizing unrelated rooms

#### Scenario: Compare the retained Pixel Office fixture

- **WHEN** the approved dense synthetic Office fixture is rendered through the migrated projection
- **THEN** ordinary desktop CEO Office, receptions, boards, Agent Bar, roads,
  rooms, desks, characters and labels retain their established pixel composition,
  while responsive phone ordering and larger rooms follow this requirement

#### Scenario: Render Office while Spaces is hidden

- **WHEN** Office is the active route and the mounted Spaces surface is not visible
- **THEN** the complete Office scene renders from its projection without reading or depending on
  Spaces layout DOM, while operational callbacks continue to use shell-owned services

#### Scenario: Office opens at a narrow width

- **WHEN** the viewport cannot contain the resolved logical Office width
- **THEN** the phone scene fits its usable width, attention receptions precede Economy and Workforce, empty receptions are absent, and workspace rooms follow Workforce; the shell
  does not require horizontal navigation

#### Scenario: Optional observation provider is unavailable

- **WHEN** no optional observation provider is configured or healthy
- **THEN** topology, rooms, terminals and authoritative Herdr state remain usable and Office does
  not invent cost, activity or completion data

#### Scenario: Configure an optional observation provider

- **WHEN** the user opens the World settings from any native view and saves a supported
  credential-free provider URL
- **THEN** the World service validates and applies it, reports bounded health and updates the
  relevant Office boards without exposing provider access or credentials to the browser

#### Scenario: Compare all host receptions on a phone

- **WHEN** more than six filtered hosts have observed receptions
- **THEN** each qualified reception needing attention is reachable by vertical scrolling
  before Economy, Workforce and workspace rooms, without a host carousel or
  six-host scene cap; empty receptions do not occupy phone scene space


#### Scenario: Fill a wide desktop beside a large room

- **WHEN** a desktop observation has a 100-tab room and many single-tab rooms
- **THEN** the large room uses a readable width-dependent desk grid, and smaller
  rooms fill available space alongside it on multiple levels without overlap
- **AND** viewport admission stays bounded by visible area, and resize retains
  qualified room access and the logical desk row instead of its old pixel row

### Requirement: Office reception capacity

Office SHALL provide one qualified reception for every filtered host in the
admitted observation. Reception content SHALL retain readable table, seat and
standing presentation with exact status and occupancy counts. Visible characters
and controls SHALL follow the paint window, and every observed reception agent
SHALL remain reachable through logical content or the exact qualified roster
without a fixed agent access cap. Compact targets SHALL remain distinct and at
least 24 by 24 CSS pixels.

#### Scenario: Reception fills

- **WHEN** blocked and done agents exceed a host reception's seats and standing
  characters currently admitted for painting
- **THEN** truthful counts and qualified roster or reveal controls preserve access
  to every observed reception agent without a giant backing allocation or a
  requirement to swipe to another host on phones

### Requirement: Office state and room operations

Office SHALL place working and unknown agents with their owning work room, blocked and done agents
at their qualified host reception, and idle agents in the Agent Bar. Reception SHALL use one shared
table per host for blocked and done agents, mark blocked agents with `?` and done agents with `✔`,
and keep the status available in text and accessible names rather than symbol or color alone. A
done agent's originating desk SHALL retain a bounded generic completion marker until that qualified
completion is inspected; this browser-local seen state SHALL NOT represent approval, mutate Herdr
or move a still-done agent to the bar.

Office SHALL retain bounded hover callouts, task summaries, state cues, at least 48 by 48 CSS-pixel
semantic targets outside compact desk and reception groups, and a compact Agents/Rooms/Desks chooser. Selected identity and detail SHALL live
in the shared Inspector rather than a duplicate persistent scene badge. Capability-gated room creation,
rename and close actions and room-local seat creation SHALL operate on real workspaces and tabs. A
room SHALL retain reachable creation controls whose availability follows the
qualified operation rather than its number of displayed desks.

Office SHALL expose a persisted Inspector opening preference with Docked and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved. In
Docked mode, a newly opened Office entity SHALL use the single docked Inspector and remain available
for explicit Dock out. In Floating mode, each newly opened Office entity SHALL use its own
cascaded floating Inspector without a fixed presentation-count cap. Changing the preference SHALL
govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
existing entity SHALL focus its current presentation.

When several working or unknown room-destination agents share one tab, Office SHALL choose at most
one deterministic seated occupant using the established state/focus priority and SHALL present
remaining room-local agents with reachable standing geometry. Every observed tab
SHALL have a logical desk; a desk outside the paint window SHALL NOT remove its
room agents or pane targets from the logical room. Blocked and done agents SHALL
remain at their qualified reception, idle agents SHALL remain accessible through
the Agent Bar or its phone control, and upstream observation omissions SHALL
retain their exact relevant counts. Presented desks and agents SHALL keep
distinct, nonduplicated semantic targets.

#### Scenario: Agent status changes location

- **WHEN** an admitted agent changes from working to blocked, then done, and later idle
- **THEN** the same qualified agent moves from its room to reception with `?`, stays at reception
  with `✔` while done, and moves to the Agent Bar only when idle, while its ancestry, selection and
  terminal identity remain stable

#### Scenario: Choose the default Office Inspector presentation

- **WHEN** the user selects Docked or Floating in the common settings menu and opens new Office
  entities
- **THEN** Docked reuses the single docked target, Floating opens distinct bounded cascaded windows,
  existing presentations remain in place and the preference is restored on the next Office visit

#### Scenario: Use Office controls on compact or Zen layouts

- **WHEN** the user needs room alignment, long-title, Inspector-opening or observability settings
- **THEN** the common menu exposes them without an Office toolbar or shortcut strip consuming scene
  space

#### Scenario: Create a seat in a room

- **WHEN** the room's owning host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room, shows the desk only after Herdr
  admits the resulting tab and pane, retains the live Office instance across that topology update,
  and boundedly retries exact qualified focus until it opens the new Inspector on Terminal with the
  created pane selected and its multi-pane state visible, or the originating lease becomes invalid

#### Scenario: Seat creation is cancelled or fails

- **WHEN** the user cancels seat creation or the launcher fails before Herdr admits a new pane
- **THEN** Office preserves the prior selection, focused Inspector context and every existing
  qualified conversation window across admitted hosts without detaching or redirecting input

#### Scenario: Mixed-state agents share a tab or exceed the desk bound

- **WHEN** working or unknown agents share a tab or belong to a ninth or later tab while blocked,
  idle or done agents occupy the same tab or overflow range
- **THEN** Office seats at most one deterministic room-local occupant per visible desk, presents
  remaining room-local agents with reachable standing geometry, keeps blocked and
  done agents at reception and idle agents accessible through the Agent Bar or
  its phone control, reports exact observed counts and exposes no duplicate target

#### Scenario: User inspects a completion

- **WHEN** the user selects a completion marker, originating desk, notice or corresponding agent
- **THEN** Office opens or focuses the exact qualified terminal and marks that completion seen only
  after activation succeeds, without moving the still-done agent from reception

#### Scenario: Completion activation is unavailable

- **WHEN** a completion target is stale, incompatible or cannot be opened
- **THEN** Office retains its unseen marker and bounded notice, explains that inspection is
  unavailable and does not treat selection as acknowledgement

#### Scenario: Several completions arrive

- **WHEN** several distinct completions are admitted before the user inspects them
- **THEN** Office deduplicates repeated evidence for the same completion and retains a bounded,
  individually targetable presentation for the distinct unseen completions

#### Scenario: Room action is unavailable

- **WHEN** a room is stale, its owning runtime rejects the operation or its host
  lacks the required capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation

### Requirement: Office creation affordances follow operational capacity

Office's drawn creation affordances, their semantic browser controls and shared
Actions SHALL agree on the qualified operation's availability, progress, cursor
and unavailable explanation. Temporary scene-layout readiness SHALL be distinct
from connection, source and capability unavailability.

The number of painted desks SHALL follow a bounded viewport window rather than
a fixed room total. Creating another admitted tab SHALL extend the workspace's
logical room when needed, retain a reachable creation control and present the new
terminal through shared qualified completion. Counts SHALL distinguish offscreen
logical content from unavailable or omitted observations. Scene capacity SHALL
NOT prohibit the qualified creation.

#### Scenario: A room already renders eight desks

- **WHEN** a ready workspace already has eight or more logical desks and the
  user activates its creation control
- **THEN** World creates another admitted tab, extends the logical room as needed
  and opens its exact terminal while preserving bounded viewport rendering

#### Scenario: Canvas and browser control change readiness

- **WHEN** a room's source preparation or availability changes
- **THEN** its drawn plus and semantic control expose consistent availability and
  pointer feedback, with an explanation reachable on touch devices

#### Scenario: Scene geometry is being updated

- **WHEN** Office temporarily lacks matching rendered and semantic geometry
- **THEN** it prevents stale canvas activation, distinguishes this rendering state
  from runtime failure and keeps the shared creation menu usable
