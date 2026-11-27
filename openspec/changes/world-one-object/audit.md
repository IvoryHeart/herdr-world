# Audit: where views break the rule today

Read on 2026-11-24 at `18811673d`. Three kinds of break:

- **Copy**: a view keeps its own copy of World state, or holds a World fact in the
  browser only (localStorage, a URL parameter, a module variable).
- **Derive**: a view works out a fact in its own code, so two views can disagree.
- **Around**: a view writes to a runtime or a store without a World command.

"Runtime tier" below means a verb declared in `server/src/verbs/rpc.ts` that the
service passes straight to Herdr (`service/rpc-dispatch.ts`, `tui.call`), with no
World validation, record or observation.

## The root

| Kind | Where | What |
|---|---|---|
| Derive | `web/src/world/runtimeStore.ts`, `web/src/world/worldObject.ts` | The World object is built in the browser from raw per-connection topology that `world.snapshot` returns. The CLI, Apartments, notifications and Ranger cannot use it, so the service derives the same facts again (`server/src/features/apartments/service.ts`, `server/src/world/world-cli.ts` `ls`, `server/src/world/group-move.ts`). |
| Copy | `web/src/store/refresh.ts:157-200` | Spaces calls `workspace.list`, `tab.list`, `pane.list` and `agent.list` itself and keeps the result apart from `worldRuntimeStore`, with its own copy of git status (`refresh.ts:33-48`). |
| Around | `server/src/rpc/world.ts:125-185` | Reading `world.snapshot` also writes: it prunes appearance, records spawn claims and copies legacy tab colours into the Board store. A read should not change state. |

## Name

