# World creation profiles

## Purpose

Define the user-facing creation profiles contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Creation from the current World view

Town, Desk and Board SHALL provide New workspace and New tab through the
common Actions control on desktop and compact layouts.

#### Scenario: Creation from the current World view acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** New workspace SHALL offer
  an explicitly confirmed destination host. New tab SHALL identify its selected
  workspace and owning host; selecting an agent or terminal SHALL target that
  entity's owning workspace. A missing New tab target SHALL explain that a workspace
  or one of its entities must be selected, without using hidden Spaces focus.

  Town room and desk creation, shared tab-strip and mobile tab creation,
  Inspector create-tab shortcuts, and Spaces creation SHALL use the same qualified
  preparation and creation behavior. Visual creation SHALL retain the current visual
  view. Spaces SHALL retain its existing terminal layout, navigation and input
  behavior while sharing those operations.

#### Scenario: Create a tab in each visual view

- **WHEN** a user selects a current workspace or its agent/terminal in Town, Desk or
  Board and activates New tab
- **THEN** World creates a tab in that exact workspace and host without requiring
  a visit to Spaces, retains the visual view and presents the created terminal

#### Scenario: Create a workspace with no visual entity selected

- **WHEN** a user activates New workspace without an entity selected
- **THEN** World identifies the chosen destination host for confirmation and
  creates only on that captured host and runtime generation

#### Scenario: New tab has no selected workspace

- **WHEN** a user opens Actions with only a host selected or with no selection
- **THEN** New tab explains its missing workspace target, while New workspace
  remains available for an admitted destination and does not inherit Spaces focus

#### Scenario: Create using a mobile control

- **WHEN** a user on a compact layout creates a workspace or tab from a visual view
- **THEN** creation and destination controls remain reachable without a desktop
  tab strip, canvas pointer precision or a hover-only explanation

#### Scenario: Create in Spaces

- **WHEN** a user creates a workspace or tab in Spaces
- **THEN** the same destination, preparation and failure rules apply and the
  created terminal appears through the existing Spaces presentation

### Requirement: Qualified creation preparation and readiness

World SHALL capture the creation destination and resolve a valid source on that
owning connection and runtime generation before mutation.

#### Scenario: Qualified creation preparation and readiness acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** For browser-local
  creation it SHALL prepare and retain this browser's current source attachment
  without requiring a visible terminal, an existing Inspector or prior Spaces
  navigation. The source whose readiness is checked SHALL be the source used for
  dispatch, including workspace, tab, pane and terminal identity.

  World SHALL establish the destination runtime's navigation mode and current
  topology before choosing a creation path. Missing or cached operational state
  SHALL NOT be treated as proof of shared navigation or an empty runtime. A
  validated empty-host bootstrap SHALL remain available when no workspace exists;
  an existing workspace without an admitted source SHALL not invoke that bootstrap.
  Shared navigation SHALL retain its existing creation behavior without imposing a
  browser-local endpoint requirement.

  Equivalent creation controls SHALL derive availability, preparation progress and
  unavailable explanations from the same qualified state. A ready destination whose
  source can be prepared SHALL permit the user to start that preparation and creation
  without another view transition. Preparation SHALL have a finite deadline and
  expose progress and failure. Method advertisement alone SHALL NOT establish this
  browser's attachment ownership; detached, superseded or other-browser attachments
  SHALL not admit mutation.

  World SHALL maintain one terminal owner per qualified terminal across preparation,
  Spaces and Inspectors. Ownership handoff and cleanup SHALL not detach a
  replacement owner or invalidate a source while an admitted creation depends on it.
  Preparation SHALL not send shell input or change unrelated workspace/tab selection.
  Changing filters or another context's focus SHALL not retarget a submitted
  operation. Losing the captured source or runtime SHALL reject pre-dispatch work
  without connection or control-API fallback.

#### Scenario: Create in a second room without opening its Inspector

- **WHEN** a ready browser-local host contains two workspaces and a user activates
  the second room's add-desk control before opening its terminal
- **THEN** World prepares a source within that second workspace and creates there,
  regardless of the first room's existing attachment or browser navigation

#### Scenario: Create on an unobserved ready host

- **WHEN** a ready host has aggregate topology but no loaded operational session
  and a user starts creation on it
- **THEN** World establishes its current navigation mode and qualified source
  before dispatch, without selecting that host globally or assuming shared mode

#### Scenario: Readiness and New Room dispatch use the same source

- **WHEN** a user starts New Room from workspace B while workspace A is the
  connection's remembered browser-selected workspace
- **THEN** preparation, method checks and browser-local dispatch use the captured
  source in B and do not switch to A during submission

#### Scenario: An advertisement belongs to another browser

- **WHEN** a source advertises creation methods through another browser's live
  terminal session and this browser has no current source attachment
- **THEN** World treats the source as needing preparation and does not dispatch
  creation based only on that advertisement

#### Scenario: Source attachment changes after the button renders

- **WHEN** a source detaches, reconnects, closes or changes attachment incarnation
  after a creation control was rendered ready
