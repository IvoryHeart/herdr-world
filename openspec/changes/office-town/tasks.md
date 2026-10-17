## 1. Prepare the ground

- [x] 1.1 Start from `main` rather than PR #204, which the owner judged too buggy to carry over; port a #204 fix only when a test on `main` reproduces its bug, and reuse its fixture scenarios against the town.
- [x] 1.2 Add a synthetic maximum-scale fixture (three hosts, eight rooms, fifteen desks, four panes) and a typical-day fixture; verify current input acknowledgement budgets as the baseline.
- [ ] 1.3 Close PR #204 as superseded once the town scene PR is merged.

## 2. Town model and scene

- [x] 2.1 Implement `layoutTown` as a pure function with desktop row and phone column forms, building interiors, room capacity steps, lounge and reception slots; verify placement, non-overlap and free-spot invariants in unit tests.
- [x] 2.2 Implement live placement stability (new tab takes the first free spot, closed tab frees its spot, rebuild re-derives from native order); verify with topology-change sequences.
- [ ] 2.3 Implement the art pipeline from design decision 1a: pixel sprite definitions, a load-time atlas, baked static layers, deterministic characters with all poses, and a sprite gallery fixture; retire the old character PNGs; verify deterministic appearance and review the gallery at 1x and 3x. (Done except the sprite gallery fixture and a shared atlas; textures are currently uploaded per sprite.)
- [x] 2.4 Render the town on Pixi with zoom levels, room culling and zoom-dependent detail; verify level transitions and that waiting attention is visible at every level in browser cases.
- [x] 2.5 Add room status cards and reception boards; verify card text, waiting counts and accessible names at the overview level.

## 3. Attention and replies

- [x] 3.1 Implement agent locations (blocked queue, done marker, idle lounge, overflow counts) as presentation over the existing status projection; verify state-change sequences keep exact pane targets.
- [x] 3.2 Implement the desktop attention rail (grouped, collapsible, hideable, persisted) and the phone tray using Desk triage ordering; verify ordering and next-agent navigation.
- [x] 3.3 Implement the peek with bounded latest lines, reply box, type-to-reply and digit answers; offer answer options when the latest lines show a numbered menu or yes/no prompt; verify exact-target delivery, retirement rejection, that hover alone never captures keys (terminal A focused while B is peeked), and that digits in the reply box are text.
- [ ] 3.4 Route room activation and double-tap to zoom, keep visible zoom controls, and connect phone Back through the shared system Back module; verify on 390 px fixtures.
- [x] 3.5 Add Town as its own World view next to Office (route, view switcher, phone navigation), restore the Pixel Office as Office, keep the rail inside Town with its own hide control, and use the shell's search, settings and Inspector.
- [x] 3.6 Send replies through World's terminal composer (Reply opens the pane with its composer), open the Inspector on Files, add reply and completion toasts and question, done, idle, sleep and typing bubbles, and queue finished agents at reception; verify exact-pane answers, the composer request and the Inspector view in the Town fixture.

## 4. Moves

- [ ] 4.1 Model desk and agent moves in Quint (capture before mutation, ordered steps, confirmation, pane ID replacement, rollback, generation authority, no cross-host, no replay of uncertain steps) and record the coverage entry.
- [ ] 4.2 Implement the qualified service move operation over `pane.move` with capability gating, split-tree capture and validation before any mutation, replay of the captured tree derived from herdr-drovr (MIT, notice retained in the source header and third-party notices), confirmation from Herdr events, an old-to-new pane ID map used for later splits and rollback, and rollback; verify against the model, with replaced-ID sequences, with drovr-equivalent layout-tree tests and with service tests for partial failure.
- [ ] 4.3 Add drag and Move-action flows with reserved spots, crew animation and topology-confirmed final placement; verify success, rejection, cross-host refusal and rollback in browser cases.
- [ ] 4.4 Optionally raise a cross-workspace tab move request with Herdr upstream, citing the herdr-drovr workaround.

## 5. Identity, profile and project signals

- [ ] 5.1 Derive agent identity from connection profile and reported session identity with qualified-pane fallback; verify stability across pane moves.
- [ ] 5.2 Add the profile surface showing only provider-backed figures from existing observations and the OpenTelemetry economy provider; verify the unavailable states.
- [ ] 5.3 Add the room project signal slot fed by optional providers mapped to workspaces; verify omission without a provider and text-plus-colour failure display.

## 6. Deliver

- [ ] 6.1 Run the full Office browser matrix on desktop and phone, the dense and maximum-scale performance fixtures, and the complete delivery gate.
- [x] 6.2 Update the README, knowledge map, `web/src/world/README.md` and the Unreleased changelog.
- [ ] 6.3 Inspect the diff for privacy, obtain independent review and open a ready PR without merging.
