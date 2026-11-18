# Office agent conversation bubble — standard terminal footprint extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-004`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

## Change

The centered Office conversation bubble SHALL use a wider rectangular desktop
footprint appropriate for an approximately 96-column by 30-row terminal. The
terminal SHALL continue to fit to its real CSS container dimensions; CSS
transforms and bitmap scaling are not permitted.

The selected terminal SHALL remain anchored to its admitted pane and terminal
identity while the associated agent changes visual destination, status, or desk
occupancy during live observation updates. A transient observation refresh
SHALL NOT dismiss the bubble or replace the selected terminal target.

## Scenario

- **GIVEN** a conversation bubble is open for a desk or agent terminal
- **WHEN** the agent changes from idle/reception/bar state to working/room state
- **THEN** the bubble remains open, its terminal remains attached to the same
  pane, and only the Office connector follows the changed visual position

## Compatibility

This extension is compatible with the parent spec and extensions 001–003. It
changes the desktop geometry and target-lifecycle resilience only; terminal
transport, selection semantics, and Spaces handoff behavior remain unchanged.
