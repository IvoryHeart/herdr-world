# Office agent conversation bubble — movable and resizable workspace extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-007`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

> This extension is approved and immutable. Implementation evidence and any
> drift belong in the paired summary; later intended changes require another
> numbered extension.

## 1. Purpose

The Office conversation bubble is currently centered at a fixed size. A user
may need to move it away from a particular room, enlarge it for terminal work,
or shrink it to keep more of the Office visible. The bubble must remain a
stable workspace while the selected agent moves through the Office; only its
visual connectors should react to scene movement.

This extension adds desktop drag and resize interaction without changing the
terminal identity, bridge transport, or Spaces handoff semantics.

## 2. Scope

This extension includes:

- dragging the open conversation bubble by its header;
- resizing the bubble through a visible resize affordance;
- clamping movement and size to the usable Office stage viewport;
- refitting the existing terminal renderer after every accepted resize;
- recomputing both workbench and live-agent connectors after movement,
  resizing, scrolling, viewport changes, and agent animation;
- retaining the chosen bubble geometry while switching the selected agent or
  while that agent changes Office destination;
- preserving the current default centered geometry for each newly opened
  conversation;
- applying a subtle translucent treatment to the Office conversation surface
  so the animated Office remains perceptible behind it while terminal content
  stays legible;
- retaining the current fixed mobile presentation, where the viewport is too
  constrained for reliable drag and resize gestures;
- keyboard-focusable, labelled move/resize affordances and visible focus
  treatment.

## 3. Non-goals

- Persisting bubble geometry across page reloads, browser sessions, hosts, or
  users.
- Changing terminal dimensions through a backend command or bridge protocol.
- Moving the Office scene, changing its camera, or changing the existing
  single-click/double-click selection gestures.
- Adding freeform terminal window management to the full Spaces view.
- Implementing a separate mobile drag/resize mode in this extension.
- Adding new connector types beyond the existing workbench and live-agent
  connectors.

## 4. Context and constraints

- The bubble is rendered as a DOM overlay inside `.world-stage-shell`; the
  Office scene is rendered separately and may scroll vertically or
  horizontally on compact layouts.
- The existing terminal renderer already supports resize/refit through its
  current `TerminalView` lifecycle. The extension SHALL use that path and
  SHALL NOT scale the terminal with CSS transforms or bitmap scaling.
- The current connectors are SVG paths rendered behind the bubble and are
  already independently gated by endpoint visibility.
- The agent's visual position is transient. The terminal target remains the
  qualified pane/terminal identity selected when the bubble opened.
- A drag gesture must not accidentally select an agent, activate a room, type
  into the terminal, or trigger the existing double-click handoff.
- The mobile layout currently uses a near-full-width, constrained-height
  bubble. It remains fixed in this extension so touch scrolling and terminal
  selection are not overloaded with window-management gestures.
- Transparency is a presentation treatment for the Office bubble only. The
  full Spaces terminal remains unchanged and opaque.

## 5. Requirements

### Requirement: Desktop bubble dragging

On layouts using the desktop Office presentation, the open conversation bubble
SHALL be movable by dragging its header. The drag SHALL use pointer capture,
update the bubble position continuously, and SHALL not begin from terminal
content or the header action buttons.

#### Scenario: Move the bubble without changing its terminal

- **GIVEN** a live Office conversation bubble is open on a desktop layout
- **WHEN** the user presses and drags the bubble header to a new position
- **THEN** the bubble follows the pointer, the terminal pane and session key
  remain unchanged, and no agent/room selection or Spaces handoff occurs

### Requirement: Bounded position

The system SHALL clamp the bubble to a usable rectangle inside the Office
stage. At minimum, the bubble header and close/action controls SHALL remain
reachable, and the bubble SHALL NOT be draggable outside the stage viewport.

#### Scenario: Drag toward a stage edge

