## 1. Retire Graph, Tree and Office (Part A)

- [ ] 1.1 Move the line-anchor types (`OfficeCanvasAnchor`, `OfficeCanvasAnchors`, `OfficeConversationAnchors`, `OfficeConversationAnchorTarget`) from `PixelOfficeCanvas.tsx` to `worldConnectorGeometry.ts` as `World*` names, and update every importer; typecheck.
- [ ] 1.2 Remove Graph, Tree and Office from `worldViewRouting`, the view switcher, phone navigation and keyboard view shortcuts, and map `/office` to Town and `/graph` and `/tree` to Board (replacing the history entry), along with saved view values; test the routing.
- [ ] 1.3 Delete the retired views and the modules only they reach (the 36 files the import analysis lists), their unit and browser tests and their browser shard entries; typecheck, lint and run the Town, Board, Desk and Spaces suites.
- [ ] 1.4 Settings: keep Inspector presentation and Town calm motion; remove room alignment, long-title and Office scroll settings and their menu items; keep the `officePreferences:v1` key so surviving choices stay; test the reads of older saved values.
- [ ] 1.5 Move `verification/coverage.json` areas that name retired code (renderer lifetime, layout tests) to their Town or Board owners, with no-contract-impact notes; run `verification:gate`.
- [ ] 1.6 Update docs: the tutorial (remove the Office, Graph and Tree exercises; point to Town and Board), FEATURES, README, site screenshots and content tests, and the knowledge map. Add a CHANGELOG Removed entry naming the replacements; run `build:site`.
- [ ] 1.7 Lower the web asset budget to the new total with headroom.

## 2. Spec

- [ ] 2.1 Complete the MODIFIED deltas for every shared World surfaces requirement that lists Office, Tree or Graph (shared presentation, Actions, bounded composition, detail drawer, Town within the shell, Board view, creation, search), so the archived spec names only Town, Board, Desk and Spaces.

## 3. One interaction core (Part B)

- [ ] 3.1 Move `boardGesture.ts` to `world/interaction/gesture.ts` with configurable thresholds and a touch hold-to-drag; port Board's gesture tests and add Town's cases (hold to drag, a quick swipe pans, a second finger turns a drag into a pinch, the mouse drags after 6 px, double tap).
- [ ] 3.2 Move the trace and its overlay to `world/interaction/`, labelled per view (`?debug=town`, `?debug=board`, a ⋯ menu toggle in each view).
- [ ] 3.3 Make Board's frame loop an adapter over `registerWorldFrames` (reasons, keep-going while moving as motion frames, per-frame error isolation); verify settling, drag and the pause during terminal typing.
- [ ] 3.4 Move Town's pointer handling in `TownCanvas.tsx` onto the shared machine; run the Town browser suite and a real-input touch run at phone size.

## 4. Delivery

- [ ] 4.1 Run the full delivery gate, open the PR with the decisions to review (redirect targets, removed settings) and archive the change after merge.
