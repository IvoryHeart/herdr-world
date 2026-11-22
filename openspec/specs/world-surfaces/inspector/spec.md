# World inspector

## Purpose

Define the user-facing inspector contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Agent worktree source-control context

An agent Inspector's Files and Changes SHALL share one selected worktree,
independently of its workspace launch directory.

#### Scenario: Agent worktree source-control context acceptance rules

- **WHEN** World opens, updates or uses an Inspector and its resources
- **THEN** World SHALL rank evidenced
  candidates from live Herdr pane foreground_cwd, then that exact occupant's own
  session/transcript/Codex rollout cwd or session-bound checkout report, then its
  branch matched within an explicitly known repository's Git worktree list.
  Roots SHALL be canonicalized on the target runtime, including SSH. Detached HEAD
  SHALL remain a valid root with null branch. An outside-Git or unreadable cwd SHALL
  remain attributed unconfirmed evidence, without guessed sibling repositories.

  The observation SHALL carry connection, generation, pane/terminal and session,
  revision/time, source/reference/basis and resolved, ambiguous, unavailable or
  stale state. A client SHALL submit a candidate identity plus qualified subject
  and revision; the service SHALL resolve and revalidate it for RPC and HTTP file
  reads, previews, downloads and actions. Old occupants, moved/replaced roots or
  retired generations SHALL NOT fall back to another root or host.

  The existing location line SHALL show the selected tree/branch and source mark.
  Its popover SHALL offer Worktree radio choices and Refresh, with phone tap
  rows at least 44px. Equal-rank ambiguity SHALL require an explicit choice.
  Stale evidence SHALL remain visible but SHALL NOT admit resources. The empty
  Files/Changes state SHALL open the same chooser. Other entries from that scoped
  worktree list MAY be offered as worktree_list viewer choices; they SHALL NOT
  become automatic bindings or claims of agent/branch ownership. Selection SHALL
  apply to Files and Changes together and remain separate from observed claims.

  Existing explicit checkout reports SHALL retain versioned session guards and
  Reported PR attribution; viewing another root SHALL NOT rewrite those reports.
  Observers SHALL refresh from events or explicit demand rather than polling.
  Unchanged source bindings MAY reuse a bounded observation; selected roots and
  inferred branch ambiguity SHALL still be revalidated at operation boundaries.

#### Scenario: Agent changes directory or uses another linked checkout

- **WHEN** an agent launched in the main checkout has stronger live/session
  evidence for a linked worktree, or the user deliberately chooses a listed tree
- **THEN** Files, Changes and HTTP previews use that same qualified selected root,
  and the location popover explains the source without asserting ownership

#### Scenario: Worktree evidence conflicts or expires

- **WHEN** equal-rank candidates conflict, a source/root changes while a request
  is pending, or the occupant/generation is replaced
- **THEN** no stale or guessed default admits access; the chooser retains
  attributable evidence and resource access waits for a current selection

### Requirement: Terminal file links use the originating Inspector

Activating a workspace file link in a terminal presented by Town or Board SHALL bring that
terminal's exact Inspector window forward, select its Files resource and open the linked file in
that Inspector.

#### Scenario: Terminal file links use the originating Inspector acceptance rules

- **WHEN** World opens, updates or uses an Inspector and its resources
- **THEN** The action SHALL preserve the originating connection, runtime generation,
  workspace, pane and file location. It SHALL NOT change another Inspector's active resource or file
  selection, redirect to a different pane, or require a prior manual Files selection. Spaces SHALL
  retain its single-Inspector behavior.

#### Scenario: Open a link from one of several visual windows

- **WHEN** two terminal Inspectors are open and the user activates a file link in the second terminal
- **THEN** the second Inspector comes forward on Files with that file selected and the first
  Inspector retains its resource and file state

#### Scenario: File link target retires

- **WHEN** the source Inspector's connection, runtime generation, workspace or pane retires before
  a file-link request is admitted
- **THEN** the request does not open the file in another Inspector or on another host, and the user
  receives an unavailable indication

### Requirement: Present one Inspector per Herdr tab with its split panes

An actionable Herdr tab SHALL have at most one World Inspector conversation.

#### Scenario: Present one Inspector per Herdr tab with its split panes acceptance rules

