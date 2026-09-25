## 1. Build one visual target resolver

- [ ] 1.1 Define the immutable visual action target from a selected `WorldObject` node and a pure resolver against the current selected-host/generation store; verify missing target, collision, stale host, changed generation and unsupported capability all fail without fallback.
- [ ] 1.2 Map current space/agent/terminal capabilities to Terminal, Files, Changes, History and Go to Spaces availability; verify host-only, non-agent, missing-session and stale entities never acquire inapplicable actions.

## 2. Add visual-route entry and dispatch

- [ ] 2.1 Add a common Actions control and visual-route keyboard entry in the shared top bar, leaving Spaces' command menu disabled while hidden; verify the menu announces the exact target and no-selection guidance on desktop and compact layouts.
- [ ] 2.2 Dispatch resource actions through the existing `applySelection`/Inspector path with the requested resource tab; verify opening the same entity in another view focuses one conversation and creates no second terminal attachment.
- [ ] 2.3 Implement Go to Spaces through exact target focus followed by existing view navigation; verify it changes neither selected host nor Herdr topology and that failure leaves the user in the visual view.
- [ ] 2.4 Close or invalidate the menu on entity selection, connection or generation change; verify a delayed focus or action result cannot report success or act through hidden Spaces focus after its target retires.

## 3. Accept and document

- [ ] 3.1 Exercise pointer, keyboard, touch and screen-reader paths across Office, Tree and Graph with active, stale and disappearing targets; verify action labels, disabled reasons and focus restoration are coherent.
- [ ] 3.2 Update Features/shortcuts and the current source map for the visual Actions route, add an Unreleased entry, and verify documentation does not imply task assignment or agent lifecycle control.
- [ ] 3.3 Synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect the final diff/history for generated output and sensitive data, then open a ready PR with exact evidence for independent review.
