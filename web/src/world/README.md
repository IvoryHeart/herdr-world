# World component routes

Start from the [repository knowledge map](../../../docs/knowledge-map.md) for contracts
and service ownership. This file routes visual and terminal tasks to the small set of
browser owners and focused tests. Search the **symbols** below inside large files;
line numbers and CSS ranges change as components move.

## Desk

Desk follows the aggregate host filter. Receipt and screen reads capture each leaf's
connection and runtime generation; retirement never reroutes a read. Review marks
and recent opens use qualified session identities across filter and focus changes.
Reads use fair bounded admission and independent host queues. Pending reads keep
their admission across refreshes; queued work coalesces to the latest observation.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Lane routing, ordering or keyboard triage | `partitionDesk` and `DeskView` in [DeskView.tsx](DeskView.tsx); [DeskView.css](DeskView.css) styles `.desk-*`. | [Desk tests](DeskView.test.ts) |
| Receipts, review marks, observed stops or polling limits | `useTurnReceipts`, `pollingTargets`, `useHandledTurns` and `useObservedStops` in [handoffs.ts](handoffs.ts); the service side is `latestTurnReceipt` in [turn-receipt.ts](../../../server/src/agent/turn-receipt.ts). Triage always covers every agent; only reads are bounded. | [Desk tests](DeskView.test.ts), [receipt tests](../../../server/src/agent/turn-receipt.test.ts) |
| Questions or live lines read from agent screens | `usePaneScreens`, `screenIdentity`, `questionFromScreen` and `activityFromScreen` in [paneScreen.ts](paneScreen.ts). Excerpts are keyed by pane, runtime generation and session. | [Desk tests](DeskView.test.ts) |

## Town

Town is the default view: each host is a building, each workspace a room on a
carpet and each tab a team table with one seat per pane. Its contract is in the
World surfaces spec. Town still reuses a few modules named after the retired
Office view (`herdrOfficeProjection.ts`, `officeRoomActions.ts`,
`officePreferences.ts`, `officeObservability.ts`); the names are historical.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| View composition, room dialogs and creation | [TownView.tsx](TownView.tsx) owns taps, peeks, replies through World's terminal composer, toasts, room dialogs and seat/room creation and mounts [TownCanvas.tsx](town/TownCanvas.tsx). | [Town browser fixture](town/TownCanvas.browser.tsx), [room-action tests](officeRoomActions.test.ts) |
| Needs-you rail and peek | [TownRail.tsx](town/TownRail.tsx) and [TownPeek.tsx](town/TownPeek.tsx); [townChat.ts](town/townChat.ts) reads pane screens and sends one-tap answers through each pane's own connection and generation; [terminalComposerRequest.ts](terminalComposerRequest.ts) asks the pane's terminal to open its composer. | [Town browser fixture](town/TownCanvas.browser.tsx) |
| Herdr-to-Town data | [herdrOfficeProjection.ts](herdrOfficeProjection.ts) projects qualified topology and pane devices with `TOWN_PRESENTATION_BOUNDS`; [townModel.ts](town/townModel.ts) indexes presented rooms, desks, seats and per-room counts. | [Projection tests](herdrOfficeProjection.test.ts) |
| Town placement | [townLayout.ts](town/townLayout.ts) places buildings, rooms, desk cells, lounge and reception from native order, keeping desks in place while a scene is live. | [Layout tests](town/townLayout.test.ts) |
| Pointer input | `TownCanvas` hit-tests the canvas and feeds World's shared gesture machine; [townGesture.ts](town/townGesture.ts) holds Town's targets (a hit, and the desk or agent a drag would carry) and thresholds. | [Shared cases](interaction/gesture.test.ts), [Town browser test](town/TownCanvas.test.ts) |
| Camera and zoom levels | [townCamera.ts](town/townCamera.ts) owns pan, zoom about a point, flights and the town/overview/room/desk thresholds. | [Camera tests](town/townCamera.test.ts) |
| Agent locations and movement | [townActors.ts](town/townActors.ts) seats, queues and walks agents (presentation only) with per-building pathfinding. | [Actor tests](town/townActors.test.ts) |
| Pixi drawing and art | [townRenderer.ts](town/townRenderer.ts) owns renderer lifetime and per-frame updates; [townPaint.ts](town/townPaint.ts) bakes ground, interiors, façades and roofs; [townSprites.ts](town/townSprites.ts) holds the generated pixel art. See [world asset provenance](../../../docs/world-assets.md). | [Town browser test](town/TownCanvas.test.ts) |
| Room cards, receptions, targets and room actions | The DOM world layer in [TownCanvas.tsx](town/TownCanvas.tsx) follows the camera; [townTargets.ts](town/townTargets.ts) builds accessible targets and [townHitTest.ts](town/townHitTest.ts) maps pointer hits to keys. Styles live in [town.css](town/town.css). | [Town browser test](town/TownCanvas.test.ts) |
| Town settings or the Town board's cost line | [officePreferences.ts](officePreferences.ts) (shared Inspector opening, Town calm motion), [officeObservability.ts](officeObservability.ts) and [OfficeObservabilityDialog.tsx](OfficeObservabilityDialog.tsx) (the optional Prometheus cost metrics). | [Preference tests](officePreferences.test.ts), [metrics tests](officeObservability.test.ts) |

