## 1. Shared metadata and identity

- [x] 1.1 Add bounded tab/pane appearance types, parsing and field operations to the existing shared document; verify persistence, malformed input, reset and multi-field preservation tests.
- [x] 1.2 Add exact-runtime write admission with terminal witnesses; verify stale generations, reused IDs, failed reads and cross-connection isolation through service tests.
- [x] 1.3 Bind legacy tab colours and reconcile moves without duplicate colour storage or pruning unavailable hosts; verify migration, continuity, move and unknown-observation regressions.

## 2. Common editor and projections

- [x] 2.1 Add the common desktop/phone terminal header editor with native tab naming, colour/status and per-pane bounded avatars; verify browser save/reset/error/split-pane scenarios.
- [x] 2.2 Project shared appearance in Board, Town, Desk and Spaces while preserving runtime badges and default profile looks; verify selectors and view/browser regressions across two clients.

## 3. Contract and delivery evidence

- [x] 3.1 Synchronize the affected current requirements and update coverage/consumer evidence using bounded identity/order properties and concrete adapter tests; validate the OpenSpec change and record the required full gate in the PR handoff.
- [x] 3.2 Update current user/developer guides, knowledge map and changelog fragment; build the tutorial site and capture desktop and phone viewports with synthetic data.
- [x] 3.3 Format the staged candidate, pass repository hooks and push, then validate the final PR description and open a ready independently reviewed PR fixing #221 with creation-time labels; record the PR and verification evidence in the handoff.

The implementation tasks above describe delivered code and evidence consumers.
The external gate and PR outcome are recorded in the PR handoff; independent
review and acceptance remain required before archiving this change.

## 4. Independent review repairs

- [x] 4.1 Exercise native close cleanup during lost move replies and retain the latest explicit colour/reset.
- [x] 4.2 Bind profile launch colours to new terminal witnesses and reclaim closed records only from complete current, revision-admitted evidence.
- [x] 4.3 Wire both desktop Spaces entry points to the common editor and verify actual mobile drafts cannot retarget after a pane move.
The repair gate result and each finding's fixing commit are recorded on PR #492.
