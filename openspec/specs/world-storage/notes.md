# world-storage notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

`server/src/storage/catalog.ts` is the single source of truth for what data lives where.

**Surfaces:**

- Shared settings, runtime status, durable Board layout and terminal marks.

**Code:**

- `server/src/storage/catalog.ts`
- `server/src/storage/catalog.test.ts`
- `scripts/storage-catalog.ts`
- `scripts/storage-catalog-sources.ts`

- `server/src/workspace/`
- `server/src/worktree/`
- `server/src/rpc/desk.ts`
- `server/src/rpc/desk.test.ts`
- `server/src/storage/profile-port.ts`
- `server/src/service/profile-storage.test.ts`
- `server/src/storage/board-port.ts`
- `server/src/service/board-storage.test.ts`
- `server/src/storage/runtime-status.ts`
- `server/src/service/runtime-status-storage.test.ts`
- `server/src/storage/terminal-marks.ts`
- `server/src/storage/terminal-marks.test.ts`
- `server/src/world/world-cli-asks.ts`
- `web/src/world/NeedsYouAskerActions.tsx`
- `server/src/world/world-question-ownership.test.ts`
- `server/src/world/question-backlog-storage.test.ts`
- `web/src/world/NeedsYouAskerActions.dom.test.ts`
- `server/src/storage/world-storage.ts`
- `server/src/storage/world-storage-crash.test.ts`
- `server/src/storage/`
- `server/src/config/`

**Pitfalls:**

- Shared settings and conditional writes retain service ownership.

<!-- storage-catalog:start -->
Generated from `server/src/storage/catalog.ts`; run `bun scripts/storage-catalog.ts --write`.
Current limits describe existing behavior, including existing expiry; this step changes no retention. Browser keys omit the foundation-v2 prefix; `*` denotes a parameterized family, additionally connection-scoped where applicable. Memory lists source owners and read/renderer projections; request-local scratch is excluded.

