## 1. Turn receipts

- [x] 1.1 Derive the latest turn receipt from the ATIF trajectory with bounded request, report, files and timing; exclude projection placeholders and trailing system records from the report, duration and stop identity; tests in `server/src/agent/turn-receipt.test.ts`.
- [x] 1.2 Serve `agent_turn.get` beside Agent History with an optional complete report bounded to 32,000 characters.

## 2. Desk view

- [x] 2.1 Add the Desk view, `/desk` route and default surface; update shell tests for the new default.
- [x] 2.2 Partition every admitted agent into Needs you, To review, In flight and quiet; show request, report, edited files, live screen lines and the Herdr agent name; tests in `web/src/world/DeskView.test.ts`.
- [x] 2.3 Open the existing terminal Inspector from every card; support J/K/Enter/E without capturing keys aimed at other controls or the rest of the app; keep keyboard focus on the same agent as lanes reorder.
- [x] 2.4 Bound receipt and screen reads most urgent first, key them by session identity, prune retired entries, and pause while the page is hidden.

## 3. Documentation

- [x] 3.1 Update FEATURES, the changelog, the knowledge map and the World component routes.