- **THEN** readiness is revoked, late replies cannot restore obsolete ownership,
  and submission revalidates or prepares the same qualified source before dispatch

#### Scenario: Spaces and Inspector share a creation source

- **WHEN** creation preparation and a Spaces/Inspector presentation require the
  same qualified terminal, including during a view handoff
- **THEN** they reuse or transfer its exclusive ownership, do not race competing
  attaches and retain the source for the admitted creation's lifetime

#### Scenario: Create the first workspace on an empty host

- **WHEN** current qualified observation confirms that the chosen host has no
  workspaces and the user confirms New workspace
- **THEN** World uses the validated empty-host bootstrap once without requiring
  a nonexistent terminal source

#### Scenario: A capability or destination is unavailable

- **WHEN** the captured host is stale/offline/retired, no valid source exists in
  a nonempty browser-local runtime, or the negotiated endpoint lacks creation
- **THEN** World explains the specific unavailable state and performs no mutation
  on that host, a replacement generation or another connection

### Requirement: Creation completion and terminal presentation

World SHALL suppress duplicate submissions of a pending creation intent and keep
its captured destination through preparation, dispatch and completion.

#### Scenario: Creation completion and terminal presentation acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** Successful
  visual creation SHALL open or focus the exact qualified root terminal returned by
  the creation operation, using the shared Inspector while retaining the active
  visual view. All creation entry points SHALL apply the same bounded admission
  behavior when runtime topology becomes visible asynchronously.

  The previous Inspector SHALL remain available until the created terminal can be
  admitted and focused. A failed create SHALL report failure without replacing it.
  A successful create followed by admission/focus failure SHALL report that the
  workspace/tab exists and that presentation failed. A missing root terminal
  identity SHALL be treated as a presentation failure, without guessing a terminal.

  Changing visual views SHALL not lose creation completion. A later explicit user
  selection or Inspector action SHALL supersede an older automatic focus intent
  without changing its creation destination or hiding its successful result.
  Runtime replacement and transport retirement SHALL fence late completion.
  An uncertain outcome after dispatch SHALL be reported as potentially created and
  SHALL NOT trigger an automatic repeated creation.

#### Scenario: Topology admits a newly created terminal later

- **WHEN** creation returns its root terminal before World topology admits it
- **THEN** World retains the previous Inspector, waits within a bounded admission
  window and opens only that exact terminal after current admission succeeds

#### Scenario: Global workspace or shared tab-strip creation succeeds

- **WHEN** a user creates through New workspace or the shared tab strip while a
  visual view is active
- **THEN** the same qualified terminal completion used by Town desk creation
  presents the result without switching to Spaces

#### Scenario: Creation or presentation fails

- **WHEN** creation is rejected, the returned root identity is absent, or created
  terminal admission/focus does not succeed before its deadline
- **THEN** World preserves the previous Inspector and distinguishes a creation
  failure from a successful creation whose terminal could not be presented

#### Scenario: User activates a creation control repeatedly

- **WHEN** a user double taps, double clicks or repeats a create shortcut while
  the same creation intent is preparing or dispatching
- **THEN** World sends at most one mutation for that intent and exposes its progress

#### Scenario: User changes views or chooses another terminal while creating

- **WHEN** creation is pending and the user changes to another visual view or
  explicitly opens another terminal
- **THEN** completion remains qualified and available across views, and an older
  focus intent does not replace the user's newer explicit Inspector choice

#### Scenario: Creation reply is lost after dispatch

- **WHEN** a timeout, reconnect or runtime retirement prevents a definite reply
  after creation may have been dispatched
- **THEN** World identifies the captured host and uncertain outcome, preserves the
  previous Inspector and does not automatically create again

### Requirement: Agent profiles

The World service SHALL keep agent profiles: a name, an agent kind (the
harness), an optional model, reasoning effort and permission mode, a role,
skills, tools, a starting brief, whether to send the brief once the agent is
ready, an optional home room, an optional terminal colour and a Town look
(skin, hair and its style, outfit, shirt and trouser colours, accessory).

#### Scenario: Agent profiles acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** Profiles SHALL be bounded, validated and revisioned, committed through the
  instance SQLite single writer as specified by Durable World-owned agent profiles
  in [World storage](../../world-storage/spec.md), and shared by every authenticated
  browser of the service. Legacy JSON is an import source, not the live store. A profile SHALL NOT hold credentials: text that looks like a key
  or token SHALL be refused. World SHALL seed editable starter profiles (Reviewer,
  Builder, Designer, FirstMate) once; deleting one SHALL NOT bring it back.

  The profile editor SHALL be reachable from World settings, the Actions menu, the launcher and Board, show
  a live preview of the look with Town's sprites and the exact launch the profile
  maps to. At launch World SHALL map a profile to its harness's own configuration:
  for Claude Code an inline subagent definition (description, prompt, tools,
  model, skills) selected as the session's agent, and its permission mode; for
  Codex its model, approval policy, sandbox (writable when the tools include Edit
  or Write), reasoning effort and the role and skills as developer instructions;
  for any other kind no options, with the role sent ahead of the first prompt.
  An empty choice SHALL leave the harness's default.

  Profile definitions SHALL stay per World. A launched terminal's profile
  assignment SHALL live in Herdr metadata and end with that terminal, as
  specified by Per-terminal settings live with the terminal in the current
  world-surfaces spec. Every World on that Herdr SHALL read the assignment,
  resolving its ID against its own profiles; a missing profile SHALL show
  the recorded name with the default look.

