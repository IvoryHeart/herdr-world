# Office agent conversation bubble — desk terminal extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-003`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

## Change

Selecting an Office desk SHALL open the live terminal for its attached agent
when the desk is occupied. When the desk has no projected agent occupant but
its attached tab has a live pane, selecting the desk SHALL open that pane as a
shell terminal. Empty or unavailable desks SHALL remain selection-only.

## Scenario

- **GIVEN** a desk is occupied by an admitted agent
- **WHEN** the desk is single-selected
- **THEN** the conversation bubble opens for that agent's qualified terminal

- **GIVEN** a desk has a live non-agent pane in its attached tab
- **WHEN** the desk is single-selected
- **THEN** the conversation bubble opens for that shell pane

## Compatibility

This extension is compatible with the parent spec. Existing stale/offline /
incompatible capability gates and double-click Spaces handoffs remain in force.
