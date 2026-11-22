# World town

## Purpose

Define the user-facing town contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Shared Town and Board fact projections

Town and Board SHALL offer Attention, Idle time, Spend, Pull requests, Quests and
Harness lenses from the same qualified facts.

#### Scenario: Shared Town and Board fact projections acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Missing data SHALL remain distinct
  from zero. Choosing a lens SHALL change presentation without changing agent
  state or placement. Town search SHALL mark and frame admitted matches while
  retaining navigation to them; offscreen attention arrows and Next SHALL open
  the same qualified agent as the shared attention list. Working-agent thought
  bubbles SHALL use current reported work, without inventing work for unknown agents.

#### Scenario: A fact is unavailable or a host becomes stale

- **WHEN** a lens has no current usage, activity or linked-work fact for an entity
- **THEN** its mark explains missing or stale data rather than asserting zero,
  and the lens supplies no additional operation authority

### Requirement: Town economy and pull-request projections

Town SHALL show today's numeric usage and estimated cost at city, host, room
and desk scope from the shared usage response and UTC windows.

#### Scenario: Town economy and pull-request projections acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Stale readings
  SHALL be left out of fresh totals; partial coverage, missing hosts and pricing
  limits SHALL remain explicit. Unattributed usage already included in the city
  total SHALL NOT be added a second time or guessed onto a room. Boards SHALL
  offer a short caveat line with the full explanations available on hover or focus.
  The warehouse on the harbour shore (world-shipyard) SHALL project the user's
  open pull requests from Sources and open the existing pull-request card; it SHALL NOT own another source poll,
  readiness rule or merge authority. Closed/unconfigured/error Sources SHALL
  remain distinguishable from an empty successful result.

#### Scenario: A merged pull request leaves the warehouse

- **WHEN** a subsequent admitted Sources observation reports a displayed PR merged
- **THEN** its crate leaves the open yard and its card and merge history use the
  same source identity, without treating an absent or failed observation as a merge

### Requirement: Reception filters move bodies without changing attention

Town SHALL keep one shared default reception-mark filter with optional overrides
by connection ID.

#### Scenario: Reception filters move bodies without changing attention acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Blocked, asking and finished marks MAY each be admitted or
  left at their desk. This preference SHALL be persisted by World's UI settings
  and adopted across devices; a browser cache SHALL yield to service state.
  Failed optimistic writes SHALL restore the last confirmed value unless a newer
  local edit or service publication has superseded them. Reception choices SHALL
  NOT change agent facts, room counts, Board/Desk lanes or Needs you counts.

#### Scenario: An earlier save succeeds while a later save is pending

- **WHEN** save A succeeds while a newer local save B is pending, and B then fails
- **THEN** the browser restores A as the last confirmed preference
- **AND** an older acknowledgement cannot supersede a newer confirmed save or service publication

#### Scenario: A newer service preference overtakes a failed save

- **WHEN** a browser's pending save fails after a newer preference is adopted
- **THEN** the old failure does not restore the superseded preference

### Requirement: Durable Town room placement

Town room positions SHALL live in the shared Board layout, keyed by qualified
workspace card identity. Drag, neighbour move and Tidy rooms SHALL change layout
within the host's building without moving native workspaces or agents. Tidy's
Undo SHALL use current admitted layout and refuse unsafe conflicts rather than
overwriting another device's intervening changes. Existing layout-ID inheritance
and serialized Board persistence SHALL apply to room positions too.

#### Scenario: Another device edits room placement

- **WHEN** one browser saves positions or attempts Undo after another edit
- **THEN** other devices adopt the saved layout and a conflicting conditional
  Undo reports the conflict without silently restoring obsolete positions

### Requirement: Closure queues keep presentation separate from execution

Town's bin and scheduled bus SHALL display the shared qualified close intents
and their deadline, including a bounded waiting queue at the bus stop. Leaving
the view SHALL NOT cancel or duplicate execution. Undo before dispatch SHALL
cancel the intent through its ordinary state-conditioned effect rule; uncertain
native closure SHALL remain uncertain rather than being automatically replayed.

#### Scenario: Reconnect while an agent waits for closure

- **WHEN** a browser reconnects or switches views before the shared close deadline
- **THEN** it observes the existing intent and remaining deadline without creating another close

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

### Requirement: Town zoom levels

Town SHALL present town, overview, room and desk levels over the same
placement, selected by on-screen size.

#### Scenario: Town zoom levels acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** The town level SHALL show roofs with host
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

<a id="requirement-durable-owner-asks-from-crew-panes"></a>

### Requirement: Town agent locations

Town SHALL seat working and unknown agents at their pane's seat unless they have an open user ask placed on their terminal.

