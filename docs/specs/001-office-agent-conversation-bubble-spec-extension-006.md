# Office agent conversation bubble — full Spaces handoff extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-006`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

## Change

The conversation bubble SHALL provide an explicit control to open the current
terminal in the full Spaces view. Activating the control SHALL select the same
admitted pane, preserve its bridge and tab context, close the Office bubble,
and focus the normal full-size terminal view.

## Scenario

- **GIVEN** a live Office conversation bubble is open
- **WHEN** the user activates “Open full terminal in Spaces”
- **THEN** Herdr Web switches to Spaces with the same pane selected and the
  full terminal available for continued interaction

## Compatibility

This extension is compatible with the parent spec and extensions 001–005. It
adds navigation from the existing bubble only; terminal identity, transport,
Office selection, and double-click handoff behavior remain unchanged.
