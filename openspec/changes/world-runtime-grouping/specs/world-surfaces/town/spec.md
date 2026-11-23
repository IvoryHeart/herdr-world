## MODIFIED Requirements

### Requirement: Town scene

Town SHALL present a town in which each presented host is one building along a
road, each admitted Herdr workspace of that host is a room on a carpet inside its
building, and each admitted tab is a desk in its room.

#### Scenario: Town machine buildings acceptance rules

- **WHEN** World presents Town for a machine with more than one runtime or
  connection
- **THEN** by default the runtimes of one machine (its Herdr TUI and
  herdr-core) SHALL share one building through a display-only building key,
  each room naming its runtime there; World's Group runtimes setting (one per
  machine, the default, or one per runtime) SHALL restore a building per
  runtime. The building key SHALL NOT change any entity's host key,
  qualified references or actions, which stay on the owning connection and
  generation. Two Herdr TUI connections to one endpoint SHALL present its
  rooms once, preferring the writable connection.

#### Scenario: One machine, two runtimes, a duplicated connection

- **WHEN** a machine has two Herdr TUI connections to one socket and a
  herdr-core, and Group runtimes is one per machine
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
