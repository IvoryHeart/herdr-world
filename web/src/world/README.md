# World component routes

Start from the [repository knowledge map](../../../docs/knowledge-map.md) for contracts
and service ownership. This file routes visual and terminal tasks to the small set of
browser owners and focused tests. Search the **symbols** below inside large files;
line numbers and CSS ranges change as components move.

## Desk

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Lane routing, ordering or keyboard triage | `partitionDesk` and `DeskView` in [DeskView.tsx](DeskView.tsx); [DeskView.css](DeskView.css) styles `.desk-*`. | [Desk tests](DeskView.test.ts) |
| Receipts, review marks, observed stops or polling limits | `useTurnReceipts`, `pollingTargets`, `useHandledTurns` and `useObservedStops` in [handoffs.ts](handoffs.ts); the service side is `latestTurnReceipt` in [turn-receipt.ts](../../../server/src/agent/turn-receipt.ts). Triage always covers every agent; only reads are bounded. | [Desk tests](DeskView.test.ts), [receipt tests](../../../server/src/agent/turn-receipt.test.ts) |
| Questions or live lines read from agent screens | `usePaneScreens`, `screenIdentity`, `questionFromScreen` and `activityFromScreen` in [paneScreen.ts](paneScreen.ts). Excerpts are keyed by pane, runtime generation and session. | [Desk tests](DeskView.test.ts) |
| Handoffs button in Office, Tree and Graph | [HandoffQueue.tsx](HandoffQueue.tsx), mounted by `WorldControlPlane` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx). | [Shell tests](WorldFoundationApp.test.ts) |

## Graph

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Toolbar, Fit, Arrange, zoom or search | `WorldControlPlane` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx) hosts the toolbar; [WorldViewToolbar.tsx](WorldViewToolbar.tsx) supplies the shared slot; [SpatialGraphView.tsx](SpatialGraphView.tsx) renders Graph controls. In [world.css](world.css), search `.world-view-toolbar-*` and `.world-spatial-graph-*`. | [Toolbar tests](WorldViewToolbar.test.ts), [Graph browser tests](SpatialGraphView.browser.test.ts) |
| Host/space/leaf selection or omission | `projectWorldGraph` in [graph/graphProjection.ts](graph/graphProjection.ts) builds the bounded visible graph from qualified World nodes. | [Projection tests](graph/graphProjection.test.ts) |
| Canvas drawing, hit targets, camera or drag | `GraphCanvas` and `GraphRenderer` in [graph/GraphCanvas.tsx](graph/GraphCanvas.tsx) own the renderer and pointer work. | [Canvas tests](graph/GraphCanvas.test.ts) |
| Placement, physics or Arrange | `reconcileGraphLayout`, `stepGraphLayout` and `arrangeGraphLayout` in [graph/graphLayout.ts](graph/graphLayout.ts) own positions; [graph/graphPreferences.ts](graph/graphPreferences.ts) persists camera, collapse and nodes. | [Layout tests](graph/graphLayout.test.ts), [preference tests](graph/graphPreferences.test.ts) |

## Office

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| View controls, selection and framing | [PixelOfficeView.tsx](PixelOfficeView.tsx) composes the Office view; [PixelOfficeCanvas.tsx](PixelOfficeCanvas.tsx) mounts the canvas. In [world.css](world.css), start at the `Retained Pixel Office canvas` comment; `.world-office-*` frames the shell, while `.world-canvas-*`, `.world-room-*`, `.world-completion-*`, `.world-observability-*` and `.world-compact-target-*` cover the scene and controls. | [Canvas tests](PixelOfficeCanvas.test.ts), [Office browser fixture](PixelOfficeCanvas.browser.tsx) |
| Herdr-to-Office data or room geometry | [herdrOfficeProjection.ts](herdrOfficeProjection.ts) projects qualified topology, pane devices and reception placement; `resolveOfficeGeometry` and `OfficeLayoutPublisher` in [officeLayout.ts](officeLayout.ts) place rooms and content. | [Projection tests](herdrOfficeProjection.test.ts), [geometry tests](officeGeometry.test.ts), [layout tests](officeLayout.test.ts) |
| Pixi drawing, assets or room interaction | `createOfficeRenderer` in [officeRenderer.ts](officeRenderer.ts) draws the scene; [officeSemanticTargets.ts](officeSemanticTargets.ts) exposes separate desk, pane and agent targets; [officeRendererResources.ts](officeRendererResources.ts) owns renderer resources; [officeRoomActions.ts](officeRoomActions.ts) resolves room actions. | [Semantic target tests](officeSemanticTargets.test.ts), [Office browser fixture](PixelOfficeCanvas.browser.tsx), [room-action tests](officeRoomActions.test.ts) |
| Office settings or Economy board | [officePreferences.ts](officePreferences.ts), [officeObservability.ts](officeObservability.ts) and [OfficeObservabilityDialog.tsx](OfficeObservabilityDialog.tsx). | [Preference tests](officePreferences.test.ts), [metrics tests](officeObservability.test.ts) |

## Tree

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Hierarchy, selection, keyboard, inline Inspector or search | [ConnectedTreeView.tsx](ConnectedTreeView.tsx) renders visual and semantic branches; `projectWorldTree` in [treeProjection.ts](treeProjection.ts) bounds and ranks nodes; [treePreferences.ts](treePreferences.ts) saves disclosure. In [world.css](world.css), search `.world-connected-tree-*` and `.world-tree-*`. | [View tests](ConnectedTreeView.test.ts), [browser tests](ConnectedTreeView.browser.test.ts), [projection tests](treeProjection.test.ts), [preference tests](treePreferences.test.ts) |

