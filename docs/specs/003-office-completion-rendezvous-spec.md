# Office completion rendezvous

- **Spec ID:** `003-office-completion-rendezvous`
- **Status:** Approved
- **Created:** 2026-08-09
- **Owner:** Herdr Web
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-09

> This specification is approved and immutable. Implementation evidence belongs
> in the paired summary; later intended changes require a numbered extension.

## 1. Purpose

When an agent completes work, Herdr currently announces completion and the
Office may move the agent to the Agent Bar. The sound is useful, but the user
cannot reliably tell which agent or desk produced it, especially when several
agents are active.

This feature makes completed work visible and directly actionable. When an
agent completes work, the agent may leave its room and become idle in the Agent
Bar, while a generic completed-work marker remains on the originating desk.
The marker identifies where the work happened without guessing what kind of
artifact was produced. Visually, the marker MAY use generic document sheets
lying on the desk or hanging/floating above it; those sheets are an office
metaphor, not a claim about the underlying artifact. The existing Reception
behavior for blocked or waiting agents remains unchanged.

The feature uses Herdr's existing distinction between work that is `done` and
work that is `idle`/seen. It adds an Office presentation and interaction layer;
it does not redefine Herdr's runtime state or imply that inspecting work means
approving or accepting it.

## 2. Scope

This feature includes:

- moving a completed `done` agent to the Agent Bar using the existing idle
  presentation while leaving a completion marker at the originating desk;
- a restrained, legible completion marker on the originating desk and room;
- a completion notice that identifies the exact host, agent, and pane or desk
  when the data is available;
- selecting the completed agent from its character, desk, completion cue,
  shared Herdr sidebar, or completion notice;
- opening or focusing the existing Office terminal bubble for the exact
  qualified target;
- treating a successful selection or terminal opening as the implicit
  inspection action, without calling it approved;
- keeping the terminal bubble in its existing stable screen position while
  the agent remains visible, moves, or transitions to the Agent Bar;
- preserving the existing Reception destination and visual treatment for
  blocked agents;
- distinct visual treatment for working, done/unseen, done/seen, blocked, and
  idle states where the Office currently presents those states, with the
  completion treatment attached to the work marker rather than the idle agent;
- stacking or counting multiple uninspected completion markers at one desk
  without pretending to know their artifact types; and
- deduplicating repeated completion snapshots or events; and
- unit, browser, accessibility, reduced-motion, and visual evidence coverage.

## 3. Non-goals

- No new Herdr meaning for `done`, `idle`, `blocked`, or `working`.
- No change to the existing behavior that sends blocked or waiting agents to
  Reception.
- No approval, acceptance, merge, sign-off, or server-side workflow.
- No requirement for a new server endpoint or a new terminal transport.
- No invented task summary, inferred completion reason, or fabricated commit,
  ticket, branch, or cost information.
- No permanent completion history, audit log, or cross-user acknowledgement
  store in the Office UI.
- No requirement that a completed agent remain at its desk or form a new
  physical queue near the CEO. The agent may move to the Agent Bar while its
  completed-work marker remains at the originating desk.
- No inference that the generic document-sheet artwork represents a document,
  package, crate, pull request, deployment, or other specific artifact when the
  harness or provider has not supplied one.
- No redesign of the Agent Bar, room art, responsive layout, or terminal
  movement and resizing behavior.
- No requirement that completion audio be changed. Audio correlation and the
  visual notice are in scope; sound design remains an independent concern.
- No requirement to wait for OTEL integration. The feature SHALL work with
  Herdr status data already available through Herdr Web.

## 4. Context and constraints

### 4.1 Existing Herdr states

Herdr already exposes agent states including `working`, `blocked`, `done`, and
`idle`. Herdr's documented distinction is that `done` represents finished work
that has not yet been seen, while `idle` represents completed work that has
been seen. The Office SHALL use this distinction for the completion notice and
inspection semantics, while keeping the visual work marker independent from
the agent's current Bar or room position.

The Office presentation state MAY contain a local `done/unseen` and
`done/seen` substate, but those names are presentation terms. The bridge MUST
not pretend that they are new Herdr server states. Moving an agent to the
Agent Bar is not, by itself, permission to remove its originating completion
marker. The Office's visual idle placement in the Agent Bar MUST NOT be
treated as a change of Herdr's underlying status from `done` to `idle`.

### 4.2 Blocked and Reception behavior

Blocked or waiting agents currently go to Reception. That behavior is useful:
it communicates that the agent needs human attention before work can continue.
This feature SHALL retain that behavior. A blocked agent MUST NOT be treated as
a completed agent and MUST NOT be moved to the Agent Bar by the completion
rendezvous flow.

If a blocked agent later becomes `working`, its existing Office transition
behavior applies. If it becomes `done`, the completion behavior in this spec
applies from its then-current location.

