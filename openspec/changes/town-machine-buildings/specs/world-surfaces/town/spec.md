## MODIFIED Requirements

### Requirement: Town scene

Town SHALL present a town in which each presented host is one building along a
road, each admitted Herdr workspace of that host is a room on a carpet inside its
building, and each admitted tab is a desk in its room.

By default the runtimes of one machine (its Herdr TUI and herdr-core) SHALL
share one building through a display-only building key, each room naming its
runtime there; a browser-local Town buildings setting (one per machine, the
default, or one per runtime) SHALL restore a building per runtime. The building
key SHALL NOT change any entity's host key, qualified references or actions,
which stay on the owning connection and generation. Two Herdr TUI connections
to one endpoint SHALL present its rooms once, preferring the writable
connection.

#### Scenario: One machine, two runtimes, a duplicated connection

- **WHEN** a machine has two Herdr TUI connections to one socket and a
  herdr-core, and Town buildings is one per machine
- **THEN** Town shows one building for the machine with each TUI room once and
  every core room, each room naming its runtime
- **AND** each room's Move handle, arrows, Rename, Close and New agent act on
  its own runtime's connection and generation

#### Scenario: Town scene acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** A desk SHALL be a table
  with one seat per admitted pane up to four drawn seats, sized to its panes: a
  one-pane desk SHALL be a solo desk, a two-pane desk a small table with one seat on
  each side, and three or four panes a four-seat team table; an agent pane SHALL show
  its agent character at its seat while seated, and a non-agent pane SHALL show a
  screen without a character. Panes beyond the drawn seats SHALL remain
  individually reachable through an exact count and chooser. Each building SHALL
  contain a lounge and a reception, and the reception SHALL show the user behind
  its counter. Scene position SHALL NOT change an entity's authoritative host,
  workspace, tab or pane ancestry.

  A room's nameplate SHALL fit within its projected room width with padding.
  Only the name SHALL truncate, at its end, with the full name available as a
  tooltip and accessible label. The leading editable colour swatch, ACTIVE/TOTAL
  agent count and trailing blocked badge SHALL retain their contents. ACTIVE SHALL
  sum the room's existing per-agent working and blocked semantic status counts,
  as used by the Town board. TOTAL SHALL count its canonical observed agents,
  including done, idle and unknown reports, and exclude plain terminals. Done or
  finished agents (seen or unseen), idle agents and unknown agents SHALL NOT count
  as active. Needs-you items such as open asks SHALL NOT add to either agent count.
  The counter SHALL explain its working/waiting breakdown in a tooltip and accessible
  label. Its numerals SHALL be tabular, its total fraction muted, and its whole count
  muted when ACTIVE is zero; it SHALL stay fixed ahead of the blocked badge while
  only the room name truncates. One card SHALL
  appear below the plate on hover or keyboard focus, and on a touch of the plate:
  the Town board's numbers for that room without its agents list (working,
  needs-you, finished and quiet counted as the board counts them, its agents,
  and its economy today from the harness usage of its exactly qualified Herdr
  workspace), then Rename and Close with targets at least 40 CSS
  pixels wide and tall. These controls SHALL NOT reserve name width while hidden.
  A table's nameplate SHALL open the same kind of card for that table on hover,
  focus or a touch, from the same summary read model and the usage of its
  exactly qualified Herdr tab. The card SHALL read usage only once opened. Hovering the table itself
  on the canvas SHALL open that card without covering the table; on a touch
  screen, one tap on a table with a live default pane SHALL open that pane; on
  any other table, a tap whose card is closed SHALL open the card instead, and a
  second tap SHALL do what a tap does. Opening a table SHALL open its default
  pane: its only pane, else its focused pane, else an agent there that needs the
  user, else its most recently active pane; only a table with more panes than
  drawn seats and none focused SHALL open the chooser.
  Live Herdr TUI and herdr-core tables and panes SHALL open alike, by the Agents
  open preference; a view-only reason SHALL appear only on the review controls it
  limits, never as a refusal to open. At the
  overview level, where rooms show cards instead of plates, a mouse anywhere over
  a room or its card SHALL show the room's numbers, as its plate's card does,
  below its card without taking the pointer from the town. The dashed empty-seat **+** inside a room
  SHALL open the existing launcher with that qualified room selected; Terminal
  SHALL be its first choice for a plain tab, alongside profiles and agent kinds.
  The plate SHALL NOT contain a separate New agent text button. If the selected
  room or captured generation is unavailable, the launcher SHALL require a deliberate
  choice of a current room before creation; an unqualified launcher entry MAY default
  to an available room.

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
from Herdr's tab list order within each workspace, which Herdr keeps when a tab
moves (a tab's number is not its position).

#### Scenario: Stable Town placement acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Desk slot i of a room SHALL be the
  room's i-th drawn tab, in reading order, so a reorder in Herdr, Spaces or Town
  moves desks. A room's capacity SHALL step through a
  bounded set of grid sizes that always leaves at least one free desk spot, or two
  adjacent action spots while Fold is available: a room grows square until it
  reaches its shape's width (four desks on a phone, six on
  portrait and mid-width screens, eight on wide screens) and then extends
  downward, and its building grows around it. A folded room SHALL use a native-order
  prefix of 24 desks. Each Expand action SHALL raise the room's target by about 20
  desks, up to all observed desks; Fold SHALL restore the 24-desk target in one
  action and allow the room to shrink, while retaining pinned cells and its
  building column. There SHALL be no hard expanded desk ceiling: repeated Expand
  actions SHALL eventually reveal every observed desk. While partially expanded,
  the room SHALL offer Fold alongside Expand, with separate non-overlapping targets
  of at least 40 CSS pixels, so one Fold click can restore the folded target at any step.
  An ordinary or explicitly expanded room's size SHALL follow its current desks
  and shrink when tabs close. An expanded room SHALL remain expanded after
  closures, including at or below 24 desks, until the user folds it. A folded
  room SHALL show exactly the first 24 observed tabs
  (or all tabs when fewer exist) in the same native tab order as Spaces. Each
  expansion SHALL append the next native-order prefix of up to 20 tabs. Activity,
  selection, pins and recent tabs SHALL NOT promote later tabs across this boundary.
  Changing agent status SHALL NOT change which tabs are shown. Existing pins MAY
  retain the cells of admitted desks, but SHALL NOT admit hidden tabs.
  Town SHALL count every currently hidden desk on its bottom-right **» +N** tile,
  beside the same-height new-seat tile, using two reserved cells without overlap.
  The tile SHALL show a red exclamation at its top-left when hidden desks have
  blocked calls or open questions from placed, qualified asking identities, and
  a green tick at its top-right when hidden desks have unreviewed completions.
  These indicators SHALL use Town's shared attention calls after the finished/seen overlay
  and the indexed qualified Ask source, not raw done status or actor labels. They
  SHALL have accessible descriptions and no extra visible numbers, and SHALL clear
  when those desks are revealed or their attention items are removed or reviewed.
  The room plaque SHALL continue to count agents across all tabs, including hidden ones.
  Zooming into a room taller or wider than the usable view, from its
  card or with Zoom in, SHALL open at its first desks. While a
  scene is live, a topology change SHALL NOT reorder rooms or move a desk to
  another room: a tab Herdr adds last SHALL take the first free spot of its room
  without moving other desks, and a closed tab SHALL leave no gap: the desks after
  it in reading order SHALL close up in their existing order while the desks
  before it keep their spots. A room that reaches a new capacity step MAY shift
  later rooms and rows of the same building without reordering rooms, and its
  desks MAY reflow to the step's columns. Ordinary and explicitly expanded rooms
  SHALL resize to their current desk count; expanded rooms SHALL retain their
  expanded state until Fold. Room placement SHALL be re-derived from native order when the scene is
  rebuilt. Town SHALL take its shape from its container's size rather than one
  breakpoint: on a phone, rooms up to four desks wide SHALL form three columns,
  spread across the building rather than one long column, and buildings SHALL
  stack in one vertical column; on a portrait screen or a half-width window, rooms
  SHALL be up to six desks wide and buildings SHALL stack (or share a street when
  the window is landscape); on a wide screen, rooms SHALL be up to eight desks
  wide and buildings SHALL share one street. Outside phones, each building SHALL
  choose its rooms per row from its rooms' count and sizes so its floor is close
  to square (about 1:1 to 4:3, wider than tall), up to what fits the view's width
  (two to five), so a small building stays compact and a large one gets more
  columns. A browser-local Rooms per row setting (Auto, 2, 3, 4 or 5; Auto by
  default) SHALL apply a chosen count to every building, phones included, live
  and without a reload. Rooms SHALL fill their building's columns in workspace
  order, and while a scene is live each room SHALL keep its column while its
  building's rooms per row stays the same, so a room that grows moves only the
  rooms below it in that column. Rooms without a saved spot SHALL fill the
  building's rows around rooms that have one, so a saved spot never narrows a
  building below its rooms per row. The lounge SHALL stay
  above the rooms, and the lobby and reception below them. A reflow that would move rooms
  or buildings due to background topology changes SHALL wait while the user
  presses, scrolls or zooms and until a short pause after, and the camera SHALL
  then follow the room in view so it stays where it was. An explicit Fold or
  Expand request SHALL apply its admitted desks and layout immediately, without
  waiting for that ambient quiet period.