- **GIVEN** a live bubble is open
- **WHEN** the user drags it beyond any edge of the usable stage rectangle
- **THEN** the bubble stops at the corresponding clamped edge and remains
  operable

### Requirement: Desktop bubble resizing

On layouts using the desktop Office presentation, the bubble SHALL expose a
visible resize affordance. Resizing SHALL update its CSS width and height
within declared minimum and maximum bounds, without changing its terminal
identity or applying visual scaling.

#### Scenario: Resize the terminal workspace

- **GIVEN** a live Office conversation bubble is open
- **WHEN** the user drags the resize affordance
- **THEN** the bubble changes size within the stage bounds and the terminal
  renderer is refit to the new available dimensions

### Requirement: Safe resize bounds

The system SHALL enforce a readable minimum bubble size and SHALL prevent a
resize from hiding the bubble's header, close control, resize affordance, or
the entire terminal surface. The maximum size SHALL be limited by the usable
Office stage rectangle.

#### Scenario: Resize beyond allowed limits

- **GIVEN** a live bubble is open
- **WHEN** the user drags the resize affordance below the minimum or beyond the
  usable stage rectangle
- **THEN** the size is clamped, the bubble remains operable, and no page-level
  horizontal or vertical overflow is introduced

### Requirement: Terminal refit without scaling

After an accepted size change, the system SHALL invoke the existing terminal
  resize/refit path using the bubble's actual CSS content dimensions. It MUST
  NOT use a CSS transform, canvas scaling, or bitmap snapshot to simulate the
  requested size.

#### Scenario: Resize preserves terminal legibility

- **GIVEN** the terminal is attached inside the conversation bubble
- **WHEN** the bubble is resized
- **THEN** terminal columns/rows are recalculated from the new content area,
  terminal text remains at the configured font size, and the terminal remains
  interactive

### Requirement: Subtle Office translucency

The Office conversation bubble SHALL use a controlled translucent background
and, where supported, a restrained backdrop treatment so that the Office scene
and its animations remain perceptible behind the surface. The implementation
MUST NOT apply blanket opacity to terminal text, the cursor, selection state,
connection overlays, or actionable controls.

#### Scenario: Observe the Office through the terminal surface

- **GIVEN** a live conversation bubble is open over an animated Office scene
- **WHEN** the scene animates behind the bubble
- **THEN** the user can discern the underlying Office movement while terminal
  output, input, cursor, controls, and connection state remain comfortably
  legible and interactive

### Requirement: Connector tracking after window movement

The existing workbench and live-agent connectors SHALL recompute their bubble
endpoints after every accepted drag or resize. Their SVG paths SHALL connect to
the current bubble edge rather than the previous centered position.

#### Scenario: Move the bubble and inspect both connectors

- **GIVEN** a selected agent has a visible workbench and live-agent endpoint
- **WHEN** the user moves or resizes the conversation bubble
- **THEN** both connector paths remain visible, terminate at the new bubble
  edge, and retain their distinct workbench/live-agent identities

### Requirement: Connector tracking after scene movement

The live-agent connector SHALL continue to follow the agent's projected
position while the workbench connector SHALL remain attached to the associated
workbench. Bubble position and size SHALL remain unchanged when the agent moves
between the work floor, reception, and Agent Bar.

#### Scenario: Agent moves while the bubble is manually positioned

- **GIVEN** the user has moved or resized a live conversation bubble
- **WHEN** the selected agent changes destination in the Office
- **THEN** the bubble's geometry remains unchanged, the workbench connector
  remains stable, and the live-agent connector follows the agent when its
  endpoint is visible

### Requirement: Geometry continuity across target changes

While the bubble remains open, selecting another admitted agent or desk SHALL
replace the terminal target in the existing bubble without resetting its
current position or size. Closing the bubble and opening a new conversation
MAY restore the default centered geometry.

#### Scenario: Switch agents after moving the bubble