### 4.3 Existing terminal interaction

The Office already provides a live terminal bubble and supports up to five
terminal windows. Completion selection SHALL use the same qualified target
resolution, terminal capability checks, renderer lifecycle, focus behavior,
and window deduplication as ordinary agent or desk selection.

If the terminal is already open for the completed target, selecting the
completion cue SHALL focus the existing window rather than create a duplicate.

### 4.4 Stable visual placement

The completion marker belongs to the originating desk and room in the Office
scene. It MUST remain there when the agent moves to the Agent Bar. The terminal
bubble remains a stable viewport overlay. Agent movement, scene scrolling, and
a transition to the Agent Bar MAY update the connector line, but MUST NOT move
the terminal window as a side effect.

### 4.5 Event and snapshot availability

The first implementation SHALL work from the current Herdr Web snapshot and
agent-activity data. When the approved observability extension contract is
implemented, the Office SHOULD consume its stable event identity, transition
sequence, and completion timestamp where available.

The Office MUST not replay a completion notice merely because an unchanged
snapshot was refreshed or received again.

## 5. Requirements

### Requirement: Preserve blocked-agent Reception behavior

The system SHALL continue to place blocked or waiting agents in Reception
according to the current Office behavior.

#### Scenario: Agent is blocked and needs input

- **GIVEN** Herdr reports an agent as `blocked`
- **WHEN** the Office receives or refreshes that state
- **THEN** the agent remains represented in Reception, the existing blocked
  interaction remains available, and no completion cue or Agent Bar transition
  is applied

### Requirement: Separate agent movement from completed work

When Herdr reports a working agent as `done`, the Office SHALL move the agent
to the existing Agent Bar/idle presentation while leaving a generic
completed-work marker at the originating desk and room. This is an Office
placement decision and MUST NOT itself mark the Herdr work as seen.

#### Scenario: Working agent completes in an office room

- **GIVEN** an agent is working at an office desk
- **WHEN** Herdr reports that agent as `done`
- **THEN** the originating desk receives a completed-work marker, the room is
  briefly highlighted, and the agent moves to the Agent Bar as idle without
  carrying the marker with it

#### Scenario: The originating desk remains identifiable

- **GIVEN** a completed agent has moved from its office room to the Agent Bar
- **WHEN** the user looks at the Office after the completion cue has settled
- **THEN** the completed-work marker remains attached to the originating desk,
  and selecting that marker identifies the same qualified agent and terminal

#### Scenario: Multiple agents complete at one desk

- **GIVEN** several completion events are associated with the same desk before
  the user selects them
- **WHEN** the Office renders the desk
- **THEN** it uses a bounded stack, count, or equivalent compact treatment and
  does not require a different guessed artifact illustration for each event

### Requirement: Show a distinct completed-work marker

The Office SHALL distinguish completed but uninspected work from ordinary desk
state using a clear, restrained marker attached to the originating desk or
room. The marker represents completed work; it does not claim to identify the
artifact type.

The marker MUST include a non-colour signal, such as a check mark on generic
document sheets lying on the desk or hanging/floating above it. The exact
document arrangement MAY vary during visual review. Colour MAY reinforce the
state but MUST NOT be the only way to identify it.

The originating desk and room SHOULD draw attention briefly when the state
changes and SHOULD then leave a legible marker without continuous high-frequency
animation. It MUST NOT use
the existing ambiguous traffic-light presentation for this purpose.

#### Scenario: Completion cue is displayed

- **GIVEN** an agent transitions from `working` to `done`
- **WHEN** the Office renders the next admitted state
- **THEN** the originating desk has an identifiable completed-work marker, the
  marker has an accessible name equivalent to “Completed work awaiting
  inspection”, and the marker does not obscure the desk or room label

### Requirement: Correlate completion with an exact target

The Office SHALL associate each completion presentation with the most precise
qualified Herdr target available, including bridge/host profile and pane,
terminal, or agent-session identity where available.

#### Scenario: Two hosts contain similarly named agents

- **GIVEN** Host A and Host B both report an agent with the same display name
- **WHEN** either agent completes work
- **THEN** only the matching host-qualified agent and desk receive the
  completion treatment, and the completion notice identifies the correct host

### Requirement: Provide a discoverable completion notice

When a previously unseen completion is admitted, the Office SHALL provide a
discoverable notice through the existing Herdr Web notification or sidebar
path, and MAY provide a compact in-world notice or CEO-board count.

The notice SHALL identify the exact agent and host when available. It MAY show
an authoritative state label or harness-provided summary, but MUST fall back to
identity and completion state rather than inventing a task description.

#### Scenario: User hears a completion chime

- **GIVEN** an agent completes work while the user is viewing another part of
  the Office