- **WHEN** World opens, updates or uses an Inspector and its resources
- **THEN** Selecting any pane in that tab through Town, Board, the common navigator or inside the Inspector's own split Terminal SHALL focus that conversation, select the requested pane within it and show the current Herdr split-pane layout when Terminal is selected. The Inspector identity and window geometry SHALL remain stable as selection moves among sibling panes; its header and pane/agent-specific resource applicability SHALL follow the selected pane, with Agent History available only when that pane has an admitted agent session. A non-terminal space Inspector SHALL remain a separate conversation. If the selected pane closes while sibling panes remain, the Inspector SHALL select a remaining live pane in the same qualified tab; when the tab no longer exists, the conversation SHALL retire.

  Files selections and replies SHALL remain scoped to their workspace or checkout resource owner, and ordinary Changes selections and replies SHALL remain scoped to their workspace. Switching between sibling panes in the same workspace SHALL preserve valid Files and ordinary Changes state. Agent checkout Changes and Agent History SHALL follow the selected pane and session; replies captured for a prior pane or session SHALL NOT replace the newly selected pane's agent-specific content. In Spaces, the one workspace Inspector SHALL similarly update its header and agent-specific applicability with the active tab and selected pane while preserving valid workspace or checkout resources.

  The live Inspector tab-window identity SHALL include connection ID, runtime generation, workspace ID and Herdr tab ID. Persisted Inspector tab-window geometry SHALL use a stable connection/workspace/tab key without runtime generation. Existing pane-key geometry MAY be read as a one-time fallback and migrated to the stable key. After migration and a runtime reconnect, the latest saved Inspector geometry SHALL be restored for that same connection, workspace and tab; the live conversation SHALL still retire on generation change. Spaces arrangement geometry SHALL remain separate and session-local, so arranging a tab in Spaces SHALL NOT overwrite its saved visual Inspector position.

  Pane placement, zoom and resize inside an Inspector SHALL follow Herdr's tab layout. Window arrangements SHALL act outside that layout. Every terminal pane SHALL have at most one active browser presentation and attachment across Spaces and visual views, qualified by connection, runtime generation, workspace, tab, pane and terminal identity. Missing, stale or mismatched tab layout data SHALL never attach another pane or show cached layout as actionable current topology.

#### Scenario: Open sibling panes from different World nodes

- **WHEN** two selected World nodes refer to sibling panes in the same Herdr tab
- **THEN** they focus one Inspector window and the selected pane's identity and applicable resources update without a second terminal attachment

#### Scenario: Split a pane in a floating Inspector

- **WHEN** Herdr splits the pane shown by a floating Inspector into two panes in the same tab
- **THEN** the Inspector Terminal shows both panes in Herdr's reported arrangement, and input goes only to the pane the user focuses

#### Scenario: Focus a sibling inside a split Inspector

- **WHEN** pane A and pane B share an Inspector and the user focuses B inside its split Terminal while A's agent checkout Changes or History request is pending
- **THEN** terminal input, the Inspector's selected-pane header and agent-specific applicability follow B, and A's late reply cannot replace B's agent-specific content

#### Scenario: Select a pane from a mobile switcher or zoomed terminal

- **WHEN** a user chooses a sibling with the mobile pane switcher or focuses the Herdr-zoomed pane while an earlier pane-focus read is pending
- **THEN** the chosen pane remains selected, with no older pane-focus request from the same pointer action able to override it

#### Scenario: Preserve workspace resources across sibling focus

- **WHEN** pane A and pane B share a tab and workspace, Files has a valid selection for that workspace or checkout, ordinary Changes mode has a selected workspace diff, and the user focuses B after selecting A
- **THEN** the same Inspector updates its header and pane/agent-specific applicability for B while retaining the Files selection and ordinary Changes mode and diff selection and accepting their still-valid scoped replies; A's late agent checkout Changes or History reply cannot appear as B's agent data

#### Scenario: Move between Spaces and a split Inspector

- **WHEN** a tab with multiple panes is shown in Spaces and later in its World Inspector, or the reverse
- **THEN** the same Herdr panes and layout remain visible after the handoff and no terminal gains a second live attachment

#### Scenario: Selected pane closes

- **WHEN** the selected Inspector pane closes while another pane remains in its qualified tab
- **THEN** the Inspector stays on that tab, selects a remaining pane and updates its resource tabs without binding to a pane from another tab or host

