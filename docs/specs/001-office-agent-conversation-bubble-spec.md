# Office agent conversation bubble

- **Spec ID:** `001-office-agent-conversation-bubble`
- **Status:** Approved
- **Created:** 2026-08-04
- **Owner:** Herdr Web
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

> This specification is approved and immutable. Implementation evidence and
> deviations belong in the paired summary after delivery; later intended
> changes require a numbered extension.

## 1. Purpose

The Office view currently makes agent activity visible, but a user must
double-click an agent and leave the Office to interact with its terminal. This
feature adds an in-place conversation bubble so the Office remains the primary
context while the user reads output and sends normal terminal input to the
selected agent.

The bubble is a live terminal surface, not a chat transcript or a visual
simulation. It SHALL reuse the existing Herdr Web terminal and bridge session
semantics so commands have the same meaning as they do in Spaces.

## 2. Scope

This feature includes:

- opening a live terminal bubble when an admitted Office agent is selected with
  a single click;
- opening the same bubble when an agent is selected from the shared Herdr
  sidebar while Office is active;
- displaying the selected agent identity and host context in the bubble;
- reusing the existing terminal renderer and all capabilities admitted for the
  selected host, including terminal input, mouse interaction, scroll, resize,
  selection, upload, and mobile terminal controls where supported;
- preserving the existing double-click handoff to the full Spaces terminal;
- replacing the bubble target when another agent is selected;
- explicit close, Escape-key close, and close-on-successful full Spaces handoff;
- a desktop bubble target of approximately one quarter of the viewport area,
  with readable minimum dimensions and no visual scaling of terminal text;
- a usable narrow-viewport presentation as an anchored terminal panel while
  retaining the existing Office scene and navigation controls; and
- unit, browser, accessibility, interaction, and evidence coverage for the
  behavior.

## 3. Non-goals

- No new Herdr endpoint, bridge endpoint, protocol field, or terminal
  transport.
- No second terminal implementation, chat protocol, transcript store, or
  message history separate from the live terminal.
- No change to the meaning of snapshot admission, host compatibility, stale
  state, terminal capabilities, or exact target qualification.
- No automatic command execution, agent prompting, or background terminal
  attachment when an agent has not been selected.
- No replacement of the full Spaces terminal or removal of the existing
  double-click behavior.
- No responsive reflow of the Office art itself. The bubble may adapt its own
  overlay geometry for narrow viewports.
- No invented terminal content or inferred agent state when the selected host
  is stale, offline, incompatible, or missing the required terminal capability.

## 4. Context and constraints

### 4.1 Existing terminal path

Herdr Web already renders `TerminalView` for the selected qualified pane and
derives attach, input, resize, scroll, and upload permissions from the admitted
runtime state. The bubble SHALL use that same descriptor and capability gate.
The feature SHALL not create an alternate WebSocket or bypass the existing
bridge admission checks.

### 4.2 Office selection

The Office canvas already exposes an agent key for single selection and a
separate activation callback for double-click handoff. The implementation SHALL
resolve the selected Office agent back to its qualified bridge profile, pane,
terminal, and observed generation before opening a bubble.

### 4.3 Rendering model

The bubble SHALL be a positioned DOM layer above the Office stage. Terminal
content SHALL be rendered at the configured terminal font size in CSS pixels;
the bubble SHALL not use a CSS transform or bitmap scale to fit the terminal.
The terminal renderer SHALL receive the bubble's actual content-box dimensions
through the existing resize path.

The bubble SHALL open in a predictable static stage slot with broad safe
placement bounds. The preferred desktop slot is the lower-right area of the
stage viewport, inset from the stage chrome; the exact slot may be tuned during
visual review. Its position SHALL be independent of the selected agent's
current canvas coordinates. A connector tail, pointer, or other lightweight
visual link MAY point from the bubble toward the selected agent, but that link
is the only part that may move when the agent moves or the Office is scrolled.
If the selected agent is outside the visible scene or no longer has a stable
screen coordinate, the bubble SHALL remain in its static slot and the link MAY
be hidden or shortened.

The desktop target is approximately 25% of the viewport area. The exact CSS
size MAY vary with viewport dimensions, but it SHALL respect readable minimum
width/height constraints and SHALL not obscure the Office navigation controls.
On narrow viewports, the bubble MAY expand toward a bottom-sheet or near-full
width panel because preserving terminal interaction is more important than
maintaining the desktop area ratio.