- **WHEN** the completion notice is displayed
- **THEN** the user can identify the responsible host and agent from the notice
  and can select it to focus the corresponding Office agent and terminal

### Requirement: Use one implicit inspection action everywhere

Selecting a completed-work marker, originating desk, shared sidebar item, or
completion notice SHALL resolve to the same qualified target. The action SHALL
focus an existing terminal window or open one using the existing terminal
bubble behavior. A successful open or focus SHALL be the implicit inspection
action; the initial version SHALL NOT add a separate review or resolution
button.

#### Scenario: User selects the completed-work marker

- **GIVEN** a completed-work marker is visible at a desk
- **WHEN** the user clicks the marker or desk
- **THEN** the Office selects the exact originating agent, focuses or opens
  its terminal bubble, and keeps the terminal connected to that agent's
  qualified target

#### Scenario: User selects the sidebar completion item

- **GIVEN** the completed agent is visible in the shared Herdr sidebar
- **WHEN** the user selects that sidebar item while Office is active
- **THEN** the Office highlights the matching agent and desk and focuses or
  opens the same terminal target as a canvas selection

### Requirement: Treat implicit inspection as seen, not approved

When the completion terminal is successfully opened or focused, the Office
SHALL mark the corresponding completion notice and marker as seen/inspected.
The UI MUST NOT represent this action as approval, acceptance, or sign-off.
The initial version MUST NOT require a second acknowledgement action.

#### Scenario: User opens a completed agent terminal

- **GIVEN** a completed agent is in the `done/unseen` presentation state
- **WHEN** the user successfully opens or focuses its terminal bubble
- **THEN** the completion marker and notice are marked seen for the current
  Office view, the unseen attention treatment is removed or reduced, and the
  terminal remains available for interaction

#### Scenario: Terminal cannot be opened

- **GIVEN** a completion target is stale, offline, incompatible, or lacks
  terminal-attach capability
- **WHEN** the user selects its completion cue
- **THEN** the Office keeps the completion cue visible, explains that live
  inspection is unavailable, and MUST NOT mark the completion as seen merely
  because the selection failed

### Requirement: Keep the marker after the agent leaves

A completed-work marker SHALL remain attached to its originating desk while it
is unseen, even after the agent has moved to the Agent Bar. A successful
terminal open or focus SHALL clear or reduce the marker's unseen attention
treatment without requiring a separate user command.

#### Scenario: User inspects after the agent reaches the bar

- **GIVEN** a completed agent is idle in the Agent Bar and its completed-work
  marker remains at the originating desk
- **WHEN** the user selects the marker and successfully opens or focuses the
  terminal
- **THEN** the marker becomes seen or is cleared according to the existing
  visual treatment, with no additional review or resolution step

#### Scenario: Agent resumes work after completion

- **GIVEN** a completed-work marker exists for an originating desk
- **WHEN** Herdr reports that it is `working` again
- **THEN** the Office renders the normal working-room behavior for the agent,
  while retaining or compacting the prior marker according to the available
  completion identity; it MUST NOT attach the old marker to the new agent
  position

### Requirement: Keep connector continuity

If a terminal bubble is open for a completed agent, the existing connector
behavior SHALL continue to identify the terminal workbench, originating desk,
and current live agent where those anchors are available.

#### Scenario: Completed agent moves after inspection

- **GIVEN** the terminal bubble remains open while the completed agent changes
  from its desk to the Agent Bar
- **WHEN** the Office applies the new position
- **THEN** the terminal bubble remains in the same viewport location, the
  originating-desk connector remains associated with the completed-work
  marker, and the live-agent connector updates, hides, or reattaches according
  to the existing visibility rules

### Requirement: Deduplicate completion presentations

The Office SHALL treat repeated snapshots or repeated delivery of the same
completion event as one completion presentation.

#### Scenario: Snapshot refresh repeats a completed agent

- **GIVEN** an agent has already produced a completion cue for a completion
  identity
- **WHEN** the bridge sends the same state again without a new transition
- **THEN** the Office does not replay the notice, reset the seen state, move the
  agent, or create another terminal window

#### Scenario: Pane identity is reused for a later session

- **GIVEN** a pane identifier is reused by a later agent session
- **WHEN** the later session completes
- **THEN** its completion is treated as a new completion only when a distinct
  session, generation, sequence, or transition identity is available; the
  Office MUST avoid attributing it to the prior session

### Requirement: Support reduced motion and accessible selection

The completion treatment SHALL remain understandable with reduced motion
enabled and SHALL expose the same inspection action to keyboard and assistive
technology users.

#### Scenario: Reduced-motion preference is enabled

- **GIVEN** the user prefers reduced motion
- **WHEN** a completion is admitted
- **THEN** the Office uses a static or low-motion completion cue, preserves the
  completion label, and keeps the agent, desk, sidebar item, and notice
  keyboard-selectable