#### Scenario: Edit a starter

- **WHEN** the user changes the Builder starter's model and saves
- **THEN** every browser of the service shows the change and Builder is still marked as a starter

#### Scenario: A credential in a profile

- **WHEN** the user saves a profile whose role contains an API key
- **THEN** the service refuses the profile and nothing is written

#### Scenario: Launch a Codex profile

- **WHEN** the user starts the Reviewer profile (Codex, high effort, read-only tools)
- **THEN** Codex starts with its approval policy, a read-only sandbox, high reasoning effort and the role as developer instructions

### Requirement: New agent from a profile or a kind

The shell's Actions menu in the visual views, each actionable Town room
(including on phones), Spaces (beside New tab) and Board's New tab dialog SHALL
offer New agent; like other view actions, it SHALL NOT add buttons to a view's
toolbar.

#### Scenario: New agent from a profile or a kind acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** It SHALL name a destination room on a
  ready host and start, in one tap, a profile or an agent kind. The kinds SHALL be
  those the host's Herdr reports as supported (its agent manifests); a Herdr that
  reports none SHALL be offered Claude and Codex, and Herdr SHALL validate the
  choice.

  For a Herdr TUI destination, through the room's own connection and runtime generation, the service SHALL
  create a tab labelled with the profile or kind, start the agent in its root
  pane under a Herdr agent name derived from the label and unused on that host,
  wait within a bound until that same agent in that pane and terminal is
  interactive, then send the first prompt once. When Herdr refuses the start
  because the new shell is not yet at its prompt or the name is taken, nothing
  has started, and the service SHALL retry the start within a bound. Any other
  refusal SHALL fail with Herdr's reason. A lost start reply SHALL be inspected,
  never relaunched. An agent that stops on a question before it is ready, or that
  exits as it starts (the shell is back in the foreground), SHALL be reported at
  once without a prompt; a timeout SHALL be reported as uncertain. Every outcome
  SHALL say what was created and offer to open it. A ready agent SHALL open in a
  terminal window. A launch from a profile SHALL give the new tab the profile's
  colour, and Town SHALL draw that agent with the profile's look; other agents
  keep the look derived from their identity.

  Herdr-core launch admission and native operations SHALL follow
  [Herdr-core runtime](../../herdr-core-runtime/spec.md).

#### Scenario: Start Claude in a new tab

- **WHEN** the user chooses Claude in New agent for a room whose new shell takes a moment to reach its prompt
- **THEN** Claude starts in the new tab once the shell is ready, rather than leaving a plain shell

#### Scenario: A harness refuses its options

- **WHEN** a harness exits as it starts because it rejects an option
- **THEN** World reports that the agent exited, without waiting for the timeout, and offers to open the tab

#### Scenario: A question before the agent is ready

- **WHEN** the new agent asks whether to trust its folder
- **THEN** World reports that the agent is waiting on a question, sends nothing and offers to open the tab

### Requirement: Harness readiness

For each agent kind a host supports, the service SHALL report whether the
harness is installed (on the service's PATH or a usual install folder) and, when
the harness has a status command World can read, whether it is logged in and by
which method.

#### Scenario: Harness readiness acceptance rules

- **WHEN** World configures profiles or prepares, dispatches and completes creation
- **THEN** It SHALL run the harness's own status command on the room's host
  (locally or over the connection's OpenSSH destination) and keep only those
  fields; it SHALL NOT read credentials or forward the command's output. Harness
  commands SHALL be data per harness, not logic. The launcher and the profile
  editor SHALL show a missing or logged-out harness, and SHALL offer Log in, which
  opens a new tab in the room and shows the harness's own fixed login command,
  with Copy and Open its tab, for the user to run there and complete; World SHALL
  then re-check on request. The login command SHALL find the executable by the
  same lookup readiness uses on that host. World SHALL NOT type into the login
  tab: Herdr reports no prompt state, and a startup script reading a key would
  take typed text as its answer. Windows hosts
  SHALL NOT be probed; they SHALL report no readiness, which blocks no kind their
  Herdr supports.

#### Scenario: Logged out

- **WHEN** Codex is installed on a host and reports that it is not logged in
- **THEN** New agent says Codex is logged out there and offers Log in, which opens a tab running Codex's own login

#### Scenario: Status names the account

- **WHEN** a harness's status output includes the account's email address
- **THEN** World reports only whether it is logged in and the method, never the address

#### Scenario: A startup question in the login tab

- **WHEN** the user chooses Log in and the new tab's startup script waits for a single key
- **THEN** World has typed nothing there; the user sees the question, answers it and then runs the login command shown in New agent

#### Scenario: A Windows host

- **WHEN** New agent targets a room on a Windows host whose Herdr supports Claude
- **THEN** World does not probe the host and still offers Claude