### Town rendering performance

The renderer draws through the shared World frame scheduler: state frames for
camera, roof and walking changes, motion frames for ambient animation, which
pause while the user types in a terminal and for reduced motion or calm mode.
Ground is painted in 512-pixel chunks only when a chunk first comes into view,
with deterministic per-tile randomness, and its trees and lamps join the scene
with it. A building's interior, façade, roof and desks are baked the first time
it is visible, one per frame within a five-millisecond budget. Tables and chairs
are baked into the interior; seated people, screens and glow are created only
from the room level for desks on screen. Repeating ground, floor, carpet and
roof detail is drawn from small cached patterns. Paint canvases are CPU-backed
so WebGL uploads never read back from the GPU, and sprite outlines are
composited rather than read from the canvas.

The DOM world layer keeps cards, plaques, signs and receptions only for
buildings within half a viewport of the screen, and drops room cards outside
the overview and room levels. A town with more than 48 rooms opens at roof
level on desktop, where hundreds of cards would neither read nor composite
cheaply.

The town model reads the complete roster once per projection, keeping only
agents of presented rooms and precomputing per-room counts. Accessible targets
are admitted 16 per task and memoized by identity, label and geometry, so
refreshes do not remount unchanged targets.

Town has its own dense acceptance case (`ProductionContexts.town.test.ts`) under
a 150 ms p95 / 450 ms maximum budget.

## Board

