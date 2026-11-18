# Office agent conversation bubble — desktop workspace extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-001`
- **Status:** Approved
- **Created:** 2026-08-04
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-04

> This extension is approved as part of the implementation request. It changes
> only the intended desktop overlay footprint; all other parent requirements
> remain unchanged.

## Change

The desktop conversation bubble SHALL use approximately 40% of the Office
stage viewport when space permits, while retaining readable minimum dimensions,
safe insets from stage chrome, the fixed static position, and the narrow
viewport fallback defined by the parent spec.

## Scenario

- **GIVEN** an Office viewport wide enough for the conversation bubble
- **WHEN** an agent is selected
- **THEN** the live terminal opens in the fixed lower-right slot at roughly 40%
  of the stage viewport without CSS or bitmap scaling

## Compatibility

This extension is compatible with the parent spec. It does not change terminal
transport, selection semantics, double-click handoff, target replacement, or
connector behavior.