#### Scenario: An older resource reply arrives after sibling selection

- **WHEN** pane A's agent checkout Changes or History request finishes after the user has selected sibling pane B
- **THEN** the Inspector keeps B's identity and applicable resources and does not display A's late agent result as B's data

#### Scenario: Restore saved geometry after reconnect

- **WHEN** a pane-keyed position was migrated to a tab-keyed position, the user moves that tab window again, and the runtime reconnects
- **THEN** the old live Inspector retires and the reopened tab window uses the latest stable tab-keyed position instead of the older pane-keyed position

#### Scenario: Tab layout becomes stale

- **WHEN** a pane closes, moves to another tab or its host generation changes while an Inspector waits for layout data
- **THEN** an obsolete response is ignored and no pane is attached under an incorrect tab or host

### Requirement: Inspector opening preference

World SHALL expose a persisted Inspector opening preference with Docked and Floating modes through
the common settings menu, with Floating as the default when no valid preference has been saved.

#### Scenario: Inspector opening preference acceptance rules

- **WHEN** World opens, updates or uses an Inspector and its resources
- **THEN** In
  Docked mode, a newly opened entity from Town or Board SHALL use the single docked Inspector and
  remain available for explicit Dock out. In Floating mode, each newly opened entity SHALL use its own
  cascaded floating Inspector without a fixed presentation-count cap. Changing the preference SHALL
  govern subsequent opens and SHALL NOT rearrange an Inspector that is already presented; selecting an
  existing entity SHALL focus its current presentation. A preference saved before Office was retired
  SHALL keep applying.

#### Scenario: Change the opening preference

- **WHEN** the user switches the preference from Floating to Docked while two floating Inspectors
  are open and then opens a third entity from Board
- **THEN** the two remain floating and the third opens in the docked Inspector

### Requirement: Shared Inspector drawer

Town and Board SHALL provide one consistent shell-owned Inspector surface that can appear as
the one docked overlay or as a movable desktop window.

#### Scenario: Shared Inspector drawer acceptance rules

- **WHEN** World opens, updates or uses an Inspector and its resources
- **THEN** Every Inspector SHALL
  identify its qualified entity with a compact icon, name and bounded status or read-only-host cue and
  SHALL give its primary area to immediately visible applicable Terminal, Files, Changes and Agent
  History tabs. Identity and resources SHALL share one lifecycle, header and close control rather than
  stack a separate agent profile card above the resource pane. Terminal SHALL be the first tab and the
  initial tab for a newly opened terminal-capable entity; changing one Inspector's active tab SHALL NOT
  change another Inspector or the default for a later entity.

  Selecting an actionable entity in Town or Board SHALL follow the persisted Inspector opening
  preference for newly opened entities and SHALL focus an existing entity in its current presentation.
  The common workspace navigator and focused tab strip SHALL always admit the matching entity into
  the docked Inspector, independently of that preference. Docked admission SHALL replace and
  close a different docked conversation rather than implicitly turn it into a floating window. A
  floating Inspector SHALL be independently movable and resizable and
  expose Dock in and × controls. The docked Inspector SHALL expose Dock out, dock-position,
  expand/restore and × controls and SHALL itself be movable while it remains an overlay. Choosing a
  dock position or expand/restore SHALL snap it back to that explicit dock geometry. Docking a
  floating Inspector while another is docked SHALL swap their
  presentations without discarding either context or increasing the floating-window count. Docking or
  undocking SHALL transfer the complete Inspector, including its selected tab and resource-selection
  state, rather than transfer only a terminal child.

  Selecting an actionable space or non-agent terminal pane SHALL use the same Inspector surface with
  compact entity identity and only the tabs applicable to that entity. A space SHALL expose Files and
  Changes. A non-agent terminal pane SHALL expose Files, Changes and Terminal. Agent History SHALL
  appear only for an admitted agent session. Selecting a host SHALL retain bounded host detail and
  activation state without inventing workspace resources.

  Every Inspector SHALL expose generation-fenced resources only for its own admitted connection. A
  stale selection MAY retain a bounded read-only identity and SHALL explain its unavailable state
  and offer connection management when applicable, without opening live resources. An actionable entity SHALL NOT
  retain a separate floating profile card. Missing metadata SHALL remain absent rather than inferred.
  Authoritative cost, input-token, output-token or similar observations MAY appear in the compact
  identity area only when the provider qualifies them to that exact agent session; unavailable or
  merely host-wide observations SHALL not be shown as agent values or fabricated as zero.

  Inspector instances SHALL reuse the shell's existing resource components, connection client,
  caches and terminal owner while retaining independent active-tab, file/diff selection, history and
  geometry state. They SHALL NOT create another application store, runtime observer, WebSocket, SSH
  tunnel or terminal implementation. Opening the same qualified entity through another visual
  representation SHALL focus its existing Inspector instead of creating a duplicate context.

  Each Inspector SHALL remain visually connected to its represented agent, desk or hierarchy node
  whenever that exact qualified anchor is visible. Opening or focusing an Inspector SHALL not change
  the host filter or another context's target. World SHALL admit identity and resource content together after qualified pane
  focus; a delayed or rejected focus SHALL never show a new identity over another entity's resources.
  Changing the host filter SHALL preserve Inspector and terminal contexts. Runtime retirement SHALL
  retire only contexts owned by that connection and generation.

