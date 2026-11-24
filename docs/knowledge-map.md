# Find the existing World mechanism first

Start with [OpenSpec capabilities](../openspec/specs/) and their adjacent
`notes.md` for contracts, controls, code paths and tests; [active changes](../openspec/changes/)
hold unfinished requirements. This is a focused index of reusable mechanisms,
not another feature catalogue. The previous catalogue was removed by
[PR #1210](https://github.com/IvoryHeart/herdr-world/pull/1210); issue #1357
requests this index so overlapping names lead to the same owner.

[The duplication audit](audits/duplicates-2026-11.md) explains remaining copies,
their history and the recommended consolidation. “Keep” there is a recommendation,
not a claim that migration has shipped. The service-owned World object remains
[a design in PR #1341](https://github.com/IvoryHeart/herdr-world/pull/1341).

## Search and find

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| World search, `/`, find an agent/room/table/host, task-summary matching | [worldSearch.ts](../web/src/world/worldSearch.ts): `worldSearchResults`, `worldNodeSearchText`, `worldSearchWords`, `worldTextMatches` | [Shell navigation](../openspec/specs/world-surfaces/shell-navigation/notes.md); result IDs/ranks belong here, canvas geometry belongs to the view. |
| Cmd+K, Ctrl+K, Find or act, opening a found agent | [worldCommandBox.tsx](../web/src/world/worldCommandBox.tsx) adapts World results; [CommandCombobox.tsx](../web/src/components/CommandCombobox.tsx) hosts commands; [commandBoxKey.ts](../web/src/commandBoxKey.ts) opens it | [Find-anywhere change](../openspec/changes/world-find-anywhere/proposal.md); use `worldFoundTarget` / `openWorldFind`, preserving connection and generation. |
| Showing a search result on a canvas | [WorldSearchResults.tsx](../web/src/world/WorldSearchResults.tsx); [Town adapter](../web/src/world/town/useTownSearch.ts), [Board adapter](../web/src/world/board/useBoardSearch.ts) | These adapt display/selection. [Town landmarks](../web/src/world/town/townSearch.ts) are currently an extra provider; [audit D01–D02](audits/duplicates-2026-11.md#d01--two-world-find-hosts) covers the gap. |
| Settings/command matching and synonyms | [settings/search.ts](../web/src/settings/search.ts): `searchSettings`, `commandMatchScore`; [searchText.ts](../web/src/searchText.ts) normalizes text | [Settings](../openspec/specs/world-surfaces/settings/notes.md); do not create another setting scorer. |
| File/path search, shortcut search, list filters | [fileSearch.ts](../web/src/fileSearch.ts), [shortcutCheatSheet.ts](../web/src/shortcutCheatSheet.ts), [hostsFilter.ts](../web/src/world/hostsFilter.ts) | Different domains: paths, key bindings and explicit host selection. Use World search for World entities. |

## Actions and menus

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Actions for a selected World entity; Files, Changes, History, Go to Spaces | [visualRouteActions.ts](../web/src/world/visualRouteActions.ts), [useWorldVisualActions.tsx](../web/src/world/useWorldVisualActions.tsx) | Capture/revalidate the entity, connection and generation; [shell-navigation contract](../openspec/specs/world-surfaces/shell-navigation/spec.md). These cover resource/navigation actions, not yet all mutation commands. |
| Publishing operational commands to Settings | [settings/commandBoxRegistry.ts](../web/src/settings/commandBoxRegistry.ts) | Reuse command admission and lifecycle; never copy callbacks into a second registry. |
| Everyday Menu | [ShortMenu.tsx](../web/src/settings/ShortMenu.tsx), hosted by [ConfigMenu.tsx](../web/src/components/ConfigMenu.tsx) | [Settings notes](../openspec/specs/world-surfaces/settings/notes.md); `ConfigMenu` is the host's historical name. |
| Town radial menu / Board hub errands | [useTownCenter.ts](../web/src/world/town/useTownCenter.ts): shared launch, master, profiles, Needs you, memory and apartments action helpers; [TownCenterMenu.tsx](../web/src/world/town/TownCenterMenu.tsx) draws rings | [Town](../openspec/specs/world-surfaces/town/notes.md), [Board](../openspec/specs/world-surfaces/board/notes.md). Board already consumes the helpers; keep view labels/geometry separate from command ownership. |
| Right-click / long-press / anchored action menu | [ActionsMenu.tsx](../web/src/components/ActionsMenu.tsx), [contextMenuPosition.ts](../web/src/components/contextMenuPosition.ts) | Reuse positioning, enabled-item keyboard navigation and item rendering before adding another menu. |
| Escape, outside click, focus return, phone Back | [layerStack.ts](../web/src/layerStack.ts), [systemBack.ts](../web/src/systemBack.ts) | [Terminal-window notes](../openspec/specs/world-surfaces/terminal-windows/notes.md); both are shared by existing menus and dialogs. |

## World data

These are the existing seams. The destination is one service-derived World and
one browser replica, as specified in [PR #1341's design][world-design]. Reusing a
browser deriver is an interim measure, not permission for another view to derive facts.

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Aggregate observation, agents, rooms, live/stale authority | [server snapshot.ts](../server/src/world/snapshot.ts), [runtime-registry.ts](../server/src/world/runtime-registry.ts); current browser [runtimeStore.ts](../web/src/world/runtimeStore.ts) and [worldObject.ts](../web/src/world/worldObject.ts) | [Runtime federation](../openspec/specs/runtime-federation/notes.md); [source ownership][world-sources]. Move derivation service-side through #1341, rather than adding a store beside these. |
| Agent names, terminal identity, status | [worldObject.ts](../web/src/world/worldObject.ts); [agentName.ts](../web/src/agentName.ts); [agentMarks.ts](../web/src/world/agentMarks.ts) / [AgentMark.tsx](../web/src/components/AgentMark.tsx) for display | [Identity](../openspec/specs/world-identity/notes.md); [audit's existing per-view findings][world-audit]. Name/status ownership is not yet fully unified. |
| One machine versus one runtime, rooms under hosts | [worldHosts.ts](../web/src/worldHosts.ts): `worldHostGroups`, `hostGroupOf`; [runtimeGrouping.ts](../web/src/world/runtimeGrouping.ts) | [Grouping change](../openspec/changes/world-runtime-grouping/tasks.md); [shell navigation](../openspec/specs/world-surfaces/shell-navigation/notes.md). Hosts selection is a distinct filter. |
| Terminal colour/look and rename | [shared/appearance.ts](../shared/appearance.ts), [useTerminalColors.ts](../web/src/world/useTerminalColors.ts), [TerminalAppearanceEditor.tsx](../web/src/world/TerminalAppearanceEditor.tsx), [appearance RPC](../server/src/rpc/appearance.ts) | [Appearance notes](../openspec/specs/world-surfaces/appearance/notes.md); legacy [terminalColor.ts](../shared/terminalColor.ts) is still bridged. #1341/#1315 own the remaining migration. |
| Pins/order across views | [useDeskPins.ts](../web/src/world/useDeskPins.ts), [corePins.ts](../web/src/world/corePins.ts), [herdrOrder.ts](../web/src/world/herdrOrder.ts) | [Single-model tasks](../openspec/changes/world-single-model/tasks.md); native pins remain runtime-owned, and legacy browser/Board pin sets still need consolidation. |
| Teams, pods, rooms, spawn stamps, effective interest | [shared/groups.ts](../shared/groups.ts), [shared/groupViews.ts](../shared/groupViews.ts), [shared/groupInterest.ts](../shared/groupInterest.ts), [server group-move.ts](../server/src/world/group-move.ts) | [Groups notes](../openspec/specs/world-surfaces/groups/notes.md); [relations.ts](../web/src/world/relations.ts) / [useAgentInterest.ts](../web/src/world/useAgentInterest.ts) are current browser consumers, not extra sources. |
| Profiles, assignments, Town master, launch | [agent/profile-service.ts](../server/src/agent/profile-service.ts), [agentProfiles.ts](../web/src/world/agentProfiles.ts), [AgentLauncherDialog.tsx](../web/src/world/AgentLauncherDialog.tsx) | [Creation profiles](../openspec/specs/world-surfaces/creation-profiles/notes.md), [Town master](../openspec/specs/world-surfaces/town-master/notes.md). Launch runtime adapters remain distinct; the World command is the target owner. |
| Git/PR facts and agent usage | [workspace/status.ts](../server/src/workspace/status.ts), [workspace/pull-request.ts](../server/src/workspace/pull-request.ts); [usage/analytics.ts](../server/src/usage/analytics.ts) and browser [usageStore.ts](../web/src/world/usage/usageStore.ts) | [Inspector](../openspec/specs/world-surfaces/inspector/notes.md), [usage](../openspec/specs/world-usage/notes.md). Reuse service facts; Town's separate usage cache is audit D11. |

## Agent communication

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Needs you, questions, waiting count and finished work | [needsYou.ts](../web/src/world/needsYou.ts): `needsYouItems` / `needsYouCount`; [NeedsYouTab.tsx](../web/src/world/NeedsYouTab.tsx) hosts it | [Needs-you notes](../openspec/specs/world-surfaces/needs-you/notes.md); Desk/Post Office/Board should consume the same attention derivation. |
| Durable asks/results; answer, dismiss, withdraw | [world-cli-asks.ts](../server/src/world/world-cli-asks.ts), [world-ledger.ts](../server/src/world/world-ledger.ts), [worldAsks.ts](../web/src/world/worldAsks.ts) replica | [Storage](../openspec/specs/world-storage/notes.md), [answer delivery](../openspec/specs/ask-answer-delivery/notes.md). Durable asks and runtime blocking prompts are different inputs to one attention list. |
| Review completion / “Mark reviewed” | [deskStateStore.ts](../web/src/world/deskStateStore.ts), [useReviewedWork.ts](../web/src/world/useReviewedWork.ts), [shownReport.ts](../web/src/world/shownReport.ts) | [Desk attention](../openspec/specs/world-surfaces/desk-attention/notes.md); review names the exact stop/report shown. |
| Task notification event policy | [herdr-notification-listener.ts](../server/src/notifications/herdr-notification-listener.ts), status fallback [task-events.ts](../server/src/notifications/task-events.ts) | [Notifications](../openspec/specs/world-surfaces/notifications/notes.md); select one service event source, preserve the runtime's semantic suppression policy. |
| Browser notification target validation, click activation, worker delivery | [taskNotifications.ts](../web/src/taskNotifications.ts) | [Audit D07](audits/duplicates-2026-11.md#d07--notification-target-validation-and-click-activation); this has the fuller target checks, duplicated in the focused store today. |
| Chimes, muted/focused interest and Focus interruption hold | [chimes/chimeCenter.ts](../web/src/chimes/chimeCenter.ts), [world/focus.ts](../web/src/world/focus.ts) | [Notifications notes](../openspec/specs/world-surfaces/notifications/notes.md); these are policy inputs, not additional question ledgers. |

## Terminals and previews

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Agent window / terminal opening and handoff | [useWorldInspectorController.ts](../web/src/world/useWorldInspectorController.ts), [worldInspectorSelection.ts](../web/src/world/worldInspectorSelection.ts), [useWorldVisualActions.tsx](../web/src/world/useWorldVisualActions.tsx), [worldTerminalPresentation.ts](../web/src/world/worldTerminalPresentation.ts), [WorldTerminalPortalList.tsx](../web/src/world/WorldTerminalPortalList.tsx), [WorkspaceInspectorHost.tsx](../web/src/components/WorkspaceInspectorHost.tsx) | [Terminal windows](../openspec/specs/world-surfaces/terminal-windows/notes.md); [WorldTerminalHandoff.test.ts](../web/src/world/WorldTerminalHandoff.test.ts) covers retained ownership. |
| Opening a found terminal in Spaces | [worldCommandBox.tsx](../web/src/world/worldCommandBox.tsx): `openWorldFind`, `worldFoundTarget`, `coreSpacesLeaf`; [SpacesCoreTerminal.tsx](../web/src/world/SpacesCoreTerminal.tsx) | [Find-anywhere tasks](../openspec/changes/world-find-anywhere/tasks.md); `App`'s `revealTerminal` request clears obstructing Inspectors. |
| Open the terminal just created | [creationRequests.ts](../web/src/creationRequests.ts), [useWorldCreatedTerminal.ts](../web/src/world/useWorldCreatedTerminal.ts), [createdTerminalAdmission.ts](../web/src/world/createdTerminalAdmission.ts) | Creation captures the source and intent; never guess the last focused pane. |
| Floating room shell | [floatShell.ts](../web/src/world/floatShell.ts) | One facade dispatches TUI's Float plugin or core's World float shell; their protocols/lifetimes differ. |
| Agent peek / latest report / quick answer | [AgentHoverCard.tsx](../web/src/world/AgentHoverCard.tsx): `AgentLatestMessage`; [shownReport.ts](../web/src/world/shownReport.ts), [conversationRead.ts](../web/src/world/conversationRead.ts), [conversationWatch.ts](../web/src/conversationWatch.ts) | [Agent-peek notes](../openspec/specs/world-surfaces/agent-peeks/notes.md); [paneScreen.ts](../web/src/world/paneScreen.ts) / [townChat.ts](../web/src/world/town/townChat.ts) handle runtime prompts and offered-key answers. |
| File preview in Inspector or Ranger | [LazyFilePreviewContent.tsx](../web/src/components/LazyFilePreviewContent.tsx) → [FilePreviewContent.tsx](../web/src/components/FilePreviewContent.tsx) | [Inspector notes](../openspec/specs/world-surfaces/inspector/notes.md); image/PDF/code/Markdown renderers are format adapters. Saved-session preview is a different resource. |

## Settings and help

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Settings home, registry, deep links, view controls | [settings/registry.ts](../web/src/settings/registry.ts), [catalog.ts](../web/src/settings/catalog.ts), [SettingsHome.tsx](../web/src/settings/SettingsHome.tsx), [viewControls.ts](../web/src/settings/viewControls.ts) | [Settings notes](../openspec/specs/world-surfaces/settings/notes.md). Register an entry with the owning store; do not copy the value or build a second configuration dialog. |
| Feature help, Try, pictures, What's new | [helpEntry.ts](../web/src/help/helpEntry.ts), [entries.ts](../web/src/help/entries.ts), [HelpPanelHost.tsx](../web/src/help/HelpPanelHost.tsx), [helpTry.ts](../web/src/help/helpTry.ts), [whatsNew.ts](../web/src/help/whatsNew.ts) | [Help contract](../openspec/specs/world-surfaces/settings/spec.md); [help-docs.ts](../scripts/help-docs.ts) generates published help. Edit declarations, not generated pictures/pages. |
| Keyboard shortcut definitions and discovery | [shortcutCatalog.ts](../web/src/shortcutCatalog.ts), [shortcutBindings.ts](../web/src/shortcutBindings.ts), [shortcutPreferences.ts](../web/src/shortcutPreferences.ts) | [Shell navigation](../openspec/specs/world-surfaces/shell-navigation/notes.md); cheat sheet and command labels consume these. |

## Stores and clients

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| Persistent data owner / existing store before adding one | [storage/catalog.ts](../server/src/storage/catalog.ts), [world-storage.ts](../server/src/storage/world-storage.ts) | [Storage notes](../openspec/specs/world-storage/notes.md); retained JSON/imports are migration inputs, not a second writer. |
| Board wire types/operations and durable implementation | [world/board-types.ts](../server/src/world/board-types.ts), [board-port.ts](../server/src/storage/board-port.ts), [world-board.ts](../server/src/storage/world-board.ts) | [Board notes](../openspec/specs/world-surfaces/board/notes.md). Audit D16 recommends extracting the public DTO subset to `shared/`; current browser declarations still duplicate it. |
| Browser Board, Desk, asks, Apartments and Bin replicas | [boardDocument.ts](../web/src/world/board/boardDocument.ts), [deskStateStore.ts](../web/src/world/deskStateStore.ts), [worldAsks.ts](../web/src/world/worldAsks.ts), [apartmentsStore.ts](../web/src/world/apartments/apartmentsStore.ts), [binStore.ts](../web/src/world/bin/binStore.ts) | Reuse each existing singleton; audit D13 covers copied lifecycle code. Replicas read their service owner; they are not additional durable stores. |
| Browser RPC, connection client, reconnect | [api.ts](../web/src/api.ts), [connectionClient.ts](../web/src/connectionClient.ts), [useConnectionClient.ts](../web/src/useConnectionClient.ts), [store.ts](../web/src/store.ts) | [Runtime federation](../openspec/specs/runtime-federation/notes.md); `handleBridgeStatus` and `store.init` still duplicate a transition (D14). Never default to another connection. |
| Service runtime routing and adapters | [connections/manager.ts](../server/src/connections/manager.ts), [adapters/registry.ts](../server/src/adapters/registry.ts), [runtime-ports.ts](../server/src/adapters/runtime-ports.ts) | [Adapters](../openspec/specs/world-adapters/notes.md); browser RPC transport and runtime transports are different boundaries. |
| Connection/host settings and validation | [profile-validation.ts](../server/src/connections/profile-validation.ts), [host-service.ts](../server/src/connections/host-service.ts), [connectionProfiles.ts](../web/src/connectionProfiles.ts); [LocalProfileForm.tsx](../web/src/components/LocalProfileForm.tsx) is D12's shared-field extraction seed | [Federation notes](../openspec/specs/runtime-federation/notes.md); Local/SSH forms share validation owners, while SSH policy stays in OpenSSH. |

## Shared mechanics

| Looking for | Existing piece to use | Guidance |
| --- | --- | --- |
| HTTP settings response helpers | [sources/http.ts](../server/src/sources/http.ts): `jsonResponse`, `jsonError`, `methodNotAllowed` | Audit D18 recommends extracting these small helpers for observability too; auth and feature validation remain with each handler. |
| Bounded process execution / SSH scheduling | [utils/process-utils.ts](../server/src/utils/process-utils.ts), [bridge/ssh-sessions.ts](../server/src/bridge/ssh-sessions.ts) | Audit D20; binary output and stdin handling in [workspace/process.ts](../server/src/workspace/process.ts) remain necessary adapters. |
| Endpoint binary frames | [bridge/bincode.ts](../server/src/bridge/bincode.ts), [endpoint-client.ts](../server/src/bridge/endpoint-client.ts) | Audit D21 recommends sharing bounded frame buffering with `thin-client.ts`, not merging unlike handshakes, NDJSON RPC or browser WebSockets. |
| Town projection container update | [townFinished.ts](../web/src/world/town/townFinished.ts): `withTownFinished`; [officeReadModel.ts](../web/src/world/officeReadModel.ts): `withOfficeReadModel` | Audit D22 covers the copied container traversal in `townOutOfFuel.ts`; semantic attention remains part of World consolidation. |
| Town pixel drawing primitives | [townSprites.ts](../web/src/world/town/townSprites.ts): `townCanvas`; existing local `painter` in [townPostPaint.ts](../web/src/world/town/townPostPaint.ts) | Audit D19 recommends sharing its rounded rectangle/disc helpers with `townLibraryPaint.ts`; individual building artwork stays local. |

[world-design]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/design.md
[world-audit]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md
[world-sources]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/sources.md
