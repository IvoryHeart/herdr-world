# Office agent conversation bubble — dual connector extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-005`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

## Change

The fixed conversation bubble MAY show two independent SVG connectors for a
selected agent: one to the agent's associated workbench/desk and one to the
agent's current visual position. The workbench connector SHALL remain stable
when the agent changes destination; the live-agent connector SHALL follow the
agent's current projected position. Each connector SHALL be rendered only when
its endpoint is visible in the Office viewport.

## Scenario

- **GIVEN** a live terminal is open for an agent with an associated workbench
- **WHEN** the agent moves between the bar, reception, and work floor
- **THEN** the workbench connector remains associated with the desk and the
  second connector follows the agent when visible

## Compatibility

This extension is compatible with the parent spec and extensions 001–004. It
changes only the visual connector model; terminal target identity, transport,
panel placement, and handoff behavior remain unchanged.