#### Scenario: Town agent locations acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** A blocked agent
  SHALL move to its host's reception and queue in order of when it became blocked,
  oldest first, within a bounded number of queue positions; further blocked agents
  SHALL stay at their seat with a waiting cue and the reception SHALL show the exact
  overflow count. A done agent SHALL also go to its host's reception, queued after
  the blocked agents, show a completion marker, and leave finished work on its
  desk until its status changes or the user checks the completion by opening its
  terminal or marking it reviewed; a checked agent SHALL then go to the lounge.
  Because Herdr may report a finished agent as idle, Town SHALL also treat an
  agent it observes going from working or blocked to idle as done until checked.
  A check covers one completion: when the agent works, asks or finishes again,
  its next completion SHALL be unchecked. The World service SHALL hold checks in
  world.sqlite through World IDs and verified source bindings, so every browser
  of that World shows the same checks, including for a finish Town inferred. The
  service SHALL end a check when its own host reads show that agent working or
  blocked, and SHALL ignore a check made while they do, so no browser's late
  view can end or create a check for the wrong completion. Checks SHALL survive a
  World restart or runtime replacement, remaining unresolved until the original
  terminal and captured session (when known) are verified. Complete current absence,
  a positive known session replacement or later native completion progress SHALL
  clear them; lower native progress SHALL NOT clear a newer check. Town, Desk and Needs you
  SHALL read one reviewed record: a completion is checked when Desk's review mark
  names its current stop or the service holds such a check for its terminal.
  Marking it reviewed in any view SHALL write Desk's review mark for the stop
  whose report is shown when Desk can name that stop (the service saw it end, or
  Herdr reports the agent's last activity), and otherwise this check; a mark the
  service did not save SHALL be reported and leave the completion unchecked.
  Town's peek SHALL mark the stop whose report it shows: Mark reviewed SHALL wait
  while a new stop's report is read, offer Retry when that read fails, and confirm
  only a mark the service saved. Checks SHALL NOT represent approval or mutate Herdr. A desk SHALL show its sole
  agent's Herdr name when exactly one named agent occupies the tab; otherwise it
  SHALL show the tab label, or `Tab N` when the tab has no label. Each seat SHALL
  show its agent's or terminal's name at the desk level. An idle agent SHALL move to a lounge spot in its
  building, or remain seated with an idle cue when no spot is free. When an
  agent's status changes, it SHALL move to its new location, and an answered agent
  SHALL return to its seat. Location and movement SHALL be presentation only: they
  SHALL NOT delay operational state, and every agent SHALL keep its exact qualified
  pane target wherever it stands.

  An agent with an open ask placed against its current connection, runtime,
  terminal and agent session SHALL wait at reception with a quiet question mark.
  Urgent blocking SHALL keep its exclamation mark and priority over quiet asks;
  unchecked finishes SHALL follow both. Opening the asking agent SHALL preserve
  the ask. Answering or withdrawal SHALL remove its question marker and restore
  its normal status-based location. These cues SHALL respect existing scene and
  queue bounds without changing the native-order desk prefix. Hidden asking
  agents SHALL remain represented by reception counts, the Needs you tab and
  Summary. Board and Desk SHALL show the same qualified question mark, and Desk
  SHALL include a current asking agent in Needs you regardless of working/idle
  status. A reception question letter SHALL open the Needs you tab at its question in one action. An
  asking shell pane, such as the watcher, SHALL receive a reception entry
  and Board/Desk marks without inventing an agent harness or changing Herdr status.

#### Scenario: A desk has one named agent

- **WHEN** a tab named `Claude` contains exactly one agent named `example-seat`
- **THEN** its desk nameplate shows `example-seat`

#### Scenario: A desk's agent has no Herdr name

- **WHEN** a tab named `Claude` contains one agent with no Herdr name
- **THEN** its desk nameplate shows `Claude`

#### Scenario: A tab contains multiple agents

- **WHEN** a tab named `Claude` contains more than one agent, even if one has a
  Herdr name
- **THEN** its desk nameplate shows `Claude`

#### Scenario: A tab has no name to fall back to

- **WHEN** a tab has no name and does not contain exactly one named agent
- **THEN** its desk nameplate shows `Tab N` using the tab's number

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

#### Scenario: A completion checked on one device

- **WHEN** the user checks a finished agent's completion on a phone while the
  same World is open on a desktop
- **THEN** the desktop shows that agent as checked too, and when the agent
  works or asks again both devices show its next completion unchecked

#### Scenario: World restarts with checked completions

- **WHEN** the World service restarts
- **THEN** saved Desk reviews remain unresolved until fresh terminal and known
  session verification, and every browser shows the same verified review
- **AND** unknown sessions receive fresh current stops without inherited review

#### Scenario: Upgrade from separate completion checks

- **WHEN** World upgrades legacy completion receipts after compatible Chat delivery
- **THEN** only fresh same-source/terminal/known-session/unchanged native sequence
  proof converts them into the current Desk review; unknown receipts may need
  review once again
- **AND** the old completion API and browser fallback are absent; missing Desk
  stop metadata refreshes authoritatively and remains retryable if unverified

### Requirement: Pinned Town desks

The user SHALL be able to pin and unpin a Town desk from its agent window's
menu.

#### Scenario: Pinned Town desks acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Herdr TUI pins SHALL be World-owned view settings saved on the World
  service by tab. A herdr-core desk SHALL be pinned while any of its terminals
  has `herdr.pinned`: pinning SHALL pin its agents, or all terminals when it has
  no agents, and unpinning SHALL clear every terminal's pin through that exact
  current connection. World SHALL derive core pin state from those labels and
  save only the World pin rank, without a second authoritative pin flag. Pins
  SHALL remain separate from Spaces' browser-local close-protection pins.

  Admitted pinned desks SHALL show pins and take their room's first seats in
  saved pin-rank order; other desks SHALL follow in native tab order. Dragging a
  pinned desk onto another pinned seat in the same room SHALL reorder its rank
  without unpinning it. A saved legacy cell SHALL NOT fix its seat. An agent at
  a pinned desk SHALL NOT go to the lounge: it SHALL leave its seat only for
  reception, when blocked or done and not yet checked, and SHALL return to its
  seat once checked or answered. A pin SHALL follow its tab to another workspace
  and SHALL be dropped when its tab closes. When a room has more desks than Town
  presents, admission SHALL remain the native tab-order prefix. A pin or selection
  SHALL NOT promote a hidden tab across the fold boundary. Pin ordering SHALL
  apply only among admitted tabs; expanding SHALL reveal the next tabs in
  order, including any hidden pinned or selected tab.

#### Scenario: A pinned agent finishes and is seen

- **WHEN** an agent at a pinned desk finishes and the user checks it
- **THEN** it waits at reception until checked and then walks back to its seat,
  never to the lounge

#### Scenario: A pinned desk in a crowded room

- **WHEN** a pinned or selected tab lies outside a crowded room's visible prefix
- **THEN** it remains hidden without displacing an earlier tab, and successive
  expansions reveal it in native tab order
- **AND** refolding restores the first 24 tabs without pin or selection promotion

#### Scenario: A room reflows around pinned desks

- **WHEN** tabs are added or reordered in a room with pinned desks
- **THEN** admitted pinned desks take its first seats in pin-rank order and
  the other desks follow in native tab order

#### Scenario: Reorder a pinned desk

- **WHEN** the user drags a pinned desk onto another pinned seat in its room
- **THEN** the saved pin order changes and both desks remain pinned

#### Scenario: Another core client changes a pin

- **WHEN** Herdr's app changes a terminal's `herdr.pinned` label
- **THEN** Town and Board derive the core tab's pin from the observed labels
  without retaining a conflicting World pin flag

### Requirement: Town summary

Town SHALL derive its board sign, its phone counts chip and its summary window
from one summary read model built from Town's attention entries, so they
show the same attention items and needs-you count as the reception tray and
the Needs you counter.

#### Scenario: Town summary acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Needs-you SHALL count blocked agents plus open questions as separate
  items, including when one blocked agent also raised a question. Reception as
  a place continues to seat agents. Host and room counts describe agents;
  questions SHALL NOT acquire a guessed host or room. The board sign SHALL count
  the whole town, every building, from that read model and never from the
  scene's admitted rooms or desks: agents working, finished and quiet, items
  needing the user, every agent in the town with its number of buildings, and
  spend when a metrics provider reports it. Its Summary action, and
  on phones its counts chip, SHALL open a Town summary window in the shared
  window frame. Launching an already-open Summary SHALL restore and raise it
  through the shared window manager. It lists, in this order: open questions using the shared Ask
  cards and answer action, then blocked agents with their reason, waiting age
  and one action; unreviewed finishes with when each was last
  active when Herdr reports activity times, never presented as the finish time; every host with its rooms and their counts (needing
  the user, working, finished, quiet, unknown), where activating a room moves the
  Town camera to it, admitting the qualified requested room while preserving the
  selected room. A room request SHALL wait for renderer setup and its admitted
  layout, be consumed once, and retrigger for a later click on the same room.
  The list SHALL use the complete room roster, including rooms outside the current
  presentation bound. Blocked entries SHALL show the supplied state label, with
  "needs you" only as a fallback. Spend lists each model with its source and age. Without a
  metrics provider the summary SHALL say there is no cost data and SHALL NOT show
  zero spend.

#### Scenario: One count everywhere

- **WHEN** two agents are blocked, one of them also has an open question,
  and one agent has an unreviewed finish
- **THEN** the board sign, phone chip, reception tray, Needs you counter and summary all
  show three items needing the user, with one finished agent in the summary
- **AND** answering that question updates every needs-you count to two while
  both blocked agents remain waiting

#### Scenario: Go to a room from the summary

- **WHEN** the user opens the Town summary on a phone and activates a room
- **THEN** the summary closes and the Town camera shows that room

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
buildings, rooms, desks, seats, agents and reception entries, with
names that include status text.

#### Scenario: Town targets, motion and phone layout acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** Compact targets inside desks and the reception
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
