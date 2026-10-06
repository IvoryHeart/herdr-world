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

## Graph

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Toolbar, Fit, Arrange, zoom or search | `WorldControlPlane` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx) hosts the toolbar; [WorldViewToolbar.tsx](WorldViewToolbar.tsx) supplies the shared slot; [SpatialGraphView.tsx](SpatialGraphView.tsx) renders Graph controls. In [world.css](world.css), search `.world-view-toolbar-*` and `.world-spatial-graph-*`. | [Toolbar tests](WorldViewToolbar.test.ts), [Graph browser tests](SpatialGraphView.browser.test.ts) |
| Host/space/leaf selection or omission | `projectWorldGraph` in [graph/graphProjection.ts](graph/graphProjection.ts) builds the bounded visible graph from qualified World nodes. | [Projection tests](graph/graphProjection.test.ts) |
| Canvas drawing, hit targets, camera or drag | `GraphCanvas` and `GraphRenderer` in [graph/GraphCanvas.tsx](graph/GraphCanvas.tsx) own the renderer and pointer work. | [Canvas tests](graph/GraphCanvas.test.ts) |
| Placement, physics or Arrange | `reconcileGraphLayout`, `stepGraphLayout` and `arrangeGraphLayout` in [graph/graphLayout.ts](graph/graphLayout.ts) own positions; [graph/graphPreferences.ts](graph/graphPreferences.ts) persists camera, collapse and nodes. | [Layout tests](graph/graphLayout.test.ts), [preference tests](graph/graphPreferences.test.ts) |

Graph caches physics topology in [graph/graphSimulation.ts](graph/graphSimulation.ts)
and uses finite-radius spatial queries with the original force order and law.
[graph/graphSimulationRunner.ts](graph/graphSimulationRunner.ts) sends geometry to
one worker with one request in flight; revision fences discard results after
reconciliation or disposal. Dragging sends a single pinned position and preserves
in-flight neighbour updates. Its fallback yields ordinary tasks. Selection
and search reuse topology. The renderer caches its bounding rectangle and grid;
settled pans reuse integer device-pixel translations and repaint exposed strips,
including the grid. Full-grid caches use its periodic phase rather than raw pan offsets.
Fractional-device translations, zoom, rotation, resize and state changes redraw.
Individual translucent edges retain their original compositing order. Browser
regressions compare cached and full paints at DPR 1/2 (two channel levels of
antialiasing tolerance) and exercise reduced-motion settlement after typing.

[worldFrameScheduler.ts](worldFrameScheduler.ts) shares one task/rAF queue across
canvas clients, prioritizes state over motion, and yields after eight milliseconds
of client work. Hidden/offscreen clients retain pending work without painting;
reduced motion excludes decorative requests. A shared terminal quiet signal stops
physics advancement and decorative animation while typing. Geometry needed for
Inspector anchors remains available; per-node debug snapshots are published only
when `window.__HERDR_WORLD_RENDERER_DEBUG__` is enabled. The `"counters"` mode
collects acceptance counters without allocating debug node snapshots.

## Office

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| View controls, selection and framing | [PixelOfficeView.tsx](PixelOfficeView.tsx) composes the Office view; [PixelOfficeCanvas.tsx](PixelOfficeCanvas.tsx) mounts the canvas. In [world.css](world.css), start at the `Retained Pixel Office canvas` comment; `.world-office-*` frames the shell, while `.world-canvas-*`, `.world-room-*`, `.world-completion-*`, `.world-observability-*` and `.world-compact-target-*` cover the scene and controls. | [Canvas tests](PixelOfficeCanvas.test.ts), [Office browser fixture](PixelOfficeCanvas.browser.tsx) |
| Herdr-to-Office data or room geometry | [herdrOfficeProjection.ts](herdrOfficeProjection.ts) projects qualified topology, pane devices and reception placement; `resolveOfficeGeometry` and `OfficeLayoutPublisher` in [officeLayout.ts](officeLayout.ts) place rooms and content. | [Projection tests](herdrOfficeProjection.test.ts), [geometry tests](officeGeometry.test.ts), [layout tests](officeLayout.test.ts) |
| Pixi drawing, assets or room interaction | `createOfficeRenderer` in [officeRenderer.ts](officeRenderer.ts) draws the scene; [officeSemanticTargets.ts](officeSemanticTargets.ts) exposes separate desk, pane and agent targets; [officeRendererResources.ts](officeRendererResources.ts) owns renderer resources; [officeRoomActions.ts](officeRoomActions.ts) resolves room actions. | [Semantic target tests](officeSemanticTargets.test.ts), [Office browser fixture](PixelOfficeCanvas.browser.tsx), [room-action tests](officeRoomActions.test.ts) |
| Office settings or Economy board | [officePreferences.ts](officePreferences.ts), [officeObservability.ts](officeObservability.ts) and [OfficeObservabilityDialog.tsx](OfficeObservabilityDialog.tsx). | [Preference tests](officePreferences.test.ts), [metrics tests](officeObservability.test.ts) |