#### Scenario: A large building stays about square

- **WHEN** Town is about 1100 px wide and a host's building holds about twenty
  rooms, one of them moved to a saved spot
- **THEN** on Auto the building takes more than two rooms per row and its floor
  is about square, and the moved room keeps its spot
- **AND WHEN** the user sets Rooms per row to 4 and then to 2
- **THEN** the building reflows to four and then two rooms per row at once

#### Scenario: A user expands while the reflow guard is active

- **WHEN** the user taps Expand or Fold during the interaction quiet period
- **THEN** the requested room layout updates without waiting for that period
- **AND** a subsequent background topology change still waits for a pause

#### Scenario: A tab is created while the user watches

- **WHEN** a new tab is admitted in a room that has free spots
- **THEN** the new desk appears in the first free spot and every other desk and
  room keeps its position

#### Scenario: A tab closes in the middle of a room

- **WHEN** a tab whose desk sits between other desks closes
- **THEN** the desks after it close up in order, the desks before it keep their
  spots, and the room keeps no empty gap

#### Scenario: An ordinary room shrinks after a tab closes

- **WHEN** a tab closes in an ordinary room
- **THEN** the room resizes to fit its remaining desks

#### Scenario: An expanded room shrinks after tab closures

- **WHEN** tabs close in an explicitly expanded room
- **THEN** its room resizes to fit its remaining desks and stays expanded
- **AND WHEN** the user folds the room
- **THEN** it shows its folded desks while retaining pinned cells and its
  building column

#### Scenario: A room fills its capacity step

- **WHEN** a room's last free spot is taken
- **THEN** the room grows to the next capacity step with a free spot, rooms keep
  their order, and desks keep their room and their order

#### Scenario: Agents fill a room past its old size

- **WHEN** a room has 24, 50 or 100 tabs
- **THEN** a 24-tab room draws a desk for every tab, and a larger room draws its
  24 busiest and newest desks with Expand on its plaque
- **AND WHEN** the user expands the 100-tab room
- **THEN** it extends and draws a desk for every tab, the newest included, on a
  phone, a half-width window, a wide screen and a portrait monitor, and Fold
  returns it to 24

#### Scenario: A room grows while the user watches

- **WHEN** a room gains enough tabs to grow while the user holds the town
- **THEN** no room or building moves until the user lets go and pauses, and
  then the rooms below it in its column move down while the room in view stays
  where it was

#### Scenario: Tabs are reordered outside Town

- **WHEN** the user moves a tab to the front of its workspace in Spaces or in
  Herdr
- **THEN** that tab's desk takes its room's first slot and the desks before its
  old slot shift one slot on, once Herdr reports the new order