### 4.4 One active conversation surface

At most one Office conversation bubble SHALL be open at a time. The existing
full terminal surface and the bubble SHALL not attach two independent terminal
sessions to the same target merely because the user transitions between them.

## 5. Requirements

### Requirement: Open a live bubble from an agent selection

When the user single-clicks an admitted Office agent, the system SHALL select
that agent and open a conversation bubble containing its live terminal.

#### Scenario: A room, reception, or bar agent is selected

- **GIVEN** the Office contains an agent whose host is live, compatible, and
  terminal-attach capable
- **WHEN** the user single-clicks the agent's visible character, name, or state
  cue
- **THEN** the agent is highlighted, one conversation bubble opens, and the
  bubble attaches to that agent's qualified terminal target.

### Requirement: Open the same bubble from the shared sidebar

When Office is active, selecting an agent row in the shared Herdr sidebar SHALL
open the same conversation bubble for the exact qualified pane represented by
that row.

#### Scenario: Sidebar and canvas identify the same agent

- **GIVEN** an agent is visible in both the Office and the shared sidebar
- **WHEN** the user selects the agent in the sidebar
- **THEN** the Office highlight and the bubble target identify the same bridge
  profile, pane, terminal, and observed generation.

### Requirement: Reuse full terminal capabilities

The bubble SHALL reuse the existing terminal component and SHALL preserve every
capability admitted for the selected target: terminal input, keyboard and mouse
interaction, scroll, resize negotiation, text selection, upload, and supported
mobile terminal controls. A capability that is unavailable for the selected
host SHALL remain disabled or unavailable in the bubble with the existing
explanation.

#### Scenario: The user works inside the bubble

- **GIVEN** the selected host admits terminal input and resize
- **WHEN** the user types, sends control keys, scrolls, selects text, or resizes
  the bubble terminal
- **THEN** Herdr receives the same qualified terminal operations as it would from
  the full Spaces terminal, and the terminal remains at the configured font
  size rather than being visually scaled.

### Requirement: Keep double-click handoff authoritative

Double-clicking an Office agent SHALL retain the existing exact handoff to
Spaces. A successful handoff SHALL close the bubble, open the same qualified
target in the full terminal surface, and preserve the current generation and
host admission checks.

#### Scenario: The user promotes a bubble to the full terminal

- **GIVEN** a conversation bubble is open for a live agent
- **WHEN** the user double-clicks that agent in the Office
- **THEN** the bubble closes and Spaces opens the exact agent terminal without
  creating a second ambiguous target.

### Requirement: Handle target replacement and close actions

The bubble SHALL expose an accessible close control and SHALL close on Escape.
Selecting a different admitted agent SHALL replace the current bubble target
without leaving the prior terminal attached after its teardown completes.
Replacing the target SHALL preserve the bubble's current screen position; the
terminal SHALL NOT jump to the newly selected agent.

#### Scenario: The user changes agents

- **GIVEN** a bubble is open for Agent A
- **WHEN** the user selects Agent B
- **THEN** the Office highlight moves to Agent B, the bubble identifies Agent B,
  the connector link updates toward Agent B if visible, the bubble remains in
  the same screen slot, and the previous terminal surface is detached or fully
  released according to the existing `TerminalView` lifecycle.

### Requirement: Prioritise stable terminal placement over agent tracking

Once opened, the bubble SHALL remain in its static slot when the selected agent
changes semantic destination, workspace, host presentation, or screen position.
The system MUST NOT move the terminal bubble from reception to a room, from a
room to the Agent Bar, or between rooms merely because the agent state changed.
Only the connector link MAY change in response to those transitions.

#### Scenario: A waiting agent returns to work

- **GIVEN** an agent is selected while waiting at reception and its terminal
  bubble is open
- **WHEN** the agent is approved and its admitted state changes so that it moves
  to an office room
- **THEN** the bubble remains at the same screen coordinates, the terminal
  session continues for the same qualified target, and only the connector link
  changes to the agent's new visible position.

#### Scenario: The agent leaves the visible Office scene

- **GIVEN** the bubble is open for a selected agent
- **WHEN** a snapshot update or Office scroll places the agent outside the
  visible canvas viewport
- **THEN** the bubble remains usable in its static slot and the connector link
  is hidden or presented as unavailable without moving or resizing the bubble.