| Kind | Where | What |
|---|---|---|
| Around | `web/src/store.ts:1319,1378`, `web/src/store/operations.ts:494,505`, `web/src/world/BoardView.tsx:327` | Tab names written with runtime-tier `tab.rename` (tab bar, command bar, Board's new tab). |
| Around | `web/src/store.ts:1672,1685`, `web/src/world/roomRenameClose.tsx:61` | Room names written with runtime-tier `workspace.rename`, shared by Town and Board. Core rooms use the World verb `world.core.room.rename`; Herdr rooms do not. Fixed: both go through the `world.command` room rename (task 4.5). |
| ok | `web/src/world/TerminalAppearanceEditor.tsx` → `world.appearance.rename` | The one rename that goes through World. |
| Derive | `web/src/world/town/officeAgent.ts:35`, `web/src/world/deskAgentLabels.ts:9`, `web/src/world/board/useBoardHerdrActions.tsx:71`, `web/src/world/needsYou.ts:22`, `web/src/world/code/codeProjects.ts:154`, `web/src/components/agentDisplayName.ts:6`, `web/src/agentName.ts:21`, `web/src/world/memory/memoryModel.ts:112` | Eight agent-name rules with different fallbacks; Inspector alone shows `name-harness`. |
| Derive | `web/src/world/town/officeAgent.ts:89`, `web/src/world/board/boardRoom.ts` | Desk labels: Town falls back to the single agent's name, Board to the tab label. |
| Derive | `server/src/world/world-cli.ts:675-700` | CLI `ls` shows raw labels and raw `pane.agent_status`. |

## Colour and look

| Kind | Where | What |
|---|---|---|
| Copy | `shared/appearance.ts:49` vs `shared/terminalColor.ts:31-57` | Two stores with two key schemes (`board_appearance` by JSON triple, `board_colors` by `connection:native`), bridged by `color_key`. #1315 replaces both with agent and place records. |
| Derive | `web/src/world/BoardView.tsx:3408-3424` | Board resolves colours itself (`withInheritedColors`, `resolveTerminalByKeys`) instead of the shared snapshot Town and Spaces read (`web/src/world/useTerminalColors.ts`). |
| Derive | `web/src/world/BoardView.tsx:3441-3471` | Board builds the colour write's target and witness from `tab.panes`; the shared picker builds it from the runtime store. Both then call `world.appearance.patch`. |
| Derive | `server/src/features/apartments/service.ts:126-196` | Apartments reads `layout.colors` directly, skipping the hide rule, and repeats Town's look rule (the code comment says so). |
| Derive | `web/src/world/town/townAppearance.ts:6-43`, `web/src/world/apartments/residentLook.ts:44` | Two more look rules; Town adds its own fallback. |
| Presentation | `web/src/world/board/boardAppearance.ts` (`herdr-world.board.appearance`) | Board's status palette differs from Town's. A palette is a per-view theme, not a World fact; it may stay, but the status it colours must be World's. |

## Grouping

| Kind | Where | What |
|---|---|---|
| Derive | `web/src/world/town/townBuildings.ts:30,185,235-275` | Town groups runtimes with its own code (`runtimeGroupKey`, its own de-duplication and tags) instead of `worldHostGroups`/`hostGroupOf` (`web/src/worldHosts.ts:237-271`) that Desk, the navigator and Board use. |
| Copy | `web/src/world/town/townBuildings.ts:53-63` | `?townBuildings=` in the page address overrides the shared `ui.runtimeGrouping` setting. |
| Derive | `web/src/world/HostsControl.tsx:76` | The hosts control always groups by machine, whatever the setting says. |

## Room, placement and order

| Kind | Where | What |
|---|---|---|
| Around | `web/src/world/town/townMoves.ts:141,285`, `web/src/world/BoardView.tsx:275`, `web/src/world/board/boardPaneMove.ts:75` | Desk and pane moves use runtime-tier `town.move_desk` and `town.move_pane`; only core uses `world.core.move`. |
| Around | `web/src/world/herdrOrder.ts:77-183`, `web/src/store.ts:1381-1410` | Reordering lists rooms and tabs itself, edits Spaces' copy, then calls `tab.move` and `workspace.move` directly. Used by Town and Board. |
| Derive | `web/src/world/board/useBoardHerdrActions.tsx:296` | Board decides Town's room order (`room.place`); the write goes through `world.board.patch`, but the rule lives in Board. |
| Copy | `web/src/agentOrder.ts:4,76` | Agent order and list preferences in localStorage (`agentOrder.v1`, `agentListPreferences.v1`). |
| Derive | `web/src/agentOrder.ts`, `web/src/world/board/boardModel.ts:113`, `web/src/world/town/officeDesks.ts:87`, `web/src/world/herdrOfficeProjection.ts:926`, `web/src/world/town/officeRoom.ts:215`, `web/src/world/treeProjection.ts:248`, `web/src/world/worldSwitchTargets.ts:12` | Seven status-rank tables that disagree. |

## Pins

| Kind | Where | What |
|---|---|---|
| Copy | `web/src/tabPins.ts:6` (`tabPins.v1`) | Spaces tab pins in localStorage, read by the tab bar, mobile sheet, close guards and Bin. |
| Copy | `web/src/workspacePins.ts:9` (`workspacePins.v1`) | Room pins in localStorage. |
| Derive | `web/src/App.tsx:1929,4236` | The phone uses World desk pins, the tab bar uses localStorage pins: one tab, two pinned facts. |
| Copy | `web/src/world/BoardView.tsx:636,1141-1160,3487-3528` | Board card pins are a third set (`layout.pinned`), saved whole with `layout.set replace:true`. |
| Around | `web/src/world/BoardView.tsx:1126-1138` | A browser effect copies core favourites into Board pins: the browser reconciles the store. |
| Derive | `web/src/world/bin/WorldBin.tsx:32-44` | The Bin keep rule mixes World desk pins with localStorage tab pins. |

The single-model plan already decided the target: one pin, following the runtime's
native pin where it has one.

## Status, attention and counts

| Kind | Where | What |
|---|---|---|
| Derive | `web/src/components/agentSession.ts:33` | Spaces maps unknown values (such as `error`) to `unknown`; World's `status()` (`web/src/world/worldObject.ts`) maps them to `blocked`. |
| Derive | `web/src/store/notifications.ts:158-172` | Notifications use the raw runtime status. |
| Derive | `web/src/world/board/boardRoom.ts:44`, `web/src/world/town/officeAgent.ts:40` | A stale agent is `unknown` on Board and keeps its status with a flag in Town. |
| Derive | `web/src/world/DeskView.tsx:90-135`, `web/src/world/board/boardAttention.ts:18`, `web/src/world/DeskOtherHosts.tsx:75`, `web/src/world/herdrOfficeProjection.ts:464`, `web/src/world/town/townAskers.ts:17` | Five definitions of "needs you" beside the shared `needsYouItems` (`web/src/world/needsYou.ts`). |
| Derive | `web/src/world/town/officeReadModel.ts:76`, `web/src/world/board/boardRoom.ts:50`, `web/src/world/DeskOtherHosts.tsx:65` | Three count rules beside World's own counts. |

## Interest and groups

| Kind | Where | What |
|---|---|---|
| Derive | `web/src/world/useAgentInterest.ts:95-140` | Effective interest is derived only in the browser; the service stores interest but never derives it, so notifications from the service cannot honour it. |
| Derive | `web/src/store/notifications.ts:305-331` | The chime follows interest; the toast and system notification do not. |
| Derive | `web/src/world/relations.ts:152-251` | Relations are derived in the browser with a separate deriver in Town, Board and colours; the service derives them again (`server/src/features/apartments/service.ts:132`, `server/src/world/group-move.ts:134`). |
| Derive | `web/src/world/town/townTeams.ts:211-240`, `web/src/world/groups/useGroups.ts:21` | Town merges desks into teams itself; group observations are recomputed per site. |

## Profile and Town Master

| Kind | Where | What |
|---|---|---|
| Derive | `web/src/world/agentProfiles.ts:337`, `web/src/world/profileLink.ts:18`, `web/src/world/apartments/residentLook.ts:44` | Three lookups from a terminal to its profile. |
| Derive | `web/src/world/SoundsDialog.tsx:75`, `web/src/world/town/useTownMaster.ts:6-31` | Two lookups of the Town Master's terminal. |
| Around | `web/src/world/town/legacyTownMaster.ts:22-98` | The browser migrates a legacy localStorage name by matching agent names, then calls `world.town_master.set`: the browser decides which terminal. |

## Creation and launch

| Kind | Where | What |
|---|---|---|
| Around | `web/src/world/agentProfiles.ts:247-286` | Herdr launches use runtime-tier `launcher.start`; core uses `world.core.launch`. |
| Derive | `web/src/world/AgentLauncherDialog.tsx:292` | The launcher dialog decides the core route a second time. |
| Around | `web/src/world/town/useTownRoomActions.tsx:106,145,178`, `web/src/components/TabBar.tsx:160`, `web/src/components/MobileTabSheet.tsx:80`, `web/src/components/CommandCombobox.tsx:591,770,784`, `web/src/components/CreateWorkspaceDialog.tsx:81` | Rooms and tabs created with runtime-tier `workspace.create` and `tab.create`. |

## Git, PRs and usage

| Kind | Where | What |
|---|---|---|
| Copy | `web/src/pullRequestCache.ts:9` (`pullRequestSummaries:v1`) | PR summaries cached in the browser. |
| Derive | `web/src/components/TabBar.tsx:211-216` | The tab bar counts changed files itself. |
| Derive | `web/src/world/town/townPlaceUsage.ts:198` vs `web/src/world/usage/usageStore.ts:60` | Town reads usage through its own cache; other screens through analytics. |

## Already on the World path

Writes that already go through World verbs: `world.board.patch` (desk pins, rank,
placement, card colour, interest, groups), `world.appearance.patch` and `.rename`,
`world.core.*`, `world.profiles.*`, `world.town_master.set`, `world.chimes.save`,
`world.bin.*`, `world.ask.answer` and `.dismiss`, `world.watchlist.*`,
`world.desk.*`, and the runtime-grouping setting. They still lack two things this
design adds: a pending state shared by every view in the browser, and history with
undo for browser changes (only CLI Board changes have undo today).
