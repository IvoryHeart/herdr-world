# Office agent conversation bubble — centered placement extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-002`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

## Change

The static conversation bubble SHALL be centered in the Office stage viewport
when the viewport has sufficient space. It SHALL remain a fixed DOM slot,
retain the approximately 40% desktop footprint from extension 001, and keep
its connector as the only moving visual link to the selected target.

## Scenario

- **GIVEN** a live agent is selected in Office
- **WHEN** the conversation bubble opens
- **THEN** the terminal panel is centered in the stage viewport, remains fixed
  while the Office scrolls, and the connector points toward the selected agent

## Compatibility

This extension is compatible with the parent spec and extension 001. It changes
placement only; terminal transport, sizing semantics, selection, and handoff
behavior remain unchanged.
