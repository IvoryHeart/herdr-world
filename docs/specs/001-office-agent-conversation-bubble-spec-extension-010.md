# Office agent conversation bubble — multi-window workspace extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-010`
- **Status:** Approved
- **Created:** 2026-08-05
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-05

> This extension is approved and immutable. Implementation evidence and any
> drift belong in the paired summary; later intended changes require another
> numbered extension.

## 1. Purpose

The Office conversation bubble is currently a single terminal workspace. A
user observing multiple hosts may need to keep several agent terminals open at
once while comparing activity across rooms and hosts.

This extension adds a bounded set of simultaneous Office terminal windows.

## 2. Scope

- Allow up to five open Office terminal windows at once.
- Keep each window attached to one qualified bridge/pane terminal identity.
- Focus an already-open window when its agent, desk, or sidebar pane is
  selected again instead of opening a duplicate terminal for the same pane.
- Give each window independent position, size, z-order, terminal session, and
  workbench/live-agent connectors.
- Keep the window geometry stable while its agent changes Office destination.
- Bring a selected window to the front and update the Office selection/highlight
  to match it.
- Close only the requested window; closing one window MUST NOT close the others.
- Reject a sixth distinct terminal with a visible, non-destructive status
  message and leave the existing five windows unchanged.
- Retain the current single-window mobile presentation until a later mobile
  configuration extension.

## 3. Non-goals

- User-configurable window limits or persisted window layouts.
- Opening an unbounded number of windows based on desk count.
- Changing Herdr, bridge, terminal, or WebSocket protocols.
- Turning the Office into a general-purpose window manager.
- Changing the existing full Spaces terminal view.

## 4. Requirements

### Requirement: Bounded multi-window count

The Office SHALL render no more than five simultaneous conversation windows.

#### Scenario: Open five distinct terminals

- **GIVEN** fewer than five Office conversation windows are open
- **WHEN** the user selects distinct admitted agent or desk terminals
- **THEN** each selected terminal opens in its own Office window until the
  count reaches five

#### Scenario: Attempt a sixth terminal

- **GIVEN** five Office conversation windows are open
- **WHEN** the user selects a sixth distinct admitted terminal
- **THEN** no sixth terminal opens, existing windows remain unchanged, and the
  Office displays a concise instruction to close a window first

### Requirement: Terminal identity deduplication

The system SHALL identify an Office conversation window by its qualified
bridge/pane terminal identity. Selecting the same terminal through an agent,
desk, or shared sidebar entry SHALL focus and update the existing window
without opening a duplicate renderer or WebSocket session.

#### Scenario: Select an occupied desk after its agent

- **GIVEN** an agent terminal is already open
- **WHEN** the user selects the occupied desk or the same pane from the
  sidebar
- **THEN** the existing window comes to the front and remains the only window
  for that terminal

### Requirement: Independent window state

Each open window SHALL retain independent geometry, z-order, terminal target,
and connector state. Moving or resizing one window MUST NOT move or resize the
others.

#### Scenario: Move one of several windows

- **GIVEN** at least two Office conversation windows are open
- **WHEN** the user moves or resizes one window
- **THEN** only that window changes geometry and all open terminals remain
  interactive

### Requirement: Focus and close behavior

Selecting a window, its terminal content, or its source agent/desk SHALL bring
that window to the front. Closing a window SHALL remove only that window and
release its terminal renderer and transport resources.

#### Scenario: Close the focused window

- **GIVEN** multiple Office conversation windows are open
- **WHEN** the user closes the focused window or presses Escape
- **THEN** only the focused window closes and another remaining window may be
  focused without changing its geometry

### Requirement: Connector continuity

Each window SHALL retain separate workbench and live-agent connectors. The
connectors SHALL follow the associated window's geometry and the selected
agent's current Office position independently of other windows.

#### Scenario: Two agents move independently

- **GIVEN** two conversation windows are open for agents on different hosts or
  in different rooms
- **WHEN** either agent changes Office destination or scroll visibility
- **THEN** only that window's live-agent connector changes while both
  workbench connectors remain associated with their own terminals

### Requirement: Compact behavior

On compact/mobile layouts, the system SHALL retain one active conversation
presentation at a time until a later approved mobile extension defines a
multi-window layout.

## 5. Compatibility

This extension is compatible with the parent spec and extensions 001–009. It
changes only the Office overlay ownership and presentation from one window to
a bounded set; terminal identity, host qualification, bridge transport,
Spaces handoff, and existing mobile behavior remain unchanged.
