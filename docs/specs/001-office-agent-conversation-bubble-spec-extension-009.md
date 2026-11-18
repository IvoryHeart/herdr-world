# Office agent conversation bubble — full terminal surface extension

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Extension ID:** `001-office-agent-conversation-bubble-extension-009`
- **Status:** Approved
- **Created:** 2026-08-05
- **Requested by:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-05

> This extension is approved and immutable. Implementation evidence and any
> drift belong in the paired summary; later intended changes require another
> numbered extension.

## 1. Purpose

After enlarging the Office conversation bubble, the terminal content surface
still appears inset inside the bubble. The terminal should use the full
available bubble content area while preserving terminal cell sizing and
legibility.

## 2. Scope

- Remove the shared terminal host padding only inside the Office conversation
  bubble.
- Continue the controlled translucent terminal background across any small
  remainder caused by whole-cell Ghostty sizing.
- Preserve actual terminal font size and cell dimensions; no CSS scaling or
  bitmap stretching is permitted.
- Retain the existing upload control, terminal interaction, resize/refit path,
  connector tracking, and full Spaces terminal styling.

## 3. Non-goals

- Changing the shared Spaces terminal layout.
- Changing terminal font size, cell metrics, or backend resize semantics.
- Persisting geometry or adding new terminal protocol behavior.

## 4. Acceptance evidence

- Browser coverage proves the Office terminal host has no inner padding and
  begins at the full terminal-stage edge after opening and resizing.
- Existing pointer resize, terminal interaction, Office, mobile,
  accessibility, and lifecycle suites remain green.

## 5. Deferred decisions

- Fractional-cell remainder handling remains renderer-owned; the matching host
  background must cover it without stretching the rendered canvas.