### Office rendering performance

Office owns a retained layer per room plus background, reception, hallway and road
layers. A scene signature selects changes; equivalent layers preserve their GPU
resources. Static runs are cached in painter order around animated nodes, so
characters and monitor/status effects keep moving without repainting every piece
of furniture. Subtrees beneath translucent ancestors keep per-primitive opacity
instead of being flattened. The cache admits at most four viewport areas of device pixels;
fractional bounds are rounded outward before resolution and power-of-two backing
size admission. Individual targets are bounded to 2048 pixels per axis. Pixi owns pooled backing
textures. Renderer teardown releases layer resources and renderer-owned floor
textures. Fractional floor origins retain vector tile edges for identical coverage.
[officeArtwork.ts](officeArtwork.ts) shares immutable furniture GraphicsContexts
with explicit reference ownership; the last consumer releases the context.
Selection projections reuse equivalent room references, while overflowing rooms
rerun bounded admission when selection changes or clears. Room versions make
retained-layer signatures independent of full topology serialization. Qualified
presentation-key aliases are indexed during cooperative preparation, so connector
and selection renders do not rescan the complete pane roster.

`OfficeScenePreparation` uses Pixi's preparation hooks in batches of at most 64
nodes or four milliseconds, yielding ordinary tasks between batches. Each batch
checks renderer lifetime and scene revision. These protected preparation hooks
are tied to pinned Pixi 8.22.0: rerun preparation/cancellation and backing-size
regressions when changing that pin. Animation waits for prepared scenes,
stops for hidden documents or reduced motion, and resumes on visibility/preference
changes. Terminal key, input and paste events defer decorative frames until a
180 ms quiet interval; state updates and scrolling still paint independently of
animation. The transport fixture covers both initially idle and continuously
working agents, checking that motion resumes when terminal typing stops.

`OfficeSemanticTargetsOverlay` admits controls by ordered qualified identity;
refreshed labels, geometry, permissions and callbacks remain current without
remounting unchanged controls or losing keyboard focus, including across topology
insertions and removals. A flat identity-keyed list of memoized buttons admits
16 controls per task and retains previously admitted identities on refresh. One native
`inert` subtree flag gates readiness without updating every button; callback
guards also reject programmatic activation before the scene is ready. Office subscribes only to
the endpoint-creation inputs it consumes; room actions resolve through the
qualified World index and still validate host, generation and native identity.

Use `bun run test ./web/src/world/ProductionContexts.office.test.ts ./web/src/world/ProductionContexts.animated.test.ts --parallel=1 --test-name-pattern
'office'` for the synthetic desktop/mobile transport workload. Keep native key
scheduling, cold initialization, aggregate refresh and the strict Office/Graph p95
<150 ms / maximum <450 ms acknowledgement budgets (tightened from 200/500 ms).
These are regression ceilings, not optimization targets: preserve them as future
graphics and animation are added, and lower them when repeated measurements
demonstrate headroom. Do not relax the limits or exclude slow phases to make a
change pass. On Linux, repeat with `taskset -c
<cpu-a>,<cpu-b>` after checking the CPU/core mapping: separate cores and sibling
logical CPUs measure different contention conditions. Run cases sequentially and
report every run; affinity is a stress proxy, not a model of CI hardware. The
canvas fixture also checks pixel equivalence, painter order, motion, retained
controls and cleanup. For timing investigation, set `WORLD_TRACE_PREFIX` to a
private temporary path; `WORLD_TIMINGS_ONLY=1` keeps acknowledgement/phase and
Long Animation Frame evidence without the overhead of a full Chrome trace.

Keep the existing text and character resources: BitmapText and a combined
character atlas were measured and rejected because glyph/atlas preparation
increased cold-start latency on the constrained workload. Lowering animation
cadence or regrouping translucent paths would change presentation and is not a
substitute for reducing work. A full OffscreenCanvas migration is unnecessary
for the current workload; physics already runs off the main thread.

## Tree

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Hierarchy, selection, keyboard, inline Inspector or search | [ConnectedTreeView.tsx](ConnectedTreeView.tsx) renders visual and semantic branches; `projectWorldTree` in [treeProjection.ts](treeProjection.ts) bounds and ranks nodes; [treePreferences.ts](treePreferences.ts) saves disclosure. In [world.css](world.css), search `.world-connected-tree-*` and `.world-tree-*`. | [View tests](ConnectedTreeView.test.ts), [browser tests](ConnectedTreeView.browser.test.ts), [projection tests](treeProjection.test.ts), [preference tests](treePreferences.test.ts) |