- **GIVEN** a manually positioned and resized bubble is open for Agent A
- **WHEN** the user selects Agent B from the Office or shared sidebar
- **THEN** the same bubble geometry is retained and only the admitted terminal
  target, title, connectors, and session content change

### Requirement: Gesture isolation

Dragging the header or resize affordance SHALL suppress click, double-click,
text selection, and terminal input side effects caused by the same pointer
gesture. Clicking a header action button SHALL continue to invoke only that
button's existing action.

#### Scenario: A drag is not treated as a canvas gesture

- **GIVEN** a live bubble overlays part of the Office scene
- **WHEN** the user drags its header and releases
- **THEN** no underlying canvas selection, agent activation, room activation,
  or Spaces navigation is triggered

### Requirement: Responsive fallback

On the existing compact/mobile layout, the bubble SHALL remain fixed using its
current responsive dimensions. Desktop drag and resize affordances SHALL be
hidden or disabled, and the terminal SHALL remain usable for scrolling,
selection, and command input.

#### Scenario: Use the bubble on a narrow viewport

- **GIVEN** the Office is displayed at the existing compact/mobile breakpoint
- **WHEN** the user opens and interacts with the conversation bubble
- **THEN** the bubble remains within the current mobile layout, no resize
  handle captures terminal gestures, and terminal interaction remains intact

### Requirement: Accessible controls and feedback

The move and resize affordances SHALL have accessible names, keyboard focus
styles, and pointer cursors appropriate to their action. The bubble SHALL
expose a non-ambiguous moving/resizing state to assistive technology or the
existing application state model while a pointer gesture is active.

#### Scenario: Keyboard and assistive inspection

- **GIVEN** a live bubble is open on a desktop layout
- **WHEN** the user navigates to the move or resize affordance with the
  keyboard or accessibility tooling
- **THEN** each affordance has a meaningful accessible name and visible focus
  treatment, and its state is distinguishable from terminal content

## 6. Data and interface contract

- Bubble geometry SHALL be UI-local ephemeral state owned by the Office
  surface. It SHALL contain only position and size values in CSS pixels.
- Geometry SHALL be reset when the bubble is closed and SHALL NOT be written to
  bridge APIs, Herdr state, URL state, notes, or persistent preferences.
- Geometry updates SHALL be clamped against the current stage dimensions after
  resize, browser viewport changes, sidebar changes, and compact-layout
  transitions.
- The existing terminal session descriptor, pane identity, bridge identity,
  capability checks, and connector anchor contract remain unchanged.
- No bridge, Herdr, WebSocket, terminal protocol, or migration changes are
  permitted for this extension.

## 7. Privacy and security

- The feature SHALL transmit no new data and SHALL expose no new endpoint.
- Position and size values SHALL not contain terminal output, command input,
  credentials, or host metadata.
- Pointer handling SHALL remain scoped to the Office overlay and SHALL NOT
  intercept unrelated page gestures outside the bubble.

## 8. Acceptance evidence

- Unit coverage for position/size clamping, minimum/maximum bounds, geometry
  reset, and target-change continuity.
- Browser coverage proving desktop drag, desktop resize, terminal refit,
  gesture isolation, connector updates, and agent movement with a manually
  positioned bubble.
- Browser coverage proving the compact/mobile bubble remains fixed and the
  terminal remains interactive.
- Accessibility analysis with no serious or critical violations for the
  movable/resizable bubble state.
- Visual evidence at desktop and narrow viewports showing the bubble, resize
  affordance, both connector paths, and the translucent Office scene visible
  behind the bubble.
- Existing Office, terminal, handoff, and lifecycle suites remain green.

## 9. Deferred decisions

- Keyboard arrow-key movement and keyboard-based resizing are deferred unless
  the accessibility implementation requires them for equivalent operation.
- Persisting a user's preferred geometry across conversations or sessions is
  deferred and requires a separate approved extension.
- Multi-bubble layouts and manually docking the bubble to a room or agent are
  deferred.
