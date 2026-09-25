## 1. Build one visual target resolver

- [x] 1.1 Defined an immutable selected-node target and pure resolver that requires the same selected entity, connection ID, generation, workspace, pane and terminal identity; focused tests cover no target, changed host, generation, selection and a disappeared observation without fallback.
- [x] 1.2 Mapped space, agent and terminal capabilities to the existing resource actions and Go to Spaces; focused tests prove host, space and non-agent terminals do not acquire inapplicable operations.

## 2. Add visual-route entry and dispatch

- [x] 2.1 Added the shared Actions control and visual-route command shortcut, while retaining the hidden Spaces command menu disablement; browser checks cover its named menu and no-selection guidance at desktop and phone widths.
- [x] 2.2 Routed resources through `applySelection`, requested the existing Inspector tab, and retained the shared qualified focus/terminal-owner path.
- [x] 2.3 Routed Go to Spaces through exact focus before the existing view navigation callback; request fencing keeps a failed or superseded focus in the visual route.
- [x] 2.4 Invalidated the capture on selection, connection, generation or projection change; focused resolver and browser checks prove retired targets expose a reason without dispatch.

## 3. Accept and document

- [x] 3.1 Exercised pointer and keyboard opening, named menu semantics, target labels, unavailable reasons and focus restoration at 1280px and 390px; the shared entry is passed to Office, Tree and Graph.
- [x] 3.2 Updated Features, the source map and Unreleased notes without implying task assignment, lifecycle control or terminal injection.
- [ ] 3.3 Synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect the final diff/history for generated output and sensitive data, then open a ready PR with exact evidence for independent review.
