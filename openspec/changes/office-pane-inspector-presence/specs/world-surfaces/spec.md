## ADDED Requirements

### Requirement: Terminal file links use the originating Inspector

Activating a workspace file link in a terminal presented by Office, Tree or Graph SHALL bring that terminal's exact Inspector window forward, select its Files resource and open the linked file in that Inspector. The action SHALL preserve the originating connection, runtime generation, workspace, pane and file location. It SHALL NOT change another Inspector's active resource or file selection, redirect to a different pane, or require a prior manual Files selection. Spaces SHALL retain its single-Inspector behavior.

#### Scenario: Open a link from one of several visual windows

- **WHEN** two terminal Inspectors are open and the user activates a file link in the second terminal
- **THEN** the second Inspector comes forward on Files with that file selected and the first Inspector retains its resource and file state

#### Scenario: File link target retires

- **WHEN** the source Inspector's connection, runtime generation, workspace or pane retires before a file-link request is admitted
- **THEN** the request does not open the file in another Inspector or on another host, and the user receives an unavailable indication

### Requirement: Exact visual terminal input focus

In Office, Tree and Graph, activating an Inspector window whose selected resource is Terminal SHALL focus its terminal input and its selected pane. Explicitly selecting a pane within that window SHALL make that exact pane the input recipient, including when another pane or window was previously focused. Bringing a window forward SHALL NOT route typed input to another pane. Moving between visual views SHALL preserve the qualified pane target. Selecting a non-Terminal resource SHALL not steal keyboard focus for terminal input.

#### Scenario: Answer an agent in a split terminal

- **WHEN** an agent in one pane requests input and the user selects that pane in an Office or Graph Inspector before typing
- **THEN** the selected pane receives the input and no other pane receives it

#### Scenario: Activate a terminal window

- **WHEN** the user activates a visual Inspector showing Terminal by pointer or keyboard while another terminal was focused
- **THEN** its selected pane becomes the keyboard target without a second click inside the terminal

#### Scenario: Pane or lease becomes unavailable

- **WHEN** the selected pane closes, changes tab, or its connection generation retires during visual focus handoff
- **THEN** World rejects the obsolete target and does not send input to a fallback pane, window or host

### Requirement: Office pane-linked devices

Office SHALL present a distinct device for each pane admitted to a presented tab's bounded visual display, grouped with the tab's desk. Working or unknown agents sharing that tab SHALL appear near their pane devices within the bounded room layout. Each device SHALL remain at its tab desk while its agent moves to reception or the Agent Bar, and SHALL disappear when its pane closes or its qualified runtime retires. Activating a device SHALL open or focus the Inspector Terminal for that exact connection, generation and pane. Devices, desks and agents SHALL have distinct keyboard- and pointer-accessible targets and names; a device SHALL communicate when a desk has multiple panes without changing the meaning of the desk as a tab.

#### Scenario: Two agents work in one tab

- **WHEN** a tab contains two admitted panes with working agents
- **THEN** Office groups both agents and their distinct pane devices around the same desk, indicates multiple panes, and each device opens its own pane

#### Scenario: Agent leaves a pane device

- **WHEN** an agent becomes blocked, done or idle while its pane remains open
- **THEN** the agent moves according to status and its device remains at the original tab desk as an exact pane target

#### Scenario: Pane closes or exceeds the presentation bound

- **WHEN** a pane closes or more panes are admitted than Office can present around a desk
- **THEN** closed-pane devices disappear, presented devices do not overlap or claim another pane's target, and omitted panes remain discoverable through a bounded count or chooser

## MODIFIED Requirements

### Requirement: Office state and room operations

Office SHALL place working and unknown agents with their owning work room, blocked and done agents at their qualified host reception, and idle agents in the Agent Bar. Reception SHALL use one shared table per host for blocked and done agents, mark blocked agents with `?` and done agents with `✔`, and keep the status available in text and accessible names rather than symbol or color alone. A done agent's originating desk SHALL retain a bounded generic completion marker until that qualified completion is inspected; this browser-local seen state SHALL NOT represent approval, mutate Herdr or move a still-done agent to the bar. Reception SHALL add bounded standing positions around the table when seats fill and SHALL expose an exact overflow count and roster targets for agents beyond its visual bound.

Office SHALL retain bounded hover callouts, task summaries, state cues, at least 48 by 48 CSS-pixel
semantic targets and a compact Agents/Rooms/Desks chooser. Selected identity and detail SHALL live
in the shared Inspector rather than a duplicate persistent scene badge. Capability-gated room creation,
rename and close actions and room-local seat creation SHALL operate on real workspaces and tabs. A
room at eight desks SHALL retain a disabled Room Full affordance rather than hiding capacity.

Office SHALL expose a persisted Inspector opening preference with Docked and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved. In
Docked mode, a newly opened Office entity SHALL use the single docked Inspector and remain available
for explicit Dock out. In Floating mode, each newly opened Office entity SHALL use its own
cascaded floating Inspector without a fixed presentation-count cap. Changing the preference SHALL
govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
existing entity SHALL focus its current presentation.

When several working or unknown room-destination agents share one tab, Office SHALL choose at most
one deterministic seated occupant using the established state/focus priority and SHALL present
remaining room-local agents as standing only within the tested per-room agent bound. Working or
unknown room-destination agents belonging to tabs omitted beyond the eight-desk presentation bound
SHALL remain eligible for that bounded standing presentation. Blocked and done agents SHALL remain at their
qualified reception, idle agents SHALL remain in the Agent Bar, and every bounded omission
SHALL contribute to the exact relevant omitted count. Presented desks and agents SHALL keep
distinct, nonduplicated semantic targets.

#### Scenario: Agent status changes location

- **WHEN** an admitted agent changes from working to blocked, then done, and later idle
- **THEN** the same qualified agent moves from its room to reception with `?`, stays at reception with `✔` while done, and moves to the Agent Bar only when idle, while its ancestry, selection and terminal identity remain stable

#### Scenario: Reception fills

- **WHEN** blocked and done agents together exceed the host reception's seats and then its bounded standing positions
- **THEN** they share the reception table and nearby standing area up to the visual bound, and an exact overflow count and roster preserve access to the remaining qualified agents

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

- **WHEN** the selected host advertises the required capability and the user invokes the next desk
  action
- **THEN** World uses the admitted launcher path for that room, shows the desk only after Herdr
  admits the resulting tab and pane, retains the live Office instance across that topology update,
  and boundedly retries exact qualified focus until it opens the new Inspector on Terminal with the created pane selected and its multi-pane state visible, or the originating lease becomes invalid

#### Scenario: Seat creation is cancelled or fails

- **WHEN** the user cancels seat creation or the launcher fails before Herdr admits a new pane
- **THEN** Office preserves the prior selection, focused Inspector context and every existing
  qualified conversation window for the selected host without detaching or redirecting input

#### Scenario: Mixed-state agents share a tab or exceed the desk bound

- **WHEN** working or unknown agents share a tab or belong to a ninth or later tab while blocked,
  idle or done agents occupy the same tab or overflow range
- **THEN** Office seats at most one deterministic room-local occupant per visible desk, presents
  remaining room-local agents near their desk within the tested bound, keeps blocked and done agents at
  reception and idle agents in the Agent Bar, reports exact omissions and exposes no
  duplicate semantic target

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

- **WHEN** a room is stale or full, or its host lacks the required
  capability
- **THEN** the corresponding control remains understandable but cannot create an Office-only room,
  desk or mutation