## Inspector and windows

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Selected entity, resource context or handoff | `worldInspectorContext`, `worldNodeForWorkspaceSurfaceSelection` and `dispatchWorldInspectorRequest` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx); [WorldInspectorConversation.tsx](WorldInspectorConversation.tsx) presents the selected conversation; [inspectorTerminalHandoff.ts](inspectorTerminalHandoff.ts) fences terminal file links and exact pane input focus; [worldTerminalPresentation.ts](worldTerminalPresentation.ts) reconciles Inspector identity. | [Shell tests](WorldFoundationApp.test.ts), [handoff tests](WorldTerminalHandoff.test.ts), [handoff admission tests](inspectorTerminalHandoff.test.ts) |
| Window placement, snapping, minimize or arrangements | [windowManager.ts](windows/windowManager.ts) owns presentation state; [WindowFrame.tsx](windows/WindowFrame.tsx) and [WindowSurface.tsx](windows/WindowSurface.tsx) share interactions and measured work areas. [WorldFoundationApp.tsx](WorldFoundationApp.tsx) adapts qualified Inspectors; [useSpacesTabWindowArrangement.tsx](useSpacesTabWindowArrangement.tsx) adapts native Spaces tabs. | [Model tests](windows/windowManager.test.ts), [frame browser tests](windows/WindowFrame.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |
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

## Large-file entry points

| File | Search for these stable symbols or selectors |
| --- | --- |
| [WorldFoundationApp.tsx](WorldFoundationApp.tsx) | `WorldFoundationApp` composes the mounted Spaces app, view stage and Inspector state; `WorldControlPlane` owns the shared top bar; `worldViewFromPath` routes views; `worldInspectorContext`, `dispatchWorldInspectorRequest`, `focusWorldNode` and `activateWorldNodeHost` qualify visual handoffs. |
| [worldObject.ts](worldObject.ts) | `buildHost` admits qualified host/space/leaf data; `buildWorldObject` combines hosts; `worldObjectForConnection` selects the operational projection; `worldObjectForWatches` and `worldObjectWithWatches` project watched nodes. |
| [App.tsx](../App.tsx) | `App` owns the focused Spaces shell and Inspector resource host; `SpacesTabTerminal` renders its tab terminal; `terminalPresentationTarget` resolves terminal presentation; the lazy `WorkspaceInspectorHost` and `WorldTerminalPortalList` imports lead to resource and portal owners. |
| [store.ts](../store.ts) | `activateConnectionState` and `reconcileConnectionCatalogSessions` retire or restore focused session state; `refreshNow` refreshes focused topology; `selectConnectionNow` switches host; `qualifiedAction` gates downstream operations by the current connection lease. |
| [world.css](world.css) | `.world-foundation-*` and `.world-view-toolbar-*` frame the shell; `.world-inspector-*`, `.world-intent-*` and `.world-floating-*` style Inspector/window presentation. Search the `Retained Pixel Office canvas` comment and `.world-canvas-*`, `.world-room-*`, `.world-completion-*`, `.world-observability-*` for Office beyond its `.world-office-*` shell; `.world-connected-tree-*`/`.world-tree-*` and `.world-spatial-graph-*` style Tree and Graph. |

## Shared creation

Office is the root and invalid-route default; `/desk` remains explicit. The common
Actions menu creates a workspace on a confirmed host or a tab in the selected
workspace in Office, Desk, Tree and Graph. Native Spaces controls share the store
operations. Eight displayed Office desks are a projection bound, not a tab limit.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Captured sources, duplicate suppression and progress | [creationRequests.ts](../creationRequests.ts), `prepareQualifiedCreation`, `createQualifiedTab` and `createQualifiedWorkspace` in [store.ts](../store.ts) | [Creation store tests](../worldCreation.test.ts), [Shared creation browser matrix](SharedViewCreation.test.ts) |
| Browser attachment ownership and presentation handoffs | [TerminalView.tsx](../components/TerminalView.tsx), source demand merging in [App.tsx](../App.tsx), [WorldTerminalPortalList.tsx](WorldTerminalPortalList.tsx) | [Creation store tests](../worldCreation.test.ts), [Terminal handoff tests](WorldTerminalHandoff.test.ts) |
| Created-terminal admission and newer Inspector intent | `creationCompletion` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx), [createdTerminalAdmission.ts](createdTerminalAdmission.ts) | [Admission tests](createdTerminalAdmission.test.ts), [Shared creation browser matrix](SharedViewCreation.test.ts) |