| Store / location | Product meaning | Feature | Identity | Role | Current limit | Owning code |
| --- | --- | --- | --- | --- | --- | --- |
| world.sqlite: ledger_meta | Question/result revision and replay floor | questions | singleton | source | 1 | server/src/storage/world-schema.ts |
| world.sqlite: asks | Questions and saved answers | questions | id | source | 500 open; 20 per verified terminal | server/src/storage/world-schema.ts |
| world.sqlite: results | Agent task results | results | id | source | 1000 | server/src/storage/world-schema.ts |
| world.sqlite: ledger_changes | Legacy ledger change records | questions | id | source | 2000 | server/src/storage/world-schema.ts |
| world.sqlite: outbox | Durable external-effect intents and recovery evidence | effects | id; unique kind + record_id | source | record lifetime; bounded admission | server/src/storage/world-schema.ts |
| world.sqlite: answer_attempts | Answer delivery attempts | effects | intent_id + attempt | source | intent lifetime | server/src/storage/world-schema.ts |
| world.sqlite: effect_decisions | Owner effect decisions | effects | seq | source | intent lifetime | server/src/storage/world-schema.ts |
| world.sqlite: replay_changes | Ordered reconnect replay window | effects | seq | derived | 10000 rows / 24 hours (existing) | server/src/storage/world-schema.ts |
| world.sqlite: sqlite_sequence | SQLite AUTOINCREMENT high-water marks | storage | name | derived | one per AUTOINCREMENT table | server/src/storage/world-schema.ts |
| world.sqlite: imports | Completed legacy imports | storage | name | source | none — user decides | server/src/storage/world-schema.ts |
| world.sqlite: world_ids | Issued identities, never reused | identity | id | source | none — user decides | server/src/storage/world-ids.ts |
| world.sqlite: world_bindings | Evidence-backed World/runtime identity links | identity | id; record_id + slot | source | none — user decides | server/src/storage/world-bindings.ts |
| world.sqlite: world_binding_legacy | Legacy Board capture identity mapping | identity | key | source | none — user decides | server/src/storage/legacy-bindings.ts |
| world.sqlite: world_binding_sync | Legacy Board binding synchronization marker | identity | singleton | source | 1 | server/src/storage/legacy-bindings.ts |
| world.sqlite: board_meta | Board revision and optional family flags | board | singleton | source | 1 | server/src/storage/world-board.ts |
| world.sqlite: board_notes | Sticky notes | board | key (note id) | source | 500 | server/src/storage/world-board.ts |
| world.sqlite: board_strings | Connections between cards | board | key (string id) | source | 2000 | server/src/storage/world-board.ts |
| world.sqlite: board_shapes | Canvas drawings | board | key (shape id) | source | BOARD_SHAPE_LIMITS | server/src/storage/world-board.ts |
| world.sqlite: board_elements | Canvas source links, images and text | board | key (element id) | source | BOARD_ELEMENT_LIMITS | server/src/storage/world-board.ts |
| world.sqlite: board_anchors, board_offsets, board_pinned, board_folded | Canvas placement, pins and folds | board | key (native card/connection) | source | BOARD_LIMITS layout; 2000000-byte document | server/src/storage/world-board.ts |
| world.sqlite: board_colors | Host/workspace/tab colours | appearance | key (native card/host) | source | BOARD_LIMITS layout | server/src/storage/world-board.ts |
| world.sqlite: board_appearance | Captured terminal appearance | appearance | key (connection + kind + native id) | source | BOARD_LIMITS appearance | server/src/storage/world-board.ts |
| world.sqlite: board_desk_pins | Town pinned desks | town | key (tab) | source | BOARD_LIMITS layout | server/src/storage/world-board.ts |
| world.sqlite: board_room_pins | Town room spots | town | key (workspace) | source | BOARD_LIMITS layout | server/src/storage/world-board.ts |
| world.sqlite: board_interest, board_group_interest | Agent/group mute and focus | interest | key (terminal/group) | source | BOARD_LIMITS interest | server/src/storage/world-board.ts |
| world.sqlite: board_spawns | Retained parent/child spawn captures | groups | key (position) | source | RELATION_LIMITS | server/src/storage/world-board.ts |
| world.sqlite: board_groups | Teams and groups | groups | key (group id) | source | RELATION_LIMITS | server/src/storage/world-board.ts |
| world.sqlite: board_group_changes | Recent group edits and attribution | groups | key (position) | source | 128 | server/src/storage/world-board.ts |
| world.sqlite: agent_profiles | Agent launch profiles | profiles | id | source | 64 | server/src/storage/world-profiles.ts |
| world.sqlite: profile_chimes, profile_store_meta | Chime preferences and profile/master revisions | profiles | singleton | source | 1 each | server/src/storage/world-profiles.ts |
| world.sqlite: profile_legacy_assignments | Pending old terminal/profile assignments | profiles | position | source | none — user decides | server/src/storage/world-profiles.ts |
| world.sqlite: profile_imported_connections | Completed runtime assignment imports | profiles | connection_id | source | none — user decides | server/src/storage/world-profiles.ts |
| world.sqlite: auto_sync_runs | Last workspace auto-sync run status | workspace-sync | key | source | none — user decides | server/src/storage/runtime-status.ts |
| world.sqlite: terminal_marks | Desk stop/open history and watchlist captures | desk | id → binding_id | source | 500 history; 40 opens; 128 watches; 768 KiB | server/src/storage/terminal-marks.ts |
| world.sqlite: retired_completion_reviews | Retired completion reviews archive | desk | id | source | 4096; 64 MiB; 30 days (existing) | server/src/storage/legacy-review-migration.ts |
| world.sqlite: apartment_residents | Past agent sessions | apartments | id; harness + session | source | 5000 | server/src/storage/apartments.ts |
| world.sqlite: apartment_evictions | Sessions explicitly excluded from returning | apartments | session_key | source | 20000 | server/src/storage/apartments.ts |
| world.sqlite: core_topology | World-owned herdr-core rooms and tabs | core | core_id | source | 256 rooms; 512 KiB | server/src/storage/core-topology.ts |
| assistant/tasks.sqlite: tasks, runs, proposals, requests | Ranger scheduling, runs, proposals and request idempotency | ranger | id (task/run/proposal/request) | source | 32 MB state | server/src/assistant/task-storage.ts |
| assistant/execution.sqlite: durable_schema, durable_metadata | SDK schema version and execution metadata | ranger | singleton | source | 1 each | server/src/assistant/durable-storage.ts |
| assistant/execution.sqlite: record_ids | SDK issued durable record identities | ranger | record id | source | none — user decides | server/src/assistant/durable-storage.ts |
| assistant/execution.sqlite: conversations, entries | SDK conversations and committed execution entries | ranger | conversation/entry id | source | none — user decides | server/src/assistant/durable-storage.ts |
| assistant/execution.sqlite: tasks, submissions | SDK durable tasks and submissions | ranger | task/submission id | source | none — user decides | server/src/assistant/durable-storage.ts |
| assistant/execution.sqlite: documents, document_revisions | SDK documents and revision history | ranger | document address/revision | source | none — user decides | server/src/assistant/durable-storage.ts |
| file: <data>/ | Instance data-folder root | storage | resolved data root | source | none — user decides | server/src/config/data-paths.ts |
| file: settings.json | Configuration and roaming ui preferences | settings | repository/settings/ui key | source | none — user decides | server/src/config/gui-settings.ts |
| file: connections.json | Offline-editable connection and host profiles | connections | immutable connection/host id | source | none — user decides | server/src/connections/profiles.ts |
| file: boards/board.json | Retained pre-SQLite Board input | board | legacy document | source | none — user decides | server/src/storage/board-import.ts |
| file: boards/world-ledger.json | Retained legacy asks/results input; hash-change imports | questions | legacy record id | source | none — user decides | server/src/storage/world-import.ts |
| file: agent-profiles.json | Retained pre-SQLite profiles input | profiles | profile id | source | none — user decides | server/src/storage/profile-import.ts |
| file: web-push.json | Private VAPID keys and push devices/preferences | notifications | device endpoint | source | none — user decides | server/src/notifications/web-push.ts |
| file: source-secrets*.json | Private integration credentials | integrations | source id | source | none — user decides | server/src/integrations/vault.ts |
| file: session-secret.json | Private session signing secret | auth | instance | source | 1 | server/src/config/session-secret.ts |
| file: auth-token | Private CLI authentication token | auth | instance | source | 1 | server/src/config/auth-token.ts |
| file: instances/*.json | Expiring cross-instance discovery reports | shipyard | hash of data root | cache | SHIPYARD_LIMITS; expiring | server/src/shipyard/instances.ts |
| file: instance.lock, instance.lock.claim/, connections.json.ownership.sqlite | Listener/registry ownership locks (no domain tables) | connections | data root / registry inode | derived | 1 per owner | server/src/connections/registry-ownership.ts |
| file: world.sqlite, world.sqlite-* | World database and SQLite journal sidecars | storage | instance | source | none — user decides | server/src/storage/world-storage.ts |
| file: usage-activity.json | Per-agent/day observed activity and run links | usage | analytics agent digest + day | source | 8192 rows; 4 MiB | server/src/usage/activity.ts |
| file: ide.json | IDE provider choices, accepted terms/trust and the list of IDE servers this World started | code | provider id; server id + connection id | source | 256 servers; until Stop, host shows gone or forgotten | server/src/ide/settings.ts |
| file: ide/servers/*, ide/forwards/*.sock | Private per-server IDE folders (record, token, log, socket) and SSH socket forwards | code | server id | derived | 4 running servers; a folder stays until the next start or Stop | server/src/ide/instances.ts server/src/ide/host.ts |
| file: assistant/, assistant/state.json, assistant/sessions/*, assistant/tasks/*/runs/* | Ranger state, chat transcripts and run artifacts | ranger | session/task/run UUID | source | none — user decides | server/src/assistant/service.ts |
| file: assistant/auth.json, assistant/models.json | Private Ranger provider credentials and model configuration | ranger | provider | source | none — user decides | server/src/assistant/pi-driver.ts |
| file: assistant/tasks.sqlite, assistant/tasks.sqlite-* | Ranger task database and journal sidecars | ranger | instance | source | 32 MB state | server/src/assistant/task-storage.ts |
| file: assistant/durable/*/execution.sqlite, assistant/durable/*/execution.sqlite-*, assistant/durable/*.lock/ | Ranger SDK durable execution store, sidecars and ownership lock | ranger | durable execution UUID | source | none — user decides | server/src/assistant/durable-storage.ts |
| file: *.sqlite-import.bak, *.runtime-status-import.bak, world.sqlite.v*.bak | Exact import backups and pre-upgrade VACUUM INTO snapshots | storage | content hash / schema version + snapshot id | source | none — user decides | server/src/storage/world-schema.ts |
| file: agent-profiles.json.before-terminal-settings, connections.json.bak-* | Retained manual/upgrade configuration backups | storage | original file + backup suffix | source | none — user decides | server/src/config/data-paths.ts |
| file: <config>/integrations/*.disabled, herdr-world.env | Integration opt-outs and installed service environment | installation | integration id / environment key | source | none — user decides | server/src/cli/integration-preferences.ts |
| browser: tabPins.v1 | Spaces tab pins (browser-owned today) | spaces | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/tabPins.ts |
| browser: workspacePins.v1, agentOrder.v1, agentListPreferences.v1, agentListScope, workspaceAgentLayout, collapsedWorktreeGroups.v1 | Navigator pins, order, grouping and folds | spaces | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/agentOrder.ts web/src/workspacePins.ts web/src/workspaceTreeCollapse.ts web/src/components/WorkspaceTree.tsx |
| browser: agentLaunchCommand.v1:* | Per-agent-kind launch commands | profiles | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/agentLauncher.ts |
| browser: customTerminalThemes.v1, terminalThemeSelection.v1 | Custom themes and theme selection | appearance | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/terminalThemes.ts |
| browser: officePreferences:v1 | Town behavior, quiet time and presentation settings | town | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/officePreferences.ts |
| browser: townReception.v1, keyboardShortcuts.v1, keyboardShortcuts.pending.v1, keyboardShortcuts.serverSeen.v1 | Roaming preference caches and pending shortcut edits | settings | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | cache | one value per key; browser quota | web/src/shortcutPreferences.ts web/src/world/town/townReceptionSetting.ts |
| browser: taskNotificationPreferences, taskNotificationsEnabled, taskNotificationTransport, chimeDevice | Device notification preferences and sound opt-in | notifications | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/store/notifications.ts web/src/chimes/chimeCenter.ts |
| browser: herdr-world.board.unsaved:*, workspaceAnnotations:v1:* | Unsent note/comment drafts | drafts | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | browser quota; annotations: 200 per scope | web/src/world/board/boardDrafts.ts web/src/annotations.ts |
| browser: focusChimed, focusRecapDismissed | Last chimed and dismissed focus session | focus | World origin + browser profile; session id | source | one session id per key; browser quota | web/src/world/focus.ts |
| browser: focusTest | Testing-only short focus choice | focus | World origin + browser tab | source | one flag; tab lifetime | web/src/world/focusTest.ts |
| browser: presence.lastSeen.v1, presence.return.v1, presence.dismissedUpTo.v1 | Device last sighting and return recap | presence | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/presence.ts |
| browser: pullRequestSummaries:v1 | PR badge summaries | work-sources | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | cache | 200 | web/src/pullRequestCache.ts |
| browser: worldHostsFilter.v1, lastConnection, connectionPaused, connectionStorageStartupCopy:v1, layoutPreferences.v1 | Device host selection, connection and layout preferences | shell | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/hostsFilter.ts web/src/store/lastConnection.ts web/src/connectionStorage.ts web/src/layoutPreferences.ts |
| browser: theme, accentColor, uiScale, terminalFontFamily, terminalFontScale, chatTextScale, blackBackground, zenMode, zenMode.* | Device theme, font, scale and distraction settings | appearance | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/App.tsx web/src/appearance.ts web/src/textScales.ts |
| browser: terminalInputMode.v1, terminalOptionAsMeta.v1, mobileControlsPlacement, speechPreferences, mobileTerminalShortcuts.v1, mobileTerminalShortcuts.v2, mobileTerminalSideShortcuts.v1 | Terminal, speech and mobile input settings (including legacy shortcut keys) | terminal | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/terminalInputMode.ts web/src/terminalOptionKey.ts web/src/mobileControlsPlacement.ts web/src/speechPreferences.ts web/src/mobileTerminalShortcuts.ts |
| browser: automaticUpdateChecksEnabled, pendingUpdateReloadVersion, pendingHerdrUpgrade, notifiedUpdateVersion:*, update-notifications/versions | Update preferences, pending installs and cross-window IndexedDB announcement claims | updates | device + version | source | none — user decides | web/src/store/updates.ts web/src/updateNotifications.ts |
| browser: help.seen | Last offered help release | help | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/help/whatsNew.ts |
| browser: townLens, townDaylight.v1, townWeather.v1 | Town lens, daylight and weather presentation | town | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/town/townLensStore.ts web/src/world/town/townDaylight.ts web/src/world/town/townWeather.ts |
| browser: herdr-world.board.appearance, herdr-world.board.pulses, herdr-world.board.move-no-ask | Board canvas appearance, activity pulses and move confirmation | board | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/board/boardAppearance.ts web/src/world/board/boardPulses.ts web/src/world/BoardView.tsx |
| browser: code.project, code.rail, code.loaded | Code view chosen project, rail open state and workbenches this tab loaded (sessionStorage) | code | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; code.loaded 16 ids | web/src/world/code/CodeView.tsx |
| browser: needsYou.open.v1, desk.mode.v1 | Needs-you expansion and Desk mode (sessionStorage) | desk | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/needsYou.ts web/src/world/DeskView.tsx |
| browser: worldFloatingTerminalGeometry:v1, worldFloatingTerminalDock:v1, worldWindowFitWidth:v1 | Floating window size, position, dock and fit width | windows | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/floatingTerminalPreferences.ts |
| browser: workspaceInspector:*, workspaceInspectorFile:*, fileExplorerWorkspaceId, fileExplorerShowHidden:*, filePreview, diffViewerWorkspaceId, diffViewerBase:*, diffViewerScope, diffViewerScope:*, diffViewerSelected:*, diffViewMode, desktopDiffWrap, mobileDiffWrap, agentHistoryView, sidebarWidth, annotationPanelMode, assistantPanelMode | Inspector navigation, resource selection, diff and shell presentation | inspector | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/workspaceResource.ts web/src/connectionStorage.ts web/src/components/DiffViewerPanel.tsx web/src/components/DiffContentView.tsx web/src/App.tsx |
| browser: worldShipyardRepo.v1, worldShipyardManual.v1 | Shipyard selected repository and manual repository choices | shipyard | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/world/shipyard/shipyardStore.ts |
| browser: debugLatency, herdr-world.*.trace, herdr:lazy-chunk-reload:* | Device diagnostics and session chunk-reload guard | diagnostics | World origin + browser profile (+ tab for sessionStorage); connection/resource suffix where shown | source | one value per key; browser quota | web/src/latencyDebug.ts web/src/world/devtools/trace.ts web/src/lazyWithReload.ts |
| memory: server/src/features/presence/clock.ts#OwnerPresenceClock | Owner last sighting across devices | presence | instance | source | 1 timestamp | server/src/features/presence/clock.ts |
| memory: server/src/shipyard/instances.ts#ShipyardInstances, server/src/shipyard/projects.ts#ShipyardProjects, server/src/shipyard/service.ts#ShipyardService | Local-instance discovery and repository/release observations | shipyard | data-root hash / connection + generation / repository | cache | SHIPYARD_LIMITS; expiring caches | server/src/shipyard/instances.ts server/src/shipyard/projects.ts server/src/shipyard/service.ts |
| memory: server/src/world/agent-activity-cache.ts#AgentActivityCache, server/src/world/observation-v1.ts#WorldObservation, server/src/world/snapshot.ts#WorldSnapshotService | Qualified observed runtime topology and agent activity | world-model | connection + generation + native id | cache | 512 workspaces; 2048 tabs; 4096 panes/agents; activity cache 5 seconds | server/src/world/agent-activity-cache.ts server/src/world/observation-v1.ts server/src/world/snapshot.ts |
| memory: server/src/world/apartment-census.ts#ApartmentCensus, server/src/world/apartments.ts#WorldApartments | Harness census and live retirement observations | apartments | connection + generation + session | cache | apartment census bounds; active hosts | server/src/world/apartment-census.ts server/src/world/apartments.ts |
| memory: server/src/world/bin.ts#WorldBinRegistry | Reversible Bin holding, bus schedule and recent outcomes | bin | service epoch + entry id | source | 64 entries; 12 outcomes; lost on service restart | server/src/world/bin.ts |
| memory: server/src/world/board-store.ts#BoardStore, server/src/world/persistent-terminal-marks.ts#PersistentTerminalMarks, server/src/world/world-ledger.ts#WorldLedger | Acknowledged Board, ledger and mark read state (legacy standalone ports can own JSON) | storage | document revision / record id | cache | same limits as durable families | server/src/world/board-store.ts server/src/world/persistent-terminal-marks.ts server/src/world/world-ledger.ts |
| memory: server/src/world/desk-state.ts#WorldDeskRegistry, server/src/world/watchlist.ts#WorldWatchlistRegistry | Current Desk/watchlist projections of durable captures and runtime observations | desk | connection + generation + terminal + occupant | derived | 500 Desk history; 128 watches; 768 KiB | server/src/world/desk-state.ts server/src/world/watchlist.ts |
| memory: server/src/world/desk-read-queues.ts#DeskReadQueues, server/src/world/desk-watches.ts#DeskWatches, server/src/world/focused-acquisition.ts#FocusedAcquisition, web/src/world/handoffs.ts#DeskReadQueues | View subscriptions, focused acquisition holds and pending reads | desk | socket + qualified terminal + read kind | source | 16 screens / 40 receipts; 64 focused owners per client; subscription lifetime | server/src/world/desk-read-queues.ts server/src/world/desk-watches.ts server/src/world/focused-acquisition.ts web/src/world/handoffs.ts |
| memory: server/src/world/field-claims.ts#FieldClaims | Source-owned claims; silence does not retract | identity | source + field | source | one claim per source/channel | server/src/world/field-claims.ts |
| memory: server/src/world/observability.ts#OfficeObservabilityService | Runtime/session activity observations | usage | connection + generation + session | cache | live observation bounds | server/src/world/observability.ts |
| memory: web/src/world/agentQuests.ts#AgentQuestReads, web/src/world/apartments/apartmentsStore.ts#WorldApartmentsStore, web/src/world/bin/binStore.ts#WorldBinStore, web/src/world/board/boardDocument.ts#BoardDocumentStore, web/src/world/deskStateStore.ts#WorldDeskStore, web/src/world/runtimeStore.ts#WorldRuntimeStore, web/src/world/usage/usageStore.ts#UsageAnalyticsStore, web/src/world/watchlistStore.ts#WorldWatchlistStore, web/src/world/worldAnswerDeliveries.ts#WorldAnswerDeliveriesStore, web/src/world/worldAsks.ts#WorldAsksStore | Browser subscriptions and acknowledged server model projections | world-model | connection/generation + record/document revision | cache | server family limits; active browser subscriptions | web/src/world/agentQuests.ts web/src/world/apartments/apartmentsStore.ts web/src/world/bin/binStore.ts web/src/world/board/boardDocument.ts web/src/world/deskStateStore.ts web/src/world/runtimeStore.ts web/src/world/usage/usageStore.ts web/src/world/watchlistStore.ts web/src/world/worldAnswerDeliveries.ts web/src/world/worldAsks.ts |
| memory: web/src/world/coreShared.ts#CoreSeenSharer, web/src/world/deskWatchClient.ts#DeskWatchClient, web/src/world/drawReadiness.ts#DrawReadiness | Browser read/watch ownership and first-draw readiness | world-model | page + socket + qualified terminal | derived | active view/watch limits | web/src/world/coreShared.ts web/src/world/deskWatchClient.ts web/src/world/drawReadiness.ts |
| memory: web/src/world/presence.ts#OwnerPresence | Device return recap and opened/dismissed state | presence | device + away window | source | one return window | web/src/world/presence.ts |
| memory: web/src/world/town/townJoinSeats.ts#TownJoinSeats | Page-only team-join seat placement | town | room + desk key + shape/order witness | source | 30 second pending join; page lifetime | web/src/world/town/townJoinSeats.ts |
| memory: web/src/world/board/boardPlacement.ts#RectIndex, web/src/world/town/TownEdgeLayer.tsx#TownEdgeArrowStore, web/src/world/town/scene/townHud.ts#TownHud, web/src/world/town/scene/townInteraction.ts#TownInteraction, web/src/world/town/scene/townScene.ts#TownScene, web/src/world/town/scene/townSceneCamera.ts#TownSceneCamera, web/src/world/town/scene/townSceneDiff.ts#TownSceneDiff, web/src/world/town/townActors.ts#TownActors, web/src/world/town/townAmbient.ts#TownAmbient, web/src/world/town/townArrivals.ts#TownArrivals, web/src/world/town/townBoardPlacement.ts#TownBoardPlacement, web/src/world/town/townBuildingLayers.ts#TownBuildingLayers, web/src/world/town/townBuildingSigns.ts#TownBuildingSigns, web/src/world/town/townCamera.ts#TownCamera, web/src/world/town/townFinished.ts#TownFinishedTracker, web/src/world/town/townPlaceUsage.ts#TownUsageStore, web/src/world/town/townScaleRuntime.ts#TownScaleRuntime, web/src/world/town/townStepStore.ts#TownStepStore, web/src/world/town/useTownStepReads.ts#TownStepReads, web/src/world/townMasterGreeting.ts#TownMasterGreeting | Page-only scene, camera, animation, placement and renderer state | presentation | page + view + native render key | derived | presentation bounds; page lifetime | web/src/world/board/boardPlacement.ts web/src/world/town/TownEdgeLayer.tsx web/src/world/town/scene/townHud.ts web/src/world/town/scene/townInteraction.ts web/src/world/town/scene/townScene.ts web/src/world/town/scene/townSceneCamera.ts web/src/world/town/scene/townSceneDiff.ts web/src/world/town/townActors.ts web/src/world/town/townAmbient.ts web/src/world/town/townArrivals.ts web/src/world/town/townBoardPlacement.ts web/src/world/town/townBuildingLayers.ts web/src/world/town/townBuildingSigns.ts web/src/world/town/townCamera.ts web/src/world/town/townFinished.ts web/src/world/town/townPlaceUsage.ts web/src/world/town/townScaleRuntime.ts web/src/world/town/townStepStore.ts web/src/world/town/useTownStepReads.ts web/src/world/townMasterGreeting.ts |
| memory: server/src/world/runtime-registry.ts#worldRuntimeRegistry | Current runtime leases and generation ownership | connections | immutable connection id + generation | source | configured connections | server/src/world/runtime-registry.ts |
| memory: server/src/storage/world-storage.ts#openWorldLedger | Committed worker read caches: ledger, Board, profiles, apartments and core | storage | instance + family revision | cache | durable family limits | server/src/storage/world-storage.ts |
| memory: server/src/agent/profile-store.ts#ProfileStore | Acknowledged profile/chime reads and legacy standalone JSON port | profiles | profile id / revision | cache | 64 profiles | server/src/agent/profile-store.ts |
| memory: server/src/service/world-service.ts#createWorldService | Composition-owned runtime handles, move queues and readiness generations | connections | connection id + generation | derived | configured connections | server/src/service/world-service.ts |
| memory: web/src/store.ts#store | Active-connection Spaces topology and transient shell state | spaces | connection id + generation + native id | cache | live runtime topology | web/src/store.ts |
| memory: web/src/world/town/useTownOffice.ts#useTownOffice | Page-only expanded rooms and desk reveal limits | town | room key | source | 24 initial desks; 20 more per expansion | web/src/world/town/useTownOffice.ts |
| memory: server/src/world/relations.ts#relationObservations | Runtime spawn claims before retained Board projection | groups | connection + terminal + parent claim | derived | RELATION_LIMITS | server/src/world/relations.ts |
| memory: web/src/world/apartments/useApartments.ts#worldApartmentsStore, web/src/world/bin/useWorldBin.ts#worldBinStore, web/src/world/town/townPlaceUsage.ts#townUsageStore, web/src/world/usage/usageStore.ts#usageAnalyticsStore, web/src/world/shipyard/shipyardStore.ts#ShipyardStore, web/src/world/worldSources.ts#WorldSourcesStore | Shared browser apartment, Bin, usage, release and source projections | world-model | page + server revision + record/repository id | cache | upstream family limits | web/src/world/apartments/useApartments.ts web/src/world/bin/useWorldBin.ts web/src/world/town/townPlaceUsage.ts web/src/world/usage/usageStore.ts web/src/world/shipyard/shipyardStore.ts web/src/world/worldSources.ts |
| memory: web/src/world/worldRoomCache.ts#roomInputCache | Immutable room-input projection variants | world-model | workspace object + input fingerprint | cache | 2 variants per weakly held workspace | web/src/world/worldRoomCache.ts |
| memory: web/src/world/worldFrameScheduler.ts#WorldFrameScheduler | Page animation frame scheduling | presentation | page + frame callback | derived | active callbacks; page lifetime | web/src/world/worldFrameScheduler.ts |
| memory: web/src/world/board/boardDrafts.ts#createDraftStore | Unsent Board drafts and in-flight saves across remounts | drafts | note key | source | none — user decides | web/src/world/board/boardDrafts.ts |
| file: assistant/.invalid-state-*.json | Quarantined malformed Ranger state preserved on load | ranger | quarantine UUID | source | none — user decides | server/src/assistant/service.ts |
| file: profiles/* | Opt-in service CPU profiles | diagnostics | capture id | derived | 1–300 second capture; no automatic retention | server/src/config/server-config.ts |
| file: .*.tmp, .world-snapshot-*/snapshot.sqlite | Private atomic-write and snapshot staging files | storage | target + attempt id | derived | operation lifetime | server/src/config/data-paths.ts server/src/storage/world-schema.ts |
<!-- storage-catalog:end -->
