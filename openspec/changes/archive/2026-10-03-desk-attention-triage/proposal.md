## Why

Office, Tree and Graph show where agents run. With many agents, the operator's actual work is answering agents that are blocked and reviewing what finished agents handed back. Today a stop becomes a status badge and a transient notification, and the operator reconstructs each result from Terminal, History, Changes and Files. Issue #151 proposes making these handoffs first-class.

## What Changes

- Add **Desk**, a fifth World view at `/desk`, and make it the default surface for the World root and unknown paths. Office, Tree, Graph and Spaces keep their routes and behavior.
- Desk groups the selected host's agents into Needs you, To review and In flight lanes, with quiet agents collapsed. Each card's primary action opens the existing terminal Inspector for that exact pane. Desk has no terminal input, approvals, task assignment or lifecycle commands of its own.
- Add the `agent_turn.get` service request. It derives the latest turn receipt (request, closing report, timing, tool calls, commands, edited files) from the agent session transcript World already reads for Agent History. It is read-only, bounded and stores nothing.
- Bound Desk observation: every admitted agent remains in triage and counts; transcript and screen reads are capped, chosen most urgent first, and pause while the page is hidden.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: add the Desk view, its lane semantics and observation bounds, and turn receipts. Change the default surface and the view set in Common view navigation.

## Impact

- Browser: `web/src/world/DeskView.tsx`, `web/src/world/handoffs.ts`, `web/src/world/paneScreen.ts`, the view registry in `web/src/world/WorldFoundationApp.tsx`, and the Herdr agent name in `web/src/world/worldObject.ts`.
- Service: `server/src/agent/turn-receipt.ts` and the `agent_turn.get` dispatch in `server/src/agent/agent-sessions.ts` and `server/src/index.ts`.
- No Herdr protocol change. Screen excerpts use the existing `pane.read` request on the selected connection.
