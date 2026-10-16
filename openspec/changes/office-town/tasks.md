## 1. Prepare the ground

- [ ] 1.1 Carry the PR #204 projection fixes, semantic target layer, viewport-bounded paint and its 390/1440/3440 px fixtures onto a branch from `main`; verify the existing Office browser and performance cases still pass.
- [ ] 1.2 Add a synthetic maximum-scale fixture (three hosts, eight rooms, fifteen desks, four panes) and a typical-day fixture; verify current input acknowledgement budgets as the baseline.
- [ ] 1.3 Close PR #204 with a pointer to this change once 1.1 is merged.

## 2. Town model and scene

- [ ] 2.1 Implement `layoutTown` as a pure function with desktop row and phone column forms, building interiors, room capacity steps, lounge and reception slots; verify placement, non-overlap and free-spot invariants in unit tests.
- [ ] 2.2 Implement live placement stability (new tab takes the first free spot, closed tab frees its spot, rebuild re-derives from native order); verify with topology-change sequences.
- [ ] 2.3 Generate the pixel atlas (tiles, furniture, roofs, façades, characters with walk/sit/carry frames) and retire the old character PNGs; verify deterministic appearance per identity.
- [ ] 2.4 Render the town on Pixi with zoom levels, room culling and zoom-dependent detail; verify level transitions and that waiting attention is visible at every level in browser cases.
- [ ] 2.5 Add room status cards and reception boards; verify card text, waiting counts and accessible names at the overview level.

## 3. Attention and replies

- [ ] 3.1 Implement agent locations (blocked queue, done marker, idle lounge, overflow counts) as presentation over the existing status projection; verify state-change sequences keep exact pane targets.
- [ ] 3.2 Implement the desktop attention rail (grouped, collapsible, hideable, persisted) and the phone tray using Desk triage ordering; verify ordering and next-agent navigation.
- [ ] 3.3 Implement the peek with bounded latest lines, reply box, type-to-reply and digit answers; add structured answer options only where an integration exposes them; verify exact-target delivery and retirement rejection.
- [ ] 3.4 Route room activation and double-tap to zoom, keep visible zoom controls, and connect phone Back through the shared system Back module; verify on 390 px fixtures.
- [ ] 3.5 Integrate Office into the World shell: rail in the left sidebar slot with its hide control, counts as an in-scene overlay, search and settings through the shell, shell view switching and phone bottom navigation unchanged; verify switching to Graph, Desk and Spaces keeps the same Inspector presentations.

## 4. Moves

- [ ] 4.1 Model desk and agent moves in Quint (ordered steps, confirmation, rollback, generation authority, no cross-host, no replay of uncertain steps) and record the coverage entry.
- [ ] 4.2 Implement the qualified service move operation over `pane.move` with capability gating, confirmation from Herdr events and rollback; verify against the model and with service tests for partial failure.
- [ ] 4.3 Add drag and Move-action flows with reserved spots, crew animation and topology-confirmed final placement; verify success, rejection, cross-host refusal and rollback in browser cases.
- [ ] 4.4 Raise the cross-workspace tab move request with Herdr upstream.

## 5. Identity, profile and project signals

- [ ] 5.1 Derive agent identity from connection profile and reported session identity with qualified-pane fallback; verify stability across pane moves.
- [ ] 5.2 Add the profile surface showing only provider-backed figures from existing observations and the OpenTelemetry economy provider; verify the unavailable states.
- [ ] 5.3 Add the room project signal slot fed by optional providers mapped to workspaces; verify omission without a provider and text-plus-colour failure display.

## 6. Deliver

- [ ] 6.1 Run the full Office browser matrix on desktop and phone, the dense and maximum-scale performance fixtures, and the complete delivery gate.
- [ ] 6.2 Update the README Office section, knowledge map, `web/src/world/README.md` and the Unreleased changelog; synchronize current specs after `simultaneous-multi-host` is archived or reconciled.
- [ ] 6.3 Inspect the diff for privacy, obtain independent review and open a ready PR without merging.