### Requirement: Refuse unavailable live interaction safely

Selecting a stale, offline, incompatible, disabled, or terminal-attach
ineligible agent MAY update the Office highlight, but SHALL NOT open an
interactive terminal bubble. The user SHALL receive the existing truthful
handoff/capability explanation or an equivalent concise status in the Office.

#### Scenario: A retained stale agent is selected

- **GIVEN** the Office retains an agent from a host whose current admitted state
  is offline or stale
- **WHEN** the user selects that agent
- **THEN** the agent may be highlighted, no terminal WebSocket is opened, and
  the UI clearly states that live interaction is unavailable.

### Requirement: Keep the bubble legible and usable across viewport sizes

On desktop, the bubble SHALL target approximately one quarter of the viewport
area while meeting the approved minimum dimensions. Terminal text SHALL remain
at the configured font size, and the terminal SHALL resize to the bubble rather
than being scaled to fit. On a narrow viewport, the bubble SHALL remain fully
interactive, keep its controls reachable, and SHALL not prevent access to the
close/back control.

#### Scenario: Desktop and narrow viewport rendering

- **GIVEN** the same live agent is selected at a desktop viewport and a narrow
  viewport
- **WHEN** the bubble opens
- **THEN** desktop dimensions are near the quarter-screen target, narrow layout
  uses a readable panel fallback, terminal font size is unchanged, and the
  terminal receives a resize for the rendered dimensions in both cases.

### Requirement: Preserve Office interaction and accessibility

The Office SHALL remain visible and its animation/scroll behavior SHALL remain
available behind the bubble except where the bubble intentionally captures
pointer or keyboard input. The bubble SHALL have an accessible dialog/name,
reachable close control, visible focus treatment, and no serious or critical
axe violations.

#### Scenario: Keyboard and pointer focus move between surfaces

- **GIVEN** a bubble is open above the Office canvas
- **WHEN** the user tabs through its controls, sends terminal input, presses
  Escape, or closes it
- **THEN** focus remains operable, terminal keystrokes do not activate the
  Office canvas underneath, Escape closes the bubble, and focus returns to the
  selected Office agent or its sidebar row when possible.

## 6. Data and interface contract

- The bubble SHALL consume the existing `PaneInfo`, runtime generation key,
  bridge connection state, terminal session descriptor, and capability flags.
- The qualified target SHALL include the bridge profile identity and native
  terminal/pane identity; native IDs SHALL NOT be treated as globally unique
  across hosts.
- No new persisted preference is required for the first iteration. Bubble open
  state MAY be ephemeral UI state.
- No terminal output SHALL be copied into a new application store merely to
  render the bubble; the existing terminal renderer remains the source of
  visible output.
- Connection, stale, and capability errors SHALL use existing bridge/runtime
  semantics and SHALL not be downgraded into a generic successful chat state.

## 7. Privacy and security

- The bubble SHALL inherit the existing bridge origin, admission, capability,
  and qualified-target checks.
- It MUST NOT expose terminal content through logs, analytics, localStorage,
  screenshots, or a new history store by default.
- It MUST NOT add credentials, tokens, SSH handling, or a new network path.
- Uploads and terminal input SHALL remain governed by the existing admitted
  capabilities and bridge validation.

## 8. Acceptance evidence

- Unit tests cover Office-agent-to-pane resolution, unavailable-target gating,
  bubble replacement, and exact target identity.
- Browser tests cover single-click canvas selection, sidebar selection,
  terminal bubble visibility, terminal input/resize through the fixture bridge,
  close/Escape, target replacement, double-click handoff, stale suppression,
  host-ID collision isolation, and stable placement across an agent destination
  transition.
- Accessibility tests cover dialog naming, keyboard focus, Escape, close, and
  serious/critical axe violations.
- Visual evidence covers a legible desktop bubble and a narrow viewport panel
  without terminal text scaling, plus a connector update that does not move the
  bubble when an agent changes location.
- Existing `npm run check`, `npm run test:e2e`, security, independence, and
  renderer lifecycle checks remain green.

## 9. Deferred decisions

- Whether the bubble should support pinning, multiple simultaneous bubbles, or a
  detachable/pop-out window.
- Whether a future Herdr plugin can provide richer agent conversation metadata
  beside the terminal.
- Whether bubble placement should become a user-configurable preference after
  the first visual review.