## Inspector and windows

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Selected entity, resource context or handoff | `worldInspectorContext`, `worldNodeForWorkspaceSurfaceSelection` and `dispatchWorldInspectorRequest` in [WorldFoundationApp.tsx](WorldFoundationApp.tsx); [WorldInspectorConversation.tsx](WorldInspectorConversation.tsx) presents the selected conversation; [inspectorTerminalHandoff.ts](inspectorTerminalHandoff.ts) fences terminal file links and exact pane input focus; [worldTerminalPresentation.ts](worldTerminalPresentation.ts) reconciles Inspector identity. | [Shell tests](WorldFoundationApp.test.ts), [handoff tests](WorldTerminalHandoff.test.ts), [handoff admission tests](inspectorTerminalHandoff.test.ts) |
| Docking, floating geometry or arrangements | `WorldFoundationApp` and its Inspector state in [WorldFoundationApp.tsx](WorldFoundationApp.tsx); [WorldFloatingTerminal.tsx](WorldFloatingTerminal.tsx), [terminalWindowArrangement.ts](terminalWindowArrangement.ts) and [terminalWindowArrangementState.ts](terminalWindowArrangementState.ts). In [world.css](world.css), search `.world-inspector-*`, `.world-floating-*` and `.world-intent-*`. | [Floating tests](WorldFloatingTerminal.test.ts), [arrangement tests](terminalWindowArrangement.test.ts), [arrangement-state tests](terminalWindowArrangementState.test.ts) |
| Files, Changes or history inside the Inspector | [WorkspaceInspectorHost.tsx](../components/WorkspaceInspectorHost.tsx) owns resource panes; [WorkspaceInspectorPortal.tsx](../components/WorkspaceInspectorPortal.tsx) keeps them mounted across view changes; [workspaceResource.ts](../workspaceResource.ts) qualifies resource context. | [Portal tests](../components/WorkspaceInspectorPortal.test.ts), [resource tests](../workspaceResource.test.ts) |

## Terminal presentation

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Focused Spaces tab, split panes or browser-local selection | `App`, `SpacesTabTerminal` and `terminalPresentationTarget` in [App.tsx](../App.tsx); [TabTerminalPaneLayout.tsx](../TabTerminalPaneLayout.tsx), [visibleTabLayout.ts](../visibleTabLayout.ts) and [browserNavigation.ts](../browserNavigation.ts). | [Layout tests](../visibleTabLayout.test.ts), [navigation tests](../browserNavigation.test.ts) |
| Attach, render, resize or input | [TerminalView.tsx](../components/TerminalView.tsx), [terminalConnection.ts](../terminalConnection.ts) and [terminalEndpointPresentation.ts](../terminalEndpointPresentation.ts). Terminal widget styles live in [TerminalView.css](../components/TerminalView.css). | [Connection tests](../terminalConnection.test.ts), [presentation tests](../terminalEndpointPresentation.test.ts) |
| Spaces window or Inspector terminal ownership | [SpacesTabWindow.tsx](SpacesTabWindow.tsx), [WorldTerminalPortalList.tsx](WorldTerminalPortalList.tsx) and [worldTerminalPresentation.ts](worldTerminalPresentation.ts). In [world.css](world.css), search `.world-terminal-*` and `.world-floating-*`. | [Spaces window tests](SpacesTabWindow.test.ts), [handoff tests](WorldTerminalHandoff.test.ts) |

## Large-file entry points

| File | Search for these stable symbols or selectors |
| --- | --- |
| [WorldFoundationApp.tsx](WorldFoundationApp.tsx) | `WorldFoundationApp` composes the mounted Spaces app, view stage and Inspector state; `WorldControlPlane` owns the shared top bar; `worldViewFromPath` routes views; `worldInspectorContext`, `dispatchWorldInspectorRequest`, `focusWorldNode` and `activateWorldNodeHost` qualify visual handoffs. |
| [worldObject.ts](worldObject.ts) | `buildHost` admits qualified host/space/leaf data; `buildWorldObject` combines hosts; `worldObjectForConnection` selects the operational projection; `worldObjectForWatches` and `worldObjectWithWatches` project watched nodes. |
| [App.tsx](../App.tsx) | `App` owns the focused Spaces shell and Inspector resource host; `SpacesTabTerminal` renders its tab terminal; `terminalPresentationTarget` resolves terminal presentation; the lazy `WorkspaceInspectorHost` and `WorldTerminalPortalList` imports lead to resource and portal owners. |
| [store.ts](../store.ts) | `activateConnectionState` and `reconcileConnectionCatalogSessions` retire or restore focused session state; `refreshNow` refreshes focused topology; `selectConnectionNow` switches host; `qualifiedAction` gates downstream operations by the current connection lease. |
| [world.css](world.css) | `.world-foundation-*` and `.world-view-toolbar-*` frame the shell; `.world-inspector-*`, `.world-intent-*` and `.world-floating-*` style Inspector/window presentation. Search the `Retained Pixel Office canvas` comment and `.world-canvas-*`, `.world-room-*`, `.world-completion-*`, `.world-observability-*` for Office beyond its `.world-office-*` shell; `.world-connected-tree-*`/`.world-tree-*` and `.world-spatial-graph-*` style Tree and Graph. |