#### Scenario: Open a terminal-capable Inspector

- **WHEN** the user selects an actionable agent or non-agent terminal pane without an existing
  Inspector context or retained applicable tab preference
- **THEN** its configured Inspector presentation opens Terminal as the initial resource while keeping
  Files, Changes and any admitted Agent History available as peer tabs

#### Scenario: Reposition a selected-agent Inspector

- **WHEN** the user docks, undocks, moves, resizes, expands or restores a selected-agent Inspector
- **THEN** compact identity, selected resource state, applicable tabs and the controls for that
  presentation remain reachable within the same Inspector, and an explicit dock-position change
  leaves the named dock fully visible

#### Scenario: Dock while another Inspector is docked

- **WHEN** Inspector A is docked and the user invokes Dock in on floating Inspector B
- **THEN** B becomes docked, A takes B's floating presentation, both retain their independent
  resource state and no additional floating slot is consumed

#### Scenario: Inspect an agent with a task summary

- **WHEN** the user selects an admitted agent with a visible scene representation and bounded task
  summary
- **THEN** the Inspector overlay opens over the unchanged visual stage, shows compact qualified agent
  identity, exposes its resource tabs and task summary within the relevant intent content, and draws
  a connector to that agent

#### Scenario: Open rich agent context

- **WHEN** the user changes among Files, Changes and Agent History in two actionable agent
  Inspectors on different ready managed hosts
- **THEN** each Inspector retains its own tab and resource selection for the exact qualified
  workspace and session while reusing the shell's existing resource implementations

#### Scenario: Inspect a non-agent World entity

- **WHEN** the user selects an actionable space or non-agent terminal pane in Town or Board
- **THEN** the same overlay presents its compact qualified identity and applicable shell-owned
  Files, Changes or Terminal tabs without fabricating Agent History or changing the host filter

#### Scenario: Inspect an agent with qualified observations

- **WHEN** an optional observation provider reports cost or token metrics qualified to the selected
  agent session
- **THEN** the compact identity area may show those values, while unavailable or host-only values
  remain absent

#### Scenario: Inspect an agent on an inactive host

- **WHEN** an open Inspector belongs to a current ready host excluded by the overview filter
- **THEN** its qualified checkout resources remain usable and its identity indicates it is outside
  the filter, without changing its host or agent session

#### Scenario: Change selection while focus is delayed or rejected

- **WHEN** opening or focusing entity B requires asynchronous pane focus
- **THEN** World publishes B's identity only with B's admitted resources, leaves every existing
  Inspector bound to its original entity and opens no B context if focus is rejected

#### Scenario: Selected entity becomes stale

- **WHEN** an Inspector entity's host disconnects or advances beyond the observed generation
- **THEN** World preserves bounded inspection information from the selected generation, marks or
  closes the retired context according to current admitted state, disables every operational action
  and never rebinds it to an equal identifier in the replacement generation

#### Scenario: Agent metadata is unavailable

- **WHEN** an agent exposes no task summary, model label or state label
- **THEN** its compact identity and available resource tabs remain useful without fabricating what
  the agent is doing or implemented
