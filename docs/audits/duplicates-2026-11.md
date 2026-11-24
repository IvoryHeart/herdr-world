# What World has built twice — November 2026

Audit for [issue #1357](https://github.com/IvoryHeart/herdr-world/issues/1357),
read against `4b21098c6` on 2026-11-24. No product changes are made here.

The first thing to keep is the existing owner, not the newest surface. World
already has one entity search, qualified entity actions, a Settings registry,
an attention list, conversation reads and service stores. New surfaces often
reuse part of those and then independently rebuild matching, admission,
presentation or refresh behavior around them. Those seams are where copies grow.

## Evidence and boundaries

- Read current capability specs/notes, active changes and the implementations
  below, including the server and browser sides. Checked all eight requested
  areas: search/filter, menus, per-view data, settings, attention/notifications,
  terminal opening, previews/help, stores/clients.
- Cross-checked [#1341's `world-one-object/audit.md`][prior-audit] on
  `crew/1321`, pinned at `8ab2ed5ae17f3cffc85de90323a055c8e1267ce7`.
  Its detailed per-view fact inventory remains there. D03, D06 and D11 add
  history and next steps; they do not duplicate that file's tables.
- Cross-checked the last [knowledge map before removal][old-map].
  [PR #1210][p1210] removed it on November 22 in favour of OpenSpec notes.
  The requested [knowledge-map additions](../knowledge-map.md) therefore
  recreate a focused mechanism index pointing to those notes, rather than
  restoring the old feature catalogue.
- Used `git log --follow --diff-filter=A` for file lineage, symbol history
  where a later extraction could obscure it, and GitHub's commit-to-PR
  association. Dates below are introducing commit dates, which can precede
  merge. PR numbers are World PRs; an upstream issue number preserved in a
  commit subject is not assumed to be a World PR. Foundation lineage is
  called out explicitly, not presented as a new November implementation.
- An exact-clone check of production `server/src`, `web/src` and `shared`
  (16 lines / 120 tokens, repository exclusions) found 13 pairs; each was
  inspected. It corroborates mechanisms below, but does not detect semantic
  duplication such as the different agent-name fallbacks. This is a source
  audit, not runtime/browser acceptance evidence or a proof of no other clones.

“Keep” is the recommended owner. “First merge” is one bounded follow-up, not
an instruction to implement all migrations in one PR. Existing in-flight plans
remain the authority for contracts. No follow-up issues were filed.

## Order of work

Confusion ranks first: **High** changes what the user finds, opens or believes;
**Medium** makes controls or recovery differ; **Low** is mostly maintenance.
Within a band, cheaper first. **S** is a local extraction/reroute; **M** touches
several consumers or lifecycle evidence; **L** needs an existing ownership or
storage migration. The cost describes the consolidation; each first merge is
deliberately smaller. D06's per-fact steps are separately itemizable.

| Rank | Entry | Confusion | Cost |
| --- | --- | --- | --- |
| 1 | [D01: two World find hosts](#d01--two-world-find-hosts) | High | M |
| 2 | [D02: independently assembled matches](#d02--matching-is-shared-only-partly) | High | M |
| 3 | [D03: attention lists/counts](#d03--needs-you-and-the-other-attention-lists) | High | M |
| 4 | [D04: terminal target/open decisions](#d04--terminal-opening-decisions) | High | M |
| 5 | [D05: notification event detection](#d05--task-completion-detected-in-the-service-and-browser) | High | M |
| 6 | [D06: World facts derived or stored per view](#d06--world-facts-rebuilt-in-views) | High | L |
| 7 | [D07: notification target/click helpers](#d07--notification-target-validation-and-click-activation) | Medium | S |
| 8 | [D08: popup mechanics](#d08--menu-keyboard-focus-and-placement-mechanics) | Medium | S |
| 9 | [D09: action inventories](#d09--actions-relisted-in-menus-boxes-and-rings) | Medium | M |
| 10 | [D10: agent peeks](#d10--agent-peek-wrappers) | Medium | M |
| 11 | [D11: Town usage cache](#d11--towns-second-usage-cache) | Medium | M |
| 12 | [D12: connection forms](#d12--connection-profile-forms) | Medium | M |
| 13 | [D13: replica lifecycle](#d13--browser-replica-lifecycle-reimplemented-per-feature) | Medium | M |
| 14 | [D14: two reconnect transitions](#d14--reconnect-handling-twice-in-one-store) | Medium | M |
| 15 | [D15: retained file stores and SQLite](#d15--legacy-file-store-and-sqlite-paths) | Medium | L |
| 16 | [D16: Board wire definitions](#d16--board-contract-declared-on-both-sides) | Low | S |
| 17 | [D17: ask wire definitions](#d17--question-contract-and-closure-declared-on-both-sides) | Low | S |
| 18 | [D18: HTTP response helpers](#d18--http-settings-response-boilerplate) | Low | S |
| 19 | [D19: Town pixel painter](#d19--town-pixel-painter) | Low | S |
| 20 | [D20: process runners](#d20--process-timeout-and-output-lifecycle) | Low | M |
| 21 | [D21: binary frame buffering](#d21--binary-client-framing) | Low | M |
| 22 | [D22: Town projection traversal](#d22--town-projection-container-traversal) | Low | M |

## Findings

### D01 — Two World find hosts

**Exists:** `web/src/world/town/useTownSearch.ts` and
`web/src/world/board/useBoardSearch.ts` own view query, active row, Escape and
selection state for `/`; `web/src/components/CommandCombobox.tsx` plus
`web/src/world/worldCommandBox.tsx` own another query/results/activation surface
for Cmd+K. Desk has its own query in `web/src/world/DeskView.tsx`.
Town's first choice shows a map result and its second opens it; Cmd+K Enter
opens Spaces and Shift+Enter shows the result in the view. Those are two
interaction contracts over largely the same entities.

**Added:** inherited command menu, 2026-09-24 `b08731840` ([#93][p93]);
Town/Board result hosts, November 8 `7cd6aa17f` / `5b9d94ff4` ([#778][p778],
issue #159); World Cmd+K extension, November 8 `ea08d0a3e` ([#792][p792],
issue #782); all-runtime Enter behavior, November 24 `5edf6ad3f` ([#1330][p1330],
issue #1329). Desk dates to October 3 `aabd53dac` ([#154][p154]).

**Keep:** `worldSearch.ts` as entity provider, the existing shell command box
as the common Find or act entrance, with explicit show-in-view actions.
#1330 already calls `worldSearchResults`; a second entity matcher in Cmd+K is
not a current finding.

**First merge:** route `/` outside editors/terminals through the existing
`openCommandBox` entrance and align the entrance labels. Preserve the view
show/highlight adapter; consolidate its query ownership next, rather than
removing spatial reveal while changing shortcuts.

### D02 — Matching is shared only partly

**Exists:** `worldSearch.ts` builds entity search text/ranks;
`world/deskAgentLabels.ts:matchesQuery` assembles another haystack, adding
report/question/folder but omitting some World traits;
`world/board/boardSearch.ts:boardSearchMatches` rematches whole cards while
`useBoardSearch.ts` independently gets World result rows. Words can match
different panes of a card without producing a matching leaf row.
`world/town/townSearch.ts` adds Warehouse landmarks to Town's results only.
All paths here are under `web/src/`.

**Added:** Desk helper extraction October 28 `b369194c3` ([#473][p473]; Desk's
search predates it in #154); World/Board matching November 8 `7cd6aa17f` /
`11f3161a5` ([#778][p778]); Town landmark results added November 20
`ff70e6733` ([#1113][p1113], issue #1033), later adapted as the post office
became the Warehouse.

**Keep:** `worldSearch.ts` for entity text/results, with explicitly named
additional document/landmark fields, rather than another agent matcher.

**First merge:** make Desk's entity portion use `worldNodeSearchText`, retaining
its additional report/question text. Check the same runtime/harness/status
queries through Desk and Cmd+K. Then make Board highlights project result IDs,
and expose the existing landmark provider to the common find host separately.

### D03 — Needs you and the other attention lists

**Exists:** the complete copy list is [#1341: Status, attention and counts][prior-status].
It includes Desk, Board, Town and host summaries beside
`web/src/world/needsYou.ts:needsYouItems`. Additionally,
`web/src/world/NeedsYouTab.tsx:useWaitingCount` computes asks plus live blocked
leaves independently of `needsYouCount(needsYouItems(...))`.

**Added:** Desk October 3 ([#154][p154]); Board attention October 29
`98b166246` ([#507][p507], issue #222); shared Needs you and counter November 1
`4bc272824` ([#621][p621], rebuilding issue #514). These were additions beside
the earlier lists, not a completed migration of them.

**Keep:** `needsYouItems` / `needsYouCount`, the shared reviewed record
(`deskStateStore.ts`, `useReviewedWork.ts`) and `agentMarks.ts` for presentation;
eventually derive attention once in service-owned World as #1341 requires.
Durable asks and a harness's blocking prompt are distinct inputs, not two
question stores to collapse by matching their text.

**First merge:** make the topbar counter consume the same attention derivation
as its open list, retaining its existing rule excluding finished work. Cover
ask+blocked, reviewed and stale-host cases, then migrate one other consumer
per crew item through World.

### D04 — Terminal opening decisions

**Exists:** `web/src/world/worldCommandBox.tsx:openWorldFind` /
`coreSpacesLeaf` resolve a found room's terminal; `world/town/townOpen.ts`
chooses which pane a desk opens; `world/worldInspectorSelection.ts` and
`world/useWorldInspectorController.ts` resolve selection into an
Inspector/terminal; `world/useWorldCreatedTerminal.ts`
admits creation results. `world/SpacesCoreTerminal.tsx` presents a core terminal
in Spaces while `world/worldTerminalPresentation.ts` manages visual windows.
Different presentation destinations are valid; repeated target/capability and
fallback selection are the overlap.

**Added:** visual route actions September 25 `ae694d3b6` ([#108][p108]);
coordination/creation hook split October 8 `fc37f5dc0` ([#184][p184]); current
Town opening helper October 24 `896fdf0e5` ([#334][p334]), with desk-pane
choice added November 19 `46155de98` ([#1007][p1007]); core watch/shell
November 17 ([#933][p933]); find-to-Spaces/core presentation November 24
([#1330][p1330]).

**Keep:** qualified `worldInspectorSelection.ts` / `visualRouteActions.ts`
admission plus the existing Inspector controller, `worldTerminalPresentation.ts`
and portal ownership path. Reuse
`openWorldFind` for search activation, not a new terminal-opening client.

**First merge:** share qualified target construction between
`worldFoundTarget` and `worldInspectorSelection.ts:workspaceTarget` /
`focusWorldNode`, retaining their admission checks. Keep destination
(Spaces/window) and desk-pane choice as explicit intents; test room/leaf,
stale generation and retired target. The navigator already reuses
`coreSpacesLeaf`; do not build a third core-room resolver.
The separate floating-shell facade `world/floatShell.ts` already dispatches
TUI Float versus core World shell; keep those runtime implementations.

### D05 — Task completion detected in the service and browser

**Exists:** `server/src/notifications/task-events.ts:createTaskEventTracker`
and `web/src/store/notifications.ts:TaskCompletionTracker` both remember
working→idle/done/blocked transitions. The service can instead select Herdr
semantic notifications through `server/src/notifications/herdr-notification-listener.ts`.
The browser suppresses its completion fallback when semantic relay is active;
these are competing/fallback detectors, not evidence that every event double-toasts.

**Added:** status event tracker September 24 `c7156c58a` ([#97][p97]); browser
tracker lineage predates the foundation (August 19 `cd073c649`, imported by
[#93][p93]; its “#18” is an upstream number), extracted October 23
`778af67e8` ([#334][p334]); semantic
listener September 25 `35d86b828`, imported by World [#103][p103] (its subject's
“#267” belongs to upstream history).

**Keep:** service-selected notification events; Herdr semantic policy where
supported, service `task-events.ts` as status fallback. Browser should present
events, not infer a second completion history. Chimes and Focus remain policy
consumers, as [#1341's interest finding][prior-interest] describes.

**First merge:** for connections advertising service task events, stop feeding
the browser completion tracker and consume the qualified event path. Preserve
legacy fallback until a separate compatibility decision removes it; check
initial seeding, reconnect and suppression, not just a toast's text.

### D06 — World facts rebuilt in views

**Exists:** [#1341's root inventory][prior-audit] identifies
`web/src/world/runtimeStore.ts` / `worldObject.ts`, Spaces' separate
`web/src/store/refresh.ts`, and service derivations for Apartments/CLI/moves.
The fact-level file lists are linked below rather than copied. This is the
highest-cost root of several higher-ranked user problems.

**Added:** aggregate/browser model foundation imported September 24
`b08731840` ([#93][p93]); focused refresh extraction October 23
`778af67e8` ([#334][p334]); Apartments service November 20 `7fedac034`
([#1034][p1034]). The following supplies provenance and bounded work for
the existing fact findings, not a replacement audit.

| Existing finding and copy lineage | Keep / smallest next merge |
| --- | --- |
| [Names and desk labels][prior-name]: foundation/Spaces #93; Town October 17 #208; Desk helper October 28 #473; Board room actions November 8 #794; Apartments November 20 #1034 | World's resolved identity/name via `worldObject.ts` today, service World in #1341. Move one resolved agent-label field and all its view/CLI consumers together; use #1341's cross-view check. |
| [Colour and look][prior-colour]: terminal palette/colour snapshot October 22 `057c57f9d` / `5fef10eeb` (#255); captured appearance October 29 `22446e688` (#492); Apartments November 20 #1034 | Existing appearance command/snapshot (`shared/appearance.ts`, `useTerminalColors.ts`), followed by #1315's agent/place records. First retire Board's independent colour resolution in favour of that snapshot across affected surfaces. |
| [Grouping][prior-grouping]: independent Town building projection November 22 `2c68797df` (#1213); shared runtime grouping November 23 `62b1c8356` (#1316) | `worldHosts.ts:worldHostGroups` / `hostGroupOf` with the service's runtime-grouping setting. First replace Town's remaining local grouping assembly. #1316's checked task is not proof that every old derivation disappeared. Hosts' machine-only selection is an intentional filter contract, not another operational connection selector. |
| [Pins][prior-pins] and [order/status ranks][prior-order]: workspace/agent browser preferences #93; tab pins October 8 `07332d4c8` (#182); Board document October 18 #215; Town desk pins and later core native pins coexist | `useDeskPins.ts` / `corePins.ts` plus runtime-native order, under `world-single-model` tasks 2.2. First migrate one native-aware tab-pin identity through World for all readers/writers, preserving old data until verified; do not merge canvas coordinates into logical pin semantics. |
| [Status/attention/counts][prior-status]: original World/Spaces #93, Desk #154, Town #208, Board #507, Needs you #621 | World-derived status and attention; `agentMarks.ts` displays it. First move the stale/status mapping onto World and remove both Board/Town overrides in that same cross-view step. D03 owns the list/counter seam. |
| [Relations and interest][prior-interest]: relations/Town teams October 22 `af29af095` (#281); interest October 23 `8f86b5d77` (#305); Apartments #1034 repeats service derivation | `shared/groupViews.ts` / `shared/groupInterest.ts` and the existing group commands. First derive effective interest once in service World and make browser/service notification policy consume it together. |
| [Profiles/master][prior-profile] and [creation][prior-creation]: profiles October 22 `e724bd780` (#273); runtime creation #93; core launch #933; master migration November 22 `aafccf419` (#1140) | `server/src/agent/profile-service.ts`, shared assignments/master and World launch commands, per #1341/#1315. First route one Herdr creation verb through the existing World command boundary, changing every entry point for that verb together. Browser-name migration is not the future role owner. |

**Keep overall:** service observation in `server/src/world/snapshot.ts`, with
the service-owned World object and browser replica described in
[#1341's design][prior-design], not another view store. Preserve immutable
connection IDs, runtime generations and stale/non-actionable evidence.

**First merge overall:** adopt one fact row above as a complete cross-view
step from #1341's tasks. Do not start a generic rewrite or declare #1341's
planned object already implemented. Git/PR/usage copies remain in D11 and
the [existing git/usage finding][prior-git].

### D07 — Notification target validation and click activation

**Exists:** `web/src/store/notifications.ts` and
`web/src/taskNotifications.ts` each define `isTaskNotificationTarget`,
`bindTaskNotificationActivation` and the activation event spelling.
The latter rejects arrays and discriminated non-pane targets; the focused
store's validator lacks those two checks. This is an actual drift example.

**Added:** shared validator lineage September 17 `84524ccc6`, imported with
[#103][p103]; current browser module lineage also includes September 24
`c7156c58a` ([#97][p97]). Store copy extracted October 23 `778af67e8`
([#334][p334]) from the foundation store.

**Keep:** `taskNotifications.ts`'s stricter validator and generic activation
helper. **First merge:** import/re-export those from the store, remove the
local copies, and exercise array/Ranger/pane inputs plus the existing click path.

### D08 — Menu keyboard, focus and placement mechanics

**Exists:** `web/src/components/ActionsMenu.tsx` supplies enabled-item
arrows/Home/End, Tab close, focus, layer and clamped position.
`FileExplorerDialog.tsx:FileExplorerEntryMenu` repeats the keyboard loop;
`ContextMenu.tsx` and `WorkspaceAgentRows.tsx` repeat scroll-close/position
lifecycle. `world/town/TownCenterMenu.tsx` and `world/board/BoardHub.tsx`
also own menus, but the radial geometry is a real presentation difference.

**Added:** linear menu families imported September 24 ([#93][p93]); Town
ring November 7 `d2cc23da7` ([#689][p689]); Board hub November 7 `b656f799d`
([#698][p698]).

**Keep:** `ActionsMenu.tsx` for linear action lists, `layerStack.ts` for
dismissal/focus and `contextMenuPosition.ts` for placement. Keep ring layout
in Town; it already uses the same layer stack.

**First merge:** render `FileExplorerEntryMenu` through `ActionsMenu`, retaining
its file actions; verify disabled rows, keyboard movement, scroll and Back.
Convert the workspace/agent menu shells in separate items.

### D09 — Actions relisted in menus, boxes and rings

**Exists:** action lists in `components/CommandCombobox.tsx`,
`components/ContextMenu.tsx`, `components/WorkspaceAgentRows.tsx`,
`world/useWorldVisualActions.tsx`,
`world/town/useTownRoomActions.tsx` and `world/board/useBoardHerdrActions.tsx`
all expose overlapping create/rename/close/resource operations. App errands
also appear in `settings/ShortMenu.tsx`, `world/town/useTownCenter.ts` and
`world/board/BoardHub.tsx`. Paths are under `web/src/`.

**Added:** inherited commands/context menu #93; qualified visual actions
September 25 #108 (hook split #184); Town actions split October 31
`60f01bd3d` ([#596][p596]); ring/hub November 7 #689/#698; Board mutation list
November 8 `33029677f` ([#794][p794]); Settings command publication November 20 #1062.

**Keep:** `visualRouteActions.ts` for qualified resource actions,
`settings/commandBoxRegistry.ts` for publishing existing operational commands,
and the already shared `useTownCenter.ts` helpers for errands. There is no
single complete mutation catalogue today; do not give the selected Spaces
command box authority over a different view's entity.

**First merge:** make the agent menu's existing Files/Changes/History group in
`WorkspaceAgentRows.tsx` use `visualRouteActionsForNode`, capturing its explicit
entity. Keep callbacks qualified. Mutation commands follow D06's
World write-path migration; menu rendering alone cannot fix their ownership.

### D10 — Agent peek wrappers

**Exists:** `web/src/world/town/TownPeek.tsx` and
`web/src/world/board/BoardPeek.tsx` repeat anchoring, scroll-follow, question,
answer and review controls. Town receives prepared data; Board assembles it
with hooks. Both already reuse `AgentHoverCard.tsx:AgentLatestMessage`,
`shownReport.ts`, conversation reads and review state; there are not two
independent transcript parsers here.

**Added:** Town peek October 17 ([#208][p208]); shared conversation watch
October 22 `4e5020237` ([#260][p260]); shared message/read/review seam November 1
`4bc272824` / `8a79c1bb3` ([#621][p621]); Board peek November 8 ([#794][p794]).

**Keep:** `AgentLatestMessage`, `useShownReport` and `conversationWatch.ts`,
with one common quick-answer/review body. **First merge:** extract Board's
quick-answer/review body around those hooks and use it in Town's wrapper too;
keep portrait, canvas anchor and Town-only context/usage controls as adapters.
Check a failed report refresh cannot review a previous stop.

### D11 — Town's second usage cache

**Exists:** [#1341: Git, PRs and usage][prior-git] names
`web/src/world/town/townPlaceUsage.ts` beside
`web/src/world/usage/usageStore.ts`. The former has a separate per-window
cache and today projection; the latter shares analytics reads by grouping/window.
The same finding also owns the browser PR cache and tab-bar changed-file count.

**Added:** Town cache November 7 `fbec48a93` ([#684][p684]); common analytics
store November 21 `44df9c465` ([#1060][p1060]).

**Keep:** service `server/src/usage/analytics.ts` and its browser
`usageStore.ts`; keep Town's place/economy projection, not another freshness
clock. **First merge:** feed one Town room/table usage card from the existing
analytics store for the same grouping/window, retaining its pricing rules.
Then remove Town's redundant request/cache lifecycle once all its consumers
have moved. Git facts keep `workspace/status.ts` / `workspace/pull-request.ts`
on the service, following #1341 rather than introducing another browser cache.

### D12 — Connection profile forms

**Exists:** `web/src/components/LocalProfileForm.tsx` and `SshProfileForm.tsx`
repeat identity/runtime fields, feedback and save UI. They have different
transport fields and probe flows; neither is the service's validation owner.

**Added:** Local form November 17 ([#933][p933]); current SSH form lineage
November 21 `944add9c8` ([#1123][p1123]).

**Keep:** `server/src/connections/profile-validation.ts` and
`host-service.ts` for policy; `web/src/connectionProfiles.ts` for browser API.
Use Local form's common field/feedback fragment as the extraction seed.
**First merge:** share only that fragment between both forms, with transport
inputs passed in; retain SSH-specific probe/admission and OpenSSH policy.

### D13 — Browser replica lifecycle reimplemented per feature

**Exists:** `web/src/world/board/boardDocument.ts:BoardDocumentStore`,
`deskStateStore.ts:WorldDeskStore`, `worldAsks.ts:WorldAsksStore`,
`apartments/apartmentsStore.ts:WorldApartmentsStore` and
`bin/binStore.ts:WorldBinStore` repeat listener sets, refcounts, control
invalidation, reconnect reads and stale-read guards. Apartments/Bin have an
exact shared lifecycle block; revision/epoch/error rules vary across the others.
These replicas and their service stores are legitimate layers, but copied
lifecycle rules make one feature recover differently from another.

**Added:** Board browser document October 18 ([#215][p215]); Desk October 28
([#473][p473]); asks October 22 ([#283][p283]); Bin November 6 `a9bc248d3`
([#685][p685]); Apartments November 20 ([#1034][p1034]).

**Keep:** each existing feature singleton until #1341's one replica arrives;
use Apartments' counted subscription/epoch lifecycle as the shared helper seed.
Do not create another persistent store or one universal feature schema.
**First merge:** extract that identical lifecycle into one helper for Apartments
and Bin only, retaining their parsers and domain state; check two subscribers,
disconnect, late reply and last unsubscribe. Fold it into the future World
replica instead of building a parallel state framework.

### D14 — Reconnect handling twice in one store

**Exists:** `web/src/store.ts:handleBridgeStatus` and the inline `onStatus`
callback in `store.init` repeat recovery intent, status publication, polling,
catalogue refresh and terminal reattach. Their disconnection cleanup differs.

**Added:** store foundation September 24 ([#93][p93]); named handler introduced
October 2 `b0f6a9a0c` (commit “Fix tab reordering compatibility and review paths
for 0.7.15”), imported with upstream sync October 8 ([#182][p182]).

**Keep:** one `handleBridgeStatus` transition, with the stronger combined
cleanup. **First merge:** make `store.init` call the existing handler and move
its missing retirement/attachment cleanup into it; check that one disconnect
retires observations and one reconnect rearms them exactly once. This is a
browser connection lifecycle merge, not permission to bypass World for facts.

### D15 — Legacy file-store and SQLite paths

**Exists:** `server/src/world/board-store.ts` and `world-ledger.ts` retain
file-store implementations; `server/src/storage/board-port.ts`,
`world-board.ts` and `world-storage.ts` provide durable SQLite paths.
`storage/board-import.ts` and `world-import.ts` retain legacy import behavior.
The production service resolves Board through `storage.board()`; file-backed
classes and retained inputs are not evidence of two simultaneous normal writers.

**Added:** Board file store October 18 `d7ad606b4` ([#215][p215]); ledger
October 22 `378c60128` ([#283][p283]); Board SQLite port October 31
`8746aa883` ([#608][p608]); ledger SQLite October 30 `9db954488`
([#559][p559]); checked storage inventory November 22 ([#1260][p1260]).

**Keep:** `server/src/storage/world-storage.ts` and its SQLite ports/catalog.
`world-single-model/tasks.md` 2.1 already owns retiring repeated legacy imports.
Board already imports only when its SQLite document is absent and records a
completion marker. The ledger still re-imports when the file hash changes.
**First merge:** take the ledger slice of that existing plan: reuse its
`ledger-json` completion marker to stop automatic hash-change re-import after
successful migration, retain the original file and compare semantic fixtures
across restart. Do not delete user data, import readers or test-only file-store
support merely to reduce the count of classes.

### D16 — Board contract declared on both sides

**Exists:** `server/src/world/board-types.ts` (re-exported by `board-store.ts`)
and `web/src/world/board/boardDocument.ts` both declare Board document/layout,
point, note, anchor and operation shapes. Parts are exact clones; the browser
also models input-only `observed` witness data, which must not become a stored
server field accidentally.

**Added:** browser definitions October 18 `5c045b94e`, server definitions in
the original Board store October 18 `d7ad606b4` ([#215][p215]); server type
extraction October 31 ([#608][p608]).

**Keep:** service `board-types.ts` as the public-contract extraction seed,
following the existing shared `boardElements.ts` / `boardShapes.ts` pattern.
**First merge:** move just the public document/operation DTO subset to a shared
module and import it on both sides. Keep server edit metadata and browser input
witnesses as explicit separate types; runtime validation stays on the service.

### D17 — Question contract and closure declared on both sides

**Exists:** `server/src/world/world-ledger.ts:LedgerAsk` and
`web/src/world/worldAsks.ts:WorldAsk` repeat actor, question, closure and
delivery shapes plus `askClosed`. The browser adds peer/home presentation
fields. Separate authorization and rendering remain necessary; the repeated
public lifecycle shape/predicate is the overlap.

**Added:** both October 22 `378c60128` ([#283][p283]); current peer overlays
November 21 `448613679` ([#1168][p1168]).

**Keep:** service `LedgerAsk` / `askClosed` as the shared public projection
seed. **First merge:** extract the closure projection and pure predicate,
import it in both places and leave recipient/outbox authority service-only.
Check answered, dismissed and withdrawn projections; do not reuse a browser
“open” flag to authorize a send.

### D18 — HTTP settings response boilerplate

**Exists:** `server/src/sources/http.ts` and
`server/src/world/observability-http.ts` duplicate `methodNotAllowed`,
`jsonError`, `jsonResponse` (including `no-store`) and `errorMessage`.
Their request bodies and feature validation differ.

**Added:** observability handler foundation September 24 ([#93][p93]);
Sources handler October 22 `8373e6186` ([#267][p267]).

**Keep:** Sources' tiny response helpers as the extraction seed.
**First merge:** share only the response helpers and reuse them in observability,
preserving each handler's auth, bounds and allowed-field validation. Avoid a
generic settings API that changes either feature's contract.

### D19 — Town pixel painter

**Exists:** `web/src/world/town/townPostPaint.ts:painter` and
`townLibraryPaint.ts:painter` duplicate canvas creation and rounded
rectangle/disc drawing. Their building art and caches differ.

**Added:** Post painter November 8 `ee7fd61ee` ([#763][p763]); Library
November 20 `6e56b3dab` ([#1082][p1082]).

**Keep:** existing `townSprites.ts:townCanvas` seam, seeded with Post's shared primitives.
**First merge:** extract `painter` once, consume it from those two art files and
compare their existing visual fixtures. Keep individual buildings and caches.

### D20 — Process timeout and output lifecycle

**Exists:** `server/src/utils/process-utils.ts:spawnWithCodeTimeout` and
`server/src/workspace/process.ts:spawnBinaryWithTimeout` /
`spawnWithInputTimeout` repeat spawn, SSH tracking, output collection,
timer clearing and timeout kill/reject. Binary output and piped stdin are
necessary options, not reasons for independent timeout policy.

**Added:** both runner families imported September 24 ([#93][p93]).

**Keep:** `utils/process-utils.ts` for the common execution lifecycle,
`bridge/ssh-sessions.ts` for SSH scheduling. **First merge:** share timeout and
cleanup for the text-with-input runner first, preserving the workspace
environment and broken-pipe handling. Test abort/timeout/output settlement;
bring binary output over separately rather than coercing it to text.

### D21 — Binary client framing

**Exists:** `server/src/bridge/endpoint-client.ts` and `thin-client.ts`
repeat pending-welcome resolution/rejection and buffered length-prefixed frame
decoding with a 32 MiB bound. Their payload tags and handshakes differ.
`herdr-client.ts` speaks NDJSON and `web/src/api.ts` browser WebSockets: neither
is a redundant copy of this binary client.

**Added:** both client families imported September 24 ([#93][p93]).

**Keep:** `bridge/bincode.ts` for framing/encoding and Endpoint client's
bounded read loop as the extraction seed. **First merge:** share only the
incremental frame reader between Endpoint and Thin clients; retain protocol
dispatch/handshake code and test partial header, split payload, oversized
frame and close during callback. Do not merge protocol owners.

### D22 — Town projection container traversal

**Exists:** `web/src/world/town/townFinished.ts:withTownFinished` and
`townOutOfFuel.ts:withTownOutOfFuel` each map changed agents through rooms,
receptions, bar agents and roster using a memoized replacement map, then call
`officeReadModel.ts:withOfficeReadModel`. Their semantic status decisions
belong to D06; the copied traversal is a smaller mechanical duplication.

**Added:** finished projection October 17 `37e4ca4bd` ([#208][p208]); usage-stop
projection November 7 `b648e209e` ([#753][p753]).

**Keep:** the traversal from `withTownFinished` beside `withOfficeReadModel`.
**First merge:** share the container replacement operation for these two
consumers without adding or changing any status rule. Preserve object identity
for unchanged containers. Coordinate with D06 so this extraction disappears
if service-derived attention removes these transforms first.

## Similar surfaces already sharing an owner

These checks prevent the audit from creating new copies while trying to remove
old ones. No separate repair is proposed where the existing owner already wins.

| Surface / lineage | What to keep; smallest action |
| --- | --- |
| Settings versus old Configuration versus view controls: `web/src/components/ConfigMenu.tsx` imported #93; `settings/registry.ts`, `SettingsHome.tsx`, `search.ts`, `commandBoxRegistry.ts`, `ShortMenu.tsx` added November 20 `3c15bff7e` (#1062); live view stores/master reconciliation November 22 #1140 | Registry, home and search already win. `ConfigMenu` is a host, and `settings/pages/*` / `SettingsDialogs.tsx` reuse existing controls; they are not a second configuration home. Follow the [existing settings migration inventory](../../openspec/changes/settings-registry/design.md), not another audit of its rows. Add future controls through `defineSettings`; no merge needed for these entrances. |
| Help, What's new, Settings Help and published pages: `web/src/help/helpEntry.ts`, `entries.ts`, `HelpPanelHost.tsx`, `whatsNew.ts`, `scripts/help-docs.ts`, added November 20 `724c55774` (#1110, issue #1025) | Declarations already win. HelpPanelHost renders help; Settings lists entry points; generated help pages/pictures and release news consume declarations. The OpenSpec feature reference describes contracts, and the tutorial teaches a path: do not collapse those distinct documents into another help registry. No merge needed; edit one declaration when help changes. |
| File previews in Ranger/Inspector: inherited `web/src/components/FilePreviewContent.tsx` and `AgentSessionPreviewDialog.tsx` (#93); shared lazy preview October 30 `cdc9a4f81` (#547) | `LazyFilePreviewContent.tsx` → `FilePreviewContent.tsx` already wins for files. Image/PDF/code/Markdown are format renderers; saved-session preview is transcript history. No new common “preview store” or renderer replacement is justified. Agent peeks are D10. |
| Find/filter domains: `web/src/fileSearch.ts` (#93), `searchText.ts` (September 24 #97), `settings/search.ts` (#1062), World search (#778), shortcut catalogue/cheat sheet | Keep entity search in `worldSearch.ts`, setting/command search in `settings/search.ts`, path matching in `fileSearch.ts` and shortcut definitions in `shortcutCatalog.ts`/`shortcutBindings.ts`. Command ranking already calls `commandMatchScore`; its `commandFilter` is a documented loose fallback. Host selection, attention lenses and document in-file find have different scopes. D01–D02 merge entity surfaces/matching, not every substring helper into one universal search engine. |
| Clients and stores across service/browser: `web/src/api.ts`, `connectionClient.ts`, `useConnectionClient.ts`, service `connections/manager.ts`, `adapters/registry.ts`, runtime clients; feature replicas including `world/memory/memoryClient.ts` | Keep the same-origin browser bridge, qualified connection client, service routing and runtime adapters. Each is a different boundary; feature clients are typed adapters over that bridge. Do not move browser authorization into a replica or collapse TUI/core protocols. Actual duplicate mechanics/contracts are D13–D17 and D21, and raw fact duplication is D06. |

## Turning this into crew items

Use an entry's **First merge** as the mandate, with the named keeper and its
consumer checks as acceptance. Preserve one connection/generation-qualified
World path; a view-only fix is not a completed consolidation. D06 must follow
the existing #1341/#1315/single-model ownership work instead of opening a rival
model. No finding here authorizes deleting saved data or changing a product
contract without its delta and verification assessment.

Every recommended owner/seed is indexed in [the knowledge map](../knowledge-map.md),
including mechanisms that already converged. The old map's release/tooling rows
remain discoverable through capability notes; they were not copied into this
audit. No World service, live runtime, preview or help-picture generation was
needed to produce this document.

[prior-audit]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md
[prior-design]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/design.md
[prior-name]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#name
[prior-colour]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#colour-and-look
[prior-grouping]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#grouping
[prior-order]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#room-placement-and-order
[prior-pins]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#pins
[prior-status]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#status-attention-and-counts
[prior-interest]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#interest-and-groups
[prior-profile]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#profile-and-town-master
[prior-creation]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#creation-and-launch
[prior-git]: https://github.com/IvoryHeart/herdr-world/blob/8ab2ed5ae17f3cffc85de90323a055c8e1267ce7/openspec/changes/world-one-object/audit.md#git-prs-and-usage
[old-map]: https://github.com/IvoryHeart/herdr-world/blob/9251ac6ce8c2e1e11a723d4566167930ede711c0/docs/knowledge-map.md
[p93]: https://github.com/IvoryHeart/herdr-world/pull/93
[p97]: https://github.com/IvoryHeart/herdr-world/pull/97
[p103]: https://github.com/IvoryHeart/herdr-world/pull/103
[p108]: https://github.com/IvoryHeart/herdr-world/pull/108
[p154]: https://github.com/IvoryHeart/herdr-world/pull/154
[p182]: https://github.com/IvoryHeart/herdr-world/pull/182
[p184]: https://github.com/IvoryHeart/herdr-world/pull/184
[p208]: https://github.com/IvoryHeart/herdr-world/pull/208
[p215]: https://github.com/IvoryHeart/herdr-world/pull/215
[p260]: https://github.com/IvoryHeart/herdr-world/pull/260
[p267]: https://github.com/IvoryHeart/herdr-world/pull/267
[p283]: https://github.com/IvoryHeart/herdr-world/pull/283
[p334]: https://github.com/IvoryHeart/herdr-world/pull/334
[p473]: https://github.com/IvoryHeart/herdr-world/pull/473
[p507]: https://github.com/IvoryHeart/herdr-world/pull/507
[p547]: https://github.com/IvoryHeart/herdr-world/pull/547
[p559]: https://github.com/IvoryHeart/herdr-world/pull/559
[p596]: https://github.com/IvoryHeart/herdr-world/pull/596
[p608]: https://github.com/IvoryHeart/herdr-world/pull/608
[p621]: https://github.com/IvoryHeart/herdr-world/pull/621
[p684]: https://github.com/IvoryHeart/herdr-world/pull/684
[p685]: https://github.com/IvoryHeart/herdr-world/pull/685
[p689]: https://github.com/IvoryHeart/herdr-world/pull/689
[p698]: https://github.com/IvoryHeart/herdr-world/pull/698
[p753]: https://github.com/IvoryHeart/herdr-world/pull/753
[p763]: https://github.com/IvoryHeart/herdr-world/pull/763
[p778]: https://github.com/IvoryHeart/herdr-world/pull/778
[p792]: https://github.com/IvoryHeart/herdr-world/pull/792
[p794]: https://github.com/IvoryHeart/herdr-world/pull/794
[p933]: https://github.com/IvoryHeart/herdr-world/pull/933
[p1007]: https://github.com/IvoryHeart/herdr-world/pull/1007
[p1034]: https://github.com/IvoryHeart/herdr-world/pull/1034
[p1060]: https://github.com/IvoryHeart/herdr-world/pull/1060
[p1082]: https://github.com/IvoryHeart/herdr-world/pull/1082
[p1113]: https://github.com/IvoryHeart/herdr-world/pull/1113
[p1123]: https://github.com/IvoryHeart/herdr-world/pull/1123
[p1168]: https://github.com/IvoryHeart/herdr-world/pull/1168
[p1210]: https://github.com/IvoryHeart/herdr-world/pull/1210
[p1260]: https://github.com/IvoryHeart/herdr-world/pull/1260
[p1330]: https://github.com/IvoryHeart/herdr-world/pull/1330
