# Office agent conversation bubble — stage-bounded resize extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-008`
- **Status:** Approved
- **Created:** 2026-08-05
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-05

> This extension is approved and immutable. Implementation evidence and any
> drift belong in the paired summary; later intended changes require another
> numbered extension.

## 1. Purpose

The Office conversation bubble can currently be reduced or enlarged only to a
fixed 960×560 ceiling. The desktop workspace should be able to grow beyond
that preferred footprint when the Office stage has room, while remaining
bounded and operable.

## 2. Scope

- Retain the current centered default desktop footprint.
- Remove the fixed maximum size from interactive resizing.
- Allow the bubble to grow up to the current usable Office stage rectangle,
  including after viewport, sidebar, or layout changes.
- Retain the minimum dimensions, stage margin, terminal refit path, connector
  tracking, mobile fallback, and ephemeral geometry behavior from extension
  007.

## 3. Non-goals

- Increasing the default opening size.
- Allowing the bubble to escape the Office stage or introduce page overflow.
- Changing terminal font size, session identity, or backend protocols.
- Persisting the user's chosen size.

## 4. Requirements

### Requirement: Stage-bounded growth

Interactive resizing SHALL allow width and height to grow beyond the previous
960×560 preferred ceiling until the stage's usable width and height are
reached. The stage margin and minimum dimensions SHALL remain enforced.

### Requirement: Default footprint continuity

Opening a new conversation SHALL retain the existing preferred centered
footprint. This extension changes the resize ceiling only.

### Requirement: Resize continuity

Growing the bubble SHALL continue to use its actual CSS dimensions to refit the
terminal and SHALL preserve the selected target and both connector identities.

## 5. Acceptance evidence

- Unit coverage proves oversized geometry clamps to the stage rather than the
  former fixed ceiling.
- Browser coverage proves the existing pointer resize path still grows the
  bubble and remains interactive.
- Existing Office, terminal, connector, mobile, accessibility, and lifecycle
  suites remain green.

## 6. Deferred decisions

- A separate user preference for the default opening size remains deferred.
- Persisted geometry remains deferred and requires a later approved extension.