## 6. Data and interface contract

The Office presentation SHALL consume the existing Herdr agent status and
qualified target data. The following conceptual record describes the minimum
information needed by the completion reducer; it is not a requirement for a
new wire format:

```ts
type CompletionIdentity = {
  bridgeProfileId: string;
  paneId?: string;
  terminalId?: string;
  agentSessionId?: string;
  generation?: number;
  transitionSequence?: number;
  completedAt?: string;
};

type CompletionNotice = {
  identity: CompletionIdentity;
  displayAgent?: string;
  hostLabel?: string;
  paneLabel?: string;
  stateLabel?: string;
  summary?: string;
  status: "done";
};
```

The visual completed-work marker is intentionally generic in this version. It
MAY be drawn as document sheets on or above the desk, but that artwork MUST be
treated as a metaphor rather than an artifact-kind assertion. An optional
`summary` may improve the notice when an authoritative source provides one,
but the base contract MUST NOT require or infer an artifact kind.
Harness-specific artifact metadata belongs in a later extension after the
available harness reporting capabilities are understood.

The implementation SHALL use the strongest available completion identity in
this order:

1. provider or Herdr event ID with a qualified target;
2. agent session plus transition sequence or generation;
3. qualified pane/terminal plus transition timestamp; and
4. the current page's observed transition when no durable identity exists.

The final fallback MUST be scoped to the current page and MUST NOT claim
durable cross-refresh acknowledgement.

`summary` is optional and MUST be treated as untrusted display data. It SHALL
be bounded, escaped, and omitted when unavailable. The Office MUST use the
agent identity and status label as the fallback notice.

The seen/inspected state is a presentation acknowledgement. It MAY be held in
the current view or browser-local storage keyed by the completion identity. A
successful selection or terminal open is the initial version's implicit
acknowledgement; the UI MUST NOT add a separate approval, review, or resolution
command. This acknowledgement MUST NOT be sent as an approval command or
interpreted as a Herdr workflow decision.

When Spec 002's observability contract is available, its qualified target,
event identity, transition sequence, timestamp, and optional bounded summary
SHOULD populate this record without changing the Office interaction model.

## 7. Privacy and security

- Completion notices MUST use already-admitted Herdr identity and capability
  data; they MUST NOT expose raw terminal output, command text, credentials,
  environment variables, or arbitrary provider payloads.
- Optional summaries MUST be treated as potentially sensitive and displayed
  only within the existing host/target authorization boundary.
- Host-qualified identity MUST be preserved so a completion from one host
  cannot be opened or displayed as a target on another host.
- A stale, unauthorized, incompatible, or offline target MUST fail closed for
  live terminal inspection while retaining enough identity to explain the
  unavailable action.
- Browser-local seen state MUST not contain terminal content, artifact content,
  or credentials.
- Completion cues and notices MUST not execute content supplied by a harness,
  provider, or terminal.

## 8. Acceptance evidence

The implementation is accepted when the repository contains:

- reducer or unit coverage for `working → done/unseen → idle`, implicit
  inspection, `done → working`, and blocked-state preservation;
- browser coverage showing that a completed-work marker remains at its
  originating desk while the agent moves to the Agent Bar, is discoverable
  from the notice/sidebar, and opens the exact terminal target;
- browser coverage showing that a blocked agent remains in Reception and does
  not receive the completion treatment;
- coverage for duplicate snapshots, reused pane IDs, stale targets, offline
  hosts, and already-open terminal windows;
- coverage proving that terminal bubble geometry remains stable while the
  agent moves and that connectors update independently;
- keyboard, accessible-name, focus, and reduced-motion checks for completion
  selection;
- visual evidence for at least one desktop Office scene and one narrow or
  compact presentation, including the completion cue at readable size; and
- lint, unit, build, and focused Playwright evidence recorded in the paired
  implementation summary.

The completion cue SHOULD be reviewed at the existing world-view scale before
approval. Pixel-art details MAY change during that review as long as the cue
remains legible, non-colour-only, restrained, and target-associated.

## 9. Deferred decisions

- Exact completion artwork: document sheets lying on the desk, hanging/floating
  above it, or another compact metaphor with a clear completion mark.
- Whether the CEO board displays only a completion count or a bounded list of
  completed agents.
- Whether Herdr should receive a first-class “seen” acknowledgement API.
- Whether completion notices should remain visible across a full browser
  refresh when only snapshot-level identity is available.
- Whether a future completion history or activity timeline should retain
  completed work after the agent leaves the Agent Bar.
- Whether harness-provided artifact types, summaries, or links should be shown
  in the marker, notice, terminal header, or only in a later hover/timeline
  surface.