Board draws each host as a zone, each workspace and tab as a DOM card, and the
user's notes and strings, over one camera. Positions are the user's: placement
only fills in cards it has not placed before.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| View composition, cards, selection and keyboard | [BoardView.tsx](BoardView.tsx) owns the cards, toolbar, notes, strings and the frame's paint; [board/board.css](board/board.css) styles `.board-*`. | [Board browser test](BoardView.test.ts) |
| Herdr-to-Board data | `projectBoard` in [board/boardModel.ts](board/boardModel.ts) builds hosts, workspaces, tabs and pane rows with qualified keys (`boardTabKey` qualifies a tab whose ID collides with a workspace ID). | [Model tests](board/boardModel.test.ts) |
| Placement and Tidy | `placeNew` and `freeSpots` in [board/boardPlacement.ts](board/boardPlacement.ts) place new cards around their parents through a spatial index; [board/boardPhysics.ts](board/boardPhysics.ts) settles overlaps. | [Placement tests](board/boardPlacement.test.ts), [physics tests](board/boardPhysics.test.ts) |
| Pointer gestures | World's shared machine in [interaction/gesture.ts](interaction/gesture.ts) turns pointer events into press, pan and fling, pinch, drag (a touch hold lifts; a mouse drags past 6 px), lines, taps and double taps. Board's targets and thresholds are in [board/boardGesture.ts](board/boardGesture.ts). | [Shared cases (Town's config)](interaction/gesture.test.ts), [Board cases](board/boardGesture.test.ts) |
| Inspector line anchors | [board/boardAnchors.ts](board/boardAnchors.ts) resolves an Inspector's node to a card, pane row or folded workspace. | [Anchor tests](board/boardAnchors.test.ts) |
| Notes, strings and Send | [board/boardDrafts.ts](board/boardDrafts.ts) keeps unsent text; the service stores the board and sends notes in [board-store.ts](../../../server/src/world/board-store.ts), [board-send.ts](../../../server/src/world/board-send.ts) and [board-start.ts](../../../server/src/world/board-start.ts). | [Draft tests](board/boardDrafts.test.ts), [store](../../../server/src/world/board-store.test.ts), [send](../../../server/src/world/board-send.test.ts) and [start](../../../server/src/world/board-start.test.ts) tests |
| Frames | [board/boardScheduler.ts](board/boardScheduler.ts) is Board's client of World's frame scheduler: a state frame per batch of invalidation reasons, motion frames while cards glide. | [Scheduler tests](board/boardScheduler.test.ts) |

### Board at scale

Typical boards measure cards synchronously and draw every card. Above 300 cards
(`CULL_ABOVE`), Board switches to a large-board path. React renders only the cards
near the screen, and paint tells React when that set changes. Off-screen cards are
not laid out, and the overview draws no tabs. Topology updates render at low
priority, and a large board builds in a transition and opens in the overview, so
both yield to input. The runtime store projects each host ahead of time, in
slices (`prepareWorldBoard`), and the projection stays with the host object, so
Board's render reuses it; the watch overlay keeps untouched hosts so that reuse
survives. A large board's first placement runs in a task of its own, outside
React's commit. Tab placement waits until the overview ends. Paint never reads
layout mid-frame. Sizes come from a ResizeObserver, zones are measured before they
are written, and Inspector anchors and the board's box come from geometry and a
cache. Cards mount in their own container, so React appends them as one subtree.
`ProductionContexts.board.test.ts` holds this path to the 200 ms p95 / 500 ms
maximum input budget at 64 hosts.

## Development tools

Development builds only (`devtools/`). [devtools/flag.ts](devtools/flag.ts) is the
one file a release build keeps: `DEVTOOLS` is false there, and Vite aliases
[devtools/trace.ts](devtools/trace.ts) and
[devtools/TraceOverlay.tsx](devtools/TraceOverlay.tsx) to the inert
[devtools/release.ts](devtools/release.ts), so no trace, overlay, menu item or
switch ships. Views record only under `if (DEVTOOLS)`, so their recording code
drops out too; gesture steps go through `traceGesture` in the trace module.
[devtools/renderer.ts](devtools/renderer.ts) gates Town's renderer counters the
same way. Each view's trace is a bounded, page-local ring of input, gesture
transitions, effects, frames with the reasons they were drawn, and errors:
Board's is under its ⋯ menu, Town's under the common settings menu, and
`?debug=board` or `?debug=town` starts one. `scripts/check-web-assets.mjs` fails a
release build whose assets carry the devtools marker or any trace call with a
literal kind (`.record("…"`). Tests: [trace tests](devtools/trace.test.ts)
and the asset check's tests.

## Shared frames and acceptance budgets

[worldFrameScheduler.ts](worldFrameScheduler.ts) shares one task/rAF queue across
Town's and Board's frames, prioritizes state over motion, and yields after eight milliseconds
of client work. Hidden/offscreen clients retain pending work without painting;
reduced motion excludes decorative requests. A shared terminal quiet signal stops
decorative animation while typing. Per-node debug snapshots are published only
when `window.__HERDR_WORLD_RENDERER_DEBUG__` is enabled. The `"counters"` mode
collects acceptance counters without allocating debug node snapshots.

The `ProductionContexts*.test.ts` cases drive a synthetic desktop and mobile
transport workload through each view. Keep native key scheduling, cold
initialization, aggregate refresh and the acknowledgement budgets (Town p95
<150 ms / maximum <450 ms; other views 200/500 ms). These are regression
ceilings, not optimization targets: preserve them as graphics and animation are
added, and lower them when repeated measurements demonstrate headroom. Do not
relax the limits or exclude slow phases to make a change pass. On Linux, repeat
with `taskset -c <cpu-a>,<cpu-b>` after checking the CPU/core mapping: separate
cores and sibling logical CPUs measure different contention conditions. Run cases
sequentially and report every run; affinity is a stress proxy, not a model of CI
hardware. For timing investigation, set `WORLD_TRACE_PREFIX` to a private
temporary path; `WORLD_TIMINGS_ONLY=1` keeps acknowledgement/phase and Long
Animation Frame evidence without the overhead of a full Chrome trace.

## Browser fixtures on test time

A fixture whose checks are about behaviour, not latency, runs on test time:
it imports [testing/installTestClock.ts](testing/installTestClock.ts) first, so
React's scheduler captures the fake timers. The page's timers, animation frames
and `performance.now` then move only when the fixture advances the clock, in
16 ms frames, each followed by real task turns for React and promises. CSS
transitions and animations are off, and checks read end states. `settle(ms)`
becomes `clock.advance(ms)` and `waitFor` becomes `clock.until`. Physics, tweens,
holds and double-tap gaps then behave the same on any runner.
[BoardView.browser.tsx](BoardView.browser.tsx) runs this way: about 20 s of test
time per width, in about a second, and it passes under full CPU load. The
latency-budget suites above stay on real time, because real time is what they
measure.

## Inspector and windows

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Selected entity, resource context or handoff | `worldInspectorContext`, `worldNodeForWorkspaceSurfaceSelection` and `dispatchWorldInspectorRequest` in [worldInspectorSelection.ts](worldInspectorSelection.ts); [useWorldInspectorController.ts](useWorldInspectorController.ts) owns selection, focus and retirement; [WorldInspectorConversation.tsx](WorldInspectorConversation.tsx) presents the selected conversation; [inspectorTerminalHandoff.ts](inspectorTerminalHandoff.ts) fences terminal file links and exact pane input focus; [worldTerminalPresentation.ts](worldTerminalPresentation.ts) reconciles Inspector identity. | [Shell tests](WorldFoundationApp.test.ts), [handoff tests](WorldTerminalHandoff.test.ts), [handoff admission tests](inspectorTerminalHandoff.test.ts) |
| Window placement, snapping, minimize or arrangements | [windowManager.ts](windows/windowManager.ts) owns presentation state; [WindowFrame.tsx](windows/WindowFrame.tsx) and [WindowSurface.tsx](windows/WindowSurface.tsx) share interactions and measured work areas. [useWorldInspectorWindows.ts](useWorldInspectorWindows.ts) adapts qualified Inspectors; [useSpacesTabWindowArrangement.tsx](useSpacesTabWindowArrangement.tsx) adapts native Spaces tabs. | [Model tests](windows/windowManager.test.ts), [frame browser tests](windows/WindowFrame.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |
| Files, Changes or history inside the Inspector | [WorkspaceInspectorHost.tsx](../components/WorkspaceInspectorHost.tsx) owns resource panes; [WorkspaceInspectorPortal.tsx](../components/WorkspaceInspectorPortal.tsx) keeps them mounted across view changes; [workspaceResource.ts](../workspaceResource.ts) qualifies resource context. | [Portal tests](../components/WorkspaceInspectorPortal.test.ts), [resource tests](../workspaceResource.test.ts) |

World window behavior stays in `windows/`; [WorldLayout.css](windows/WorldLayout.css)
coordinates the outer shell with the Roamgate-derived App. Mobile retains floating
controls and hides the tab strip. The inherited keyboard viewport adapter, native
pane layouts and terminal transport remain the compatibility boundary.

To capture the synthetic desktop and 390 px mobile fixture, set
`WORLD_WINDOW_CAPTURE_DIR=/tmp/world-window-captures` when running
`bun run test web/src/world/WorldTerminalHandoff.test.ts`.

## Terminal presentation

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Focused Spaces tab, split panes or browser-local selection | `App`, `SpacesTabTerminal` and `terminalPresentationTarget` in [App.tsx](../App.tsx); [TabTerminalPaneLayout.tsx](../TabTerminalPaneLayout.tsx), [visibleTabLayout.ts](../visibleTabLayout.ts) and [browserNavigation.ts](../browserNavigation.ts). | [Layout tests](../visibleTabLayout.test.ts), [navigation tests](../browserNavigation.test.ts) |
| Attach, render, resize or input | [TerminalView.tsx](../components/TerminalView.tsx), [terminalConnection.ts](../terminalConnection.ts) and [terminalEndpointPresentation.ts](../terminalEndpointPresentation.ts). Terminal widget styles live in [TerminalView.css](../components/TerminalView.css). | [Connection tests](../terminalConnection.test.ts), [presentation tests](../terminalEndpointPresentation.test.ts) |
| Spaces window or Inspector terminal ownership | [useSpacesTabWindowArrangement.tsx](useSpacesTabWindowArrangement.tsx), [WorldTerminalPortalList.tsx](WorldTerminalPortalList.tsx) and [worldTerminalPresentation.ts](worldTerminalPresentation.ts). The shared frame owns presentation only. | [Spaces adapter tests](useSpacesTabWindowArrangement.browser.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |

## Shell and source ownership

World-owned coordination stays in these modules. The Roamgate-derived App and
store retain their existing interfaces. [WorldFoundationApp.tsx](WorldFoundationApp.tsx)
is the composition root and keeps Spaces mounted across visual view changes.

| Responsibility | Owner | Focused evidence |
| --- | --- | --- |
| View path and preference parsing | [worldViewRouting.ts](worldViewRouting.ts) | [Shell tests](WorldFoundationApp.test.ts) |
| Aggregate observation, host filtering, watch coverage and the Inspector opening preference | [useWorldObservation.ts](useWorldObservation.ts) | [Hosts filter suites](HostsFilter.test.ts), [watchlist tests](watchlistStore.test.ts) |
| Qualified selection, focus admission, resource contexts and conversation reconciliation | [worldInspectorSelection.ts](worldInspectorSelection.ts) contains model helpers; [useWorldInspectorController.ts](useWorldInspectorController.ts) owns async intent, focus, shortcuts and retirement. | [Shell tests](WorldFoundationApp.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |
| Window inputs, visibility, arrangement and restore controls | [useWorldInspectorWindows.ts](useWorldInspectorWindows.ts); pure geometry remains in [worldInspectorGeometry.ts](worldInspectorGeometry.ts). | [Shell tests](WorldFoundationApp.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |
| New terminal completion and cancellation | [useWorldCreatedTerminal.ts](useWorldCreatedTerminal.ts), [createdTerminalAdmission.ts](createdTerminalAdmission.ts) | [Shared creation matrix](SharedViewCreation.test.ts) |
| Qualified Actions, pins and creation dialogs | [useWorldVisualActions.tsx](useWorldVisualActions.tsx), [worldControlPlaneContract.ts](worldControlPlaneContract.ts) | [Action tests](visualRouteActions.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |
| Visual view and Inspector/window presentation | [WorldControlPlane.tsx](WorldControlPlane.tsx) | [Handoff tests](WorldTerminalHandoff.test.ts) |

[world.css](world.css) is the ordered style manifest. It imports shell, toolbar,
stage, Inspector, terminal and shared visual-view styles, followed by shared
responsive overrides. Keep that order: shared selectors and responsive overrides
cross view boundaries. Production and standalone browser fixtures use the same
manifest, so a lazy view cannot reorder the cascade. Shared visual-view rules
(canvas callouts, semantic targets, room actions, the cost metrics dialog) are in
[world-views.css](world-views.css); Town and Board keep their own rules in
[town/town.css](town/town.css) and [board/board.css](board/board.css); shared
overrides are in [world-responsive.css](world-responsive.css).

## Shared creation

Town is the root and invalid-route default; `/desk` remains explicit, and the
retired `/office`, `/graph` and `/tree` addresses redirect to Town or Board
(`worldViewRouting.ts`). The common Actions menu creates a workspace on a
confirmed host or a tab in the selected workspace in Town, Desk and Board. Native
Spaces controls share the store operations. Town's presentation bounds limit the
desks it draws, not the tabs a workspace can have.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Captured sources, duplicate suppression and progress | [creationRequests.ts](../creationRequests.ts), `prepareQualifiedCreation`, `createQualifiedTab` and `createQualifiedWorkspace` in [store.ts](../store.ts) | [Creation store tests](../worldCreation.test.ts), [Shared creation browser matrix](SharedViewCreation.test.ts) |
| Browser attachment ownership and presentation handoffs | [TerminalView.tsx](../components/TerminalView.tsx), source demand merging in [App.tsx](../App.tsx), [WorldTerminalPortalList.tsx](WorldTerminalPortalList.tsx) | [Creation store tests](../worldCreation.test.ts), [Terminal handoff tests](WorldTerminalHandoff.test.ts) |
| Created-terminal admission and newer Inspector intent | `creationCompletion` in [useWorldCreatedTerminal.ts](useWorldCreatedTerminal.ts), [createdTerminalAdmission.ts](createdTerminalAdmission.ts) | [Admission tests](createdTerminalAdmission.test.ts), [Shared creation browser matrix](SharedViewCreation.test.ts) |
