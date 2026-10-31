# World component routes

Start from the [repository knowledge map](../../../docs/knowledge-map.md) for contracts
and service ownership. This file routes visual and terminal tasks to the small set of
browser owners and focused tests. Search the **symbols** below inside large files;
line numbers and CSS ranges change as components move.

## Application startup and owner questions

The asks read model in [worldAsks.ts](worldAsks.ts) takes an announcement callback
installed by the notification-policy module during application initialization.
It does not import notification policy or the application store. Late callback
configuration also updates an existing shared asks model, preserving quiet backlog loading and one
announcement for each new ask. [Import-order coverage](../storeImportOrder.test.ts)
and the [real Vite entry check](../appStartup.browser.test.ts) exercise fresh
startup; notification-policy tests retain the captured host/runtime/session rules.

## Shared terminal appearance

[TerminalAppearanceEditor](TerminalAppearanceEditor.tsx) is composed into the
Inspector title bar, both native and arranged Spaces headers through
[SpacesTerminalAppearance](SpacesTerminalAppearance.tsx), and the phone's
[appearance button](TerminalAppearanceButton.tsx). Spaces selects the tab's selected
pane, then its focused/first pane. Editor keys include the native tab ID so an
unsaved draft cannot follow a pane into a different tab.
Native tab labels come from Herdr; renaming uses qualified
`world.appearance.rename`, with no saved shadow name. The [appearance adapter](appearance.ts)
projects shared tab status and per-pane avatars into World, then Board, Town,
Desk and Spaces consume those choices independently of runtime status badges.
Town's [look resolver](town/townAppearance.ts) retains a stable per-agent look
between frames and restores the live profile/default on reset.

The shared [schema](../../../shared/appearance.ts) extends the existing Board
document and revision notifications. `layout.colors` remains the only colour
source. Bound records identify immutable connection, entity kind/native ID and
terminal witnesses; they never copy the colour value. The service
[RPC admission](../../../server/src/rpc/appearance.ts) verifies that target on
its captured current runtime before saving a field patch. New browser tab-colour
writes use this admission, including the Board picker; legacy browser colour
operations cannot bypass an established binding. The existing CLI colour command
also binds its current target; Undo compares the bound occupant as well as the
colour, refusing old or replacement-occupant history rather than guessing.
Native name and World metadata
saves report their errors separately.

Complete current [observations](../../../server/src/world/appearance-observation.ts)
bind legacy colours once and learn additional continuing split terminals. They
never rebind conflicting IDs or use offline/partial absence as deletion. Legacy
colours have no reconstructable earlier witness; initial adoption preserves
that existing colour on the currently observed tab. Confirmed moves and positive
compensation evidence carry bindings with their terminals. The bounded in-memory
colour-edit clock also retains each latest explicit value/reset, so close cleanup
cannot erase an edit that precedes it during an in-flight move. It follows
confirmed relocations and is discarded with unowned bindings; the persisted
colour authority remains `layout.colors`. Closed-tab colour and pin cleanup
retries a document conflict with fresh tab/workspace absence checks, up to three
attempts, preserving unrelated edits and refusing reused or retired targets.
Unknown topology
remains unresolved. [Pruning](../../../server/src/world/appearance-prune.ts) removes
a record and its colour alias only when all its terminal witnesses are absent
from a complete current snapshot or a current native list after a close. Its
document revision is captured before the read and compared at write time; newer
edits, unknown observations and live moving terminals are retained. Snapshot
absence is only a candidate: one coalesced background sweep confirms it through
a current native pane list, because fresh snapshots can contain cached topology.
The response never waits for that cleanup. Profile
launches bind their colour to the newly returned terminal, replacing stale
occupants through the same appearance operation. Limits are 2,048 records, 64 terminal witnesses per target,
160 status/name characters and the existing fixed colour/avatar palettes.

[Service identity tests](../../../server/src/rpc/appearance.test.ts),
[persistence/move tests](../../../server/src/world/appearance.test.ts),
[browser consumers](appearance.test.ts) and the
[two-profile Chrome test](../../../server/src/world/appearance.browser.test.ts)
cover admission, two clients, native rename failures and independent resets.
The Chrome fixture uses the actual service handler/document store with synthetic
Herdr responses and a test event stream; existing bridge/transport consumers
retain responsibility for WebSocket and live Herdr behavior.

## Focused acquisition and Inspector interest

[Focused interest](../store/focusedInterest.ts) declares the visible active host
and one reference per Inspector window through `store.holdFocusedOwner`.
[useFocusedInspectorInterest](useFocusedInspectorInterest.ts) tracks window
identity across filter/focus changes and releases on close. Each admitted window
re-lists its owner after admission, including a preview of an already-closed tab;
the controller's existing fresh-list evidence removes that window.
[Controls](../store/controls.ts) qualify focused notices before scheduling a
re-list. [Catalogue acquisition](../store/catalogue.ts) coalesces global notices
and retries failed reads without a standing successful timer. Hidden pages keep
Herdr event refreshes; return-to-page observes every held owner.

## Desk

Desk follows the aggregate host filter. Receipt and screen reads capture each leaf's
connection and runtime generation; retirement never reroutes a read. Review marks
and recent opens use qualified session identities across filter and focus changes.
Stable service stop identities survive expiry of display times. The fresh
snapshot producer passes existing `agent.list` metadata to the Desk adapter;
qualified native state-change sequences reveal later completed turns even when
no browser observed their working phase. Pane rows alone supply the agent harness
and session identity; only matching `agent.list` sessions may augment status and
progress. Shared stop IDs participate in receipt refresh and currency, so late
reads for a preceding stop cannot enable its successor's review mark. Display
expiry alone does not invalidate a receipt. Shared Desk metadata belongs to agent
panes; verified asking shells still appear in Needs you and open their original
terminal without attempting an agent-metadata mutation. Reads use fair bounded admission and
independent host queues. Pending reads keep
their admission across refreshes; queued work coalesces to the latest observation.

When `world_shared_acquisition` is negotiated, [useDeskWatch](useDeskWatch.ts)
and [DeskWatchClient](deskWatchClient.ts) replace screen/receipt polling with
whole socket declarations. The service's [watch registry](../../../server/src/world/desk-watches.ts)
reads the union once per resource: kind, host, generation, pane and session
fingerprint. Triggers belong to holders; each read carries that holder's trigger
captured at read start. Late holders see the result with a null trigger, which
cannot mark a current stop. Browsers count consecutive failures per captured
trigger independently. Hidden/closed Desks release their targets. Without the
capability, the existing 4 s screens and 20 s receipts remain; full-report reads
stay on demand. The current service advertises the capability; older services
keep legacy acquisition. [Shared watch tests](../../../server/src/world/desk-watch-consumers.test.ts)
and the [Desk browser fixture](DeskView.browser.tsx) cover both paths.

| Task | Open these owners | Focused evidence |
| --- | --- | --- |
| Lane routing, ordering or keyboard triage | `partitionDesk` and `DeskView` in [DeskView.tsx](DeskView.tsx); [DeskView.css](DeskView.css) styles `.desk-*`. | [Desk tests](DeskView.test.ts) |
| Receipts, review marks, observed stops or polling limits | `useTurnReceipts` and `pollingTargets` in [handoffs.ts](handoffs.ts); shared metadata flows through [useDeskState.ts](useDeskState.ts) and `WorldDeskStore` in [deskStateStore.ts](deskStateStore.ts), the service [registry](../../../server/src/world/desk-state.ts), [fresh observations](../../../server/src/world/desk-observation.ts) and [Desk RPC](../../../server/src/rpc/desk.ts). Receipts come from `latestTurnReceipt` in [turn-receipt.ts](../../../server/src/agent/turn-receipt.ts). Triage covers every agent; only reads are bounded. | [Desk tests](DeskView.test.ts), [unequal receipt coverage](deskSharedStops.test.ts), [browser state](deskStateStore.test.ts), [registry](../../../server/src/world/desk-state.test.ts), [observation](../../../server/src/world/desk-observation.test.ts), [RPC](../../../server/src/rpc/desk.test.ts), [receipt tests](../../../server/src/agent/turn-receipt.test.ts) |
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
| Town scene model | [scene/townScene.ts](town/scene/townScene.ts) derives what the town is, headless: the model with colours and pins, placement with its memory per shape, the reflow hold and its explicit Fold/Expand bypass, teams, accessible targets, desk badges and blocked-since times. It reads time only through the [clock port](town/scene/ports.ts). A lint rule keeps browser clocks, timers, globals, frameworks, renderers and adapters out of `town/scene/`, and [a boundary test](town/townSceneBoundary.test.ts) checks that rule and the scene's whole module graph; `TownCanvas` is its adapter and passes the page clock ([townBrowserClock.ts](town/townBrowserClock.ts)). [scene/townSceneCamera.ts](town/scene/townSceneCamera.ts) owns where the camera goes: home and re-framing, keys, the zoom steps, focus, room requests, the drawn camera and the pose kept per shape; the renderer receives that camera and steps its motion. [scene/townInteraction.ts](town/scene/townInteraction.ts) carries out pointer and wheel input through World's gesture machine (holds, the magnet, edge pan, drops and pinches) with the renderer, drag ghost and callbacks as ports, and animation frames through a frames port; `TownCanvas` only reads DOM events. HUD topics move here in a later step ([#522](https://github.com/IvoryHeart/herdr-world/issues/522)). | [Scene tests](town/scene/townScene.test.ts), [camera tests](town/scene/townSceneCamera.test.ts), [interaction tests](town/scene/townInteraction.test.ts), [bake tests](town/scene/townSceneBake.test.ts), [boundary test](town/townSceneBoundary.test.ts) |
| Town placement | [townLayout.ts](town/townLayout.ts) places buildings, rooms, desk cells, lounge and reception from native order, keeping desks in place while a scene is live. | [Layout tests](town/townLayout.test.ts) |
| Pointer input | `TownCanvas` reads pointer events and [scene/townInteraction.ts](town/scene/townInteraction.ts) hit-tests the canvas as last drawn and feeds World's shared gesture machine; [townGesture.ts](town/townGesture.ts) holds Town's targets (a hit, and the desk or agent a drag would carry) and thresholds. | [Shared cases](interaction/gesture.test.ts), [Town browser test](town/TownCanvas.test.ts) |
| Camera and zoom levels | [townCamera.ts](town/townCamera.ts) owns pan, zoom about a point, flights and the town/overview/room/desk thresholds; [townCameraTargets.ts](town/townCameraTargets.ts) resolves desk cells and room/building zoom targets. | [Camera tests](town/townCamera.test.ts) |
| Agent locations and movement | [townActors.ts](town/townActors.ts) seats, queues and walks agents (presentation only) with per-building pathfinding. Reflow translates occupants and their in-flight paths/tweens with their building, keeping them inside its navigation grid; if a shrinking floor invalidates a current position, tween or path, the actor settles at its current assigned goal immediately; resting lounge occupants retain their building-local slot without walking across town. Lounge reservations follow building-local slot order across reflows; agents finishing a stand-up animation resolve their walking destination from the latest snapshot layout. | [Actor tests](town/townActors.test.ts) |
| Pixi drawing and art | [townRenderer.ts](town/townRenderer.ts) owns renderer lifetime and per-frame updates, and bakes again only what [scene/townSceneBake.ts](town/scene/townSceneBake.ts) marks dirty (the whole scene, or single buildings); [townRendererScene.ts](town/townRendererScene.ts) builds the outdoor items and bakes each building and desk pod, [townRendererActors.ts](town/townRendererActors.ts) draws standing agents and status bubbles, and [townRendererDrag.ts](town/townRendererDrag.ts) draws the carried desk or agent and its dust; [townPaint.ts](town/townPaint.ts) bakes ground, interiors, façades and roofs; [townSprites.ts](town/townSprites.ts) holds the generated pixel art. See [world asset provenance](../../../docs/world-assets.md). | [Town browser test](town/TownCanvas.test.ts), [bake paint check](town/townBakePaint.test.ts) |
| Room cards, receptions, targets and room actions | The DOM world and team layers in [TownWorldLayer.tsx](town/TownWorldLayer.tsx) follow the camera, with visibility from [townVisibleHosts.ts](town/townVisibleHosts.ts), reception entries in [TownReceptionEntry.tsx](town/TownReceptionEntry.tsx), and batched accessible target buttons in [TownAccessibleTargets.tsx](town/TownAccessibleTargets.tsx); [townTargets.ts](town/townTargets.ts) builds accessible targets and [townHitTest.ts](town/townHitTest.ts) maps pointer hits to keys. Room plates use [TownRoomPlaque.tsx](town/TownRoomPlaque.tsx) and [their styles](town/townRoomPlaque.css) to fit the projected room width; only names truncate, the fixed active/total agent count reuses the room's `working + blocked` and `agents` counts (excluding plain terminals and asks), and management actions reveal below on hover, focus or touch. The dashed seat opens the room-qualified launcher (Terminal first). Other scene styles live in [town.css](town/town.css). | [Town browser test](town/TownCanvas.test.ts) |
| New agent and agent profiles | [agentProfiles.ts](agentProfiles.ts) holds the profiles store, launcher calls and the events that open [AgentLauncherDialog.tsx](AgentLauncherDialog.tsx) and [ProfileEditor.tsx](ProfileEditor.tsx), which [WorldControlPlane.tsx](WorldControlPlane.tsx) mounts for every view; [ProfileSprite.tsx](ProfileSprite.tsx) draws a profile's look with Town's sprites, and `townRenderer` dresses agents launched from a profile. | [Browser helper tests](agentProfiles.test.ts) |
| Town settings or the Town board's cost line | [officePreferences.ts](officePreferences.ts) (shared Inspector opening, Town calm motion), [officeObservability.ts](officeObservability.ts) and [OfficeObservabilityDialog.tsx](OfficeObservabilityDialog.tsx) (the optional Prometheus cost metrics), displayed by [TownBoard.tsx](town/TownBoard.tsx). | [Preference tests](officePreferences.test.ts), [metrics tests](officeObservability.test.ts) |

### Town rendering performance

Town's Summary reads per-room status totals counted with the canonical observed
agent roster during cooperative World preparation; aggregate coverage can include
agents outside that roster and remains separate. Summary memoises those immutable
room contributions and groups room links by host.
Finish/seen overlays change only the affected room totals. Ask, metrics and clock
updates reuse that topology. Asking identities resolve through the snapshot's
generation-qualified pane and agent indexes, without scanning the roster. The
canvas uses the same native-order tab prefix as Spaces: 24 tabs folded, then
20 more per expansion. Attention never changes this admission. Explicit fold
requests carry a local revision alongside their admission state, so the scene
model applies that requested layout immediately; background topology changes
retain the interaction quiet-period guard.
[townFoldedActivity.ts](town/townFoldedActivity.ts) maps shared rail calls and
qualified asking identities onto hidden desks; [TownFoldIndicators.tsx](town/TownFoldIndicators.tsx)
shows red needs-you and green unreviewed-completion corner icons without extra
counts. It reads prepared identity indexes and visible desk sets, avoiding a
second projection or a full-roster scan on Ask changes. The production suites'
work ceilings and the World latency trend cover its cost.

The renderer draws through the shared World frame scheduler: state frames for
camera, roof and walking changes, motion frames for ambient animation, which
pause while the user types in a terminal and for reduced motion or calm mode.
Only visible animation requests motion frames. Continuous glow, selection pulses
and bouncing status bubbles retain their cadence; screen, typing and blink
changes schedule their next discrete frame. Covered interiors and off-screen
sprites do not keep ambient drawing alive. A settled scene with no visible
motion sleeps until a state change, input, preference or viewport invalidation.
The animation clock uses elapsed time even between sparse draws; simulation
steps retain their bounded delta. Pending ambient wake-ups are cancelled on
redraw and renderer destruction. [townFrameLifecycle.ts](town/townFrameLifecycle.ts)
requests a state paint after GPU context restoration and removes that listener
on disposal. A restore while hidden remains pending until visibility returns.

`town-idle-draws` in the Hosts filter suite uses the test clock and
`TOWN_STATIC_WORK_CEILINGS` to require zero draws per second in a settled,
roof-covered scene at 1440 and 390 px. It first proves renderer readiness, then
checks a coalesced state paint, smooth camera flight and visible pulses, return
to sleep, native GPU context loss/restoration while sleeping and hidden, and
destruction. This renderer-only case bypasses shell mounting, waits for the
renderer trace's camera/roof/actor/materialization causes to settle, and samples
flight and pulses for eight frames each. Settling does not require ambient
requests to stop: the unchanged zero-draw windows must detect those requests.
This keeps software-GL work bounded without changing the acceptance timeout.
The existing idle React-commit and moving-Inspector
anchor cases remain. See the [idle-frame audit](../../../docs/town-idle-frames.md)
for measured busy time, residual callback owners and paired synthetic captures.

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
| Work, note tray and narrow-screen controls | [BoardControls.tsx](board/BoardControls.tsx) measures the available row and intrinsic control widths on resize; [boardControlsLayout.ts](board/boardControlsLayout.ts) keeps Work first and overflows secondary actions; [boardControls.css](board/boardControls.css) owns their styles. Callbacks stay in BoardView. | [Finite layout tests](board/boardControlsLayout.test.ts), [Board consumer](BoardView.test.ts) with explicit CSS viewport emulation |
| Herdr-to-Board data | `projectBoard` in [board/boardModel.ts](board/boardModel.ts) builds hosts, workspaces, tabs and pane rows with qualified keys (`boardTabKey` qualifies a tab whose ID collides with a workspace ID). | [Model tests](board/boardModel.test.ts) |
| Placement and Tidy | `placeNew` and `freeSpots` in [board/boardPlacement.ts](board/boardPlacement.ts) place new cards around their parents through a spatial index; [board/boardPhysics.ts](board/boardPhysics.ts) settles overlaps. | [Placement tests](board/boardPlacement.test.ts), [physics tests](board/boardPhysics.test.ts) |
| Pointer gestures | World's shared machine in [interaction/gesture.ts](interaction/gesture.ts) turns pointer events into press, pan and fling, pinch, drag (a touch hold lifts; a mouse drags past 6 px), lines, taps and double taps. Board's targets and thresholds are in [board/boardGesture.ts](board/boardGesture.ts). | [Shared cases (Town's config)](interaction/gesture.test.ts), [Board cases](board/boardGesture.test.ts) |
| Inspector line anchors | [board/boardAnchors.ts](board/boardAnchors.ts) resolves an Inspector's node to a card, pane row or folded workspace. | [Anchor tests](board/boardAnchors.test.ts) |
| Notes, strings and Send | [board/boardDrafts.ts](board/boardDrafts.ts) keeps unsent text; the service stores the board and sends notes in [board-store.ts](../../../server/src/world/board-store.ts) and [board-send.ts](../../../server/src/world/board-send.ts); [board-recipient.ts](../../../server/src/world/board-recipient.ts) requires observed agents to retain any session already witnessed (group-only evidence may learn a session); a note's Start an agent uses the shared launcher ([launch.ts](../../../server/src/agent/launch.ts)). | [Draft tests](board/boardDrafts.test.ts), [store](../../../server/src/world/board-store.test.ts), [recipient](../../../server/src/world/board-recipient.test.ts), [send](../../../server/src/world/board-send.test.ts) and [launch](../../../server/src/agent/launch-readiness.test.ts) tests |
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
layout mid-frame. Until initial placement fits the camera, an early frame keeps
the dense Board's initial overview and does not publish an empty set of visible
cards. Placement requests the first frame that can publish them. Frames run
the committed render only: BoardView publishes the refs a frame reads (its
frame function, model, selection and anchor callbacks) in layout effects, never
during render, because the dense transition renders in slices and a frame can
run after BoardView's render but before that render commits.
`BoardView.mount.test.ts` controls frames before the dense transition, during
its held render, between the transition and placement, and after placement,
with immediate and deferred Board read failures; each order must retain the
phone render ceiling. Board reads its trace setting at mount rather than in an
effect, which re-rendered it once while the transition was pending.
Sizes come from a ResizeObserver, zones are measured before they
are written, and Inspector anchors and the board's box come from geometry and a
cache. Cards mount in their own container, so React appends them as one subtree.
Mounted cards also keep their callback refs and resize-observer registrations
across status refreshes; removal releases both. Re-registering unchanged cards
would force fresh resize notifications and another drawing pass.
`ConcurrentContexts.test.ts` records Board render time and observer work by phase
at 1440 and 390 pixels. Its refresh also updates the mounted terminal stores and
checks that no terminals open, dispose or fit, and no retained cards re-register.
Board controls compare measured layouts before dispatching a state update:
returning unchanged state from an updater can still add a React commit after the
initial layout effect. `board/BoardControls.dom.test.ts` delivers that initial
ResizeObserver notification after layout and checks that repeated measurements
add no commits, while narrower and wider layouts still update the controls.
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
transport workload through each view, and `ConcurrentContexts.test.ts` drives
two mounted runtimes through dense projection, rendering, refresh and noisy
output. Keep native key scheduling, cold initialization and aggregate refresh in
them. They assert only what does not depend on the runner's speed: every input
reaches the qualified host and generation and is acknowledged once, frames are
coalesced, and the work per phase stays within the ceilings in
[testing/workCeilings.ts](testing/workCeilings.ts): no terminal mount, card
observer registration, Board commit or World work during terminal output; one
World preparation and one view projection per snapshot, however much typing and
output run alongside. Dev-only counters in the production modules
(`countWorldWork` in [devtools/renderer.ts](devtools/renderer.ts), absent from
release builds) supply the World counts; construction is counted in units, not
in its time-bounded slices. `world.sync-build` counts a `buildWorldObject` that
render had to build because preparation had not (preparation builds the
focused host's variant, so a refresh needs none), and `colors.derive` counts
terminal-colour derivations (once per colour hook per changed input, never per
render). Unit tests read the same counters through
[testing/countedWorldWork.ts](testing/countedWorldWork.ts). A change that does
more work per event fails there.
Raise a ceiling only in a reviewed change that explains the new work.
The Hosts filter fixture's `town-idle` case holds idle Town, with an
Inspector and its line open, to the same file's idle ceiling: React commits in
at most two frames of 2 s of test time. Town animates through Pixi alone; only
its data polls render React, and views keep an unchanged anchor set. Its
`town-walk-anchor` case mounts a bare Town whose host never renders again, so
the Inspector line follows a walking agent under a still camera only through
the anchors Town reports from its own drawn frames.

Input delays (p95 and worst acknowledgement, worst input during dense load) are
not asserted: they depend on the runner's CPU and Chrome build, and fixed budgets
on hosted runners failed at random. The suites record them through
[testing/latencyTrend.ts](testing/latencyTrend.ts) for the non-blocking
[World latency trend](../../../.github/workflows/world-latency-trend.yml), which
runs each suite alone on a quiet runner with the pinned test Chrome and compares
each value with recent main runs on the same CPU model. Treat a flagged rise
(▲, over 25%) as a regression to explain, as graphics and animation are added;
label a pull request `latency-trend` to measure it before merging. On Linux, a
local comparison can repeat a suite with `taskset -c <cpu-a>,<cpu-b>` after
checking the CPU/core mapping: separate cores and sibling logical CPUs measure
different contention conditions; run cases sequentially and report every run.
For timing investigation, set `WORLD_TRACE_PREFIX` to a private temporary path;
`WORLD_TIMINGS_ONLY=1` keeps acknowledgement/phase and Long Animation Frame
evidence without the overhead of a full Chrome trace.

## Browser fixtures on test time

A fixture whose checks are about behaviour, not latency, runs on test time:
it imports [testing/installTestClock.ts](testing/installTestClock.ts) first, so
React's scheduler captures the fake timers. The page's timers, animation frames
and `performance.now` then move only when the fixture advances the clock, in
16 ms frames, each followed by real task turns for React and promises. CSS
transitions and animations are off, and checks read end states. `settle(ms)`
becomes `clock.advance(ms)` and `waitFor` becomes `clock.until`. Physics, tweens,
holds and double-tap gaps then behave the same on any runner.
[BoardView.browser.tsx](BoardView.browser.tsx) runs this way, as 18 independent
scenarios: before each, `fresh()` unmounts the board, drains its pending work,
resets the fake service and storage, creates a new client document store (a
store refuses an older revision, so a reused one would keep the last scenario's
notes), forgets kept note drafts (they live for the page, beyond any one Board),
and mounts a new board; it then checks the board starts from the empty document
with no kept drafts. A scenario that needs
a strung note seeds one (`seedStrungNote`) and sets the view it checks, rather
than relying on what an earlier scenario left behind. A failure is reported under
its scenario's name and does not stop the rest, and a requested scenario name
that does not exist is reported. `BOARD_SCENARIO="<name>[|<name>…]" bun test
web/src/world/BoardView.test.ts` runs only those. The whole suite takes about 4 s
and passes under full CPU load.

A fixture that awaits the app itself (store refreshes, commands with deadlines)
uses the **running** clock instead: frames follow one another as fast as the page
handles them, the clock rests while nothing is scheduled, and the fixture's
advances and waits ride on it. The clock also owns `scheduler.postTask`, which
World's model preparation yields through, and reports a callback that throws
without stopping. [HostsFilter.browser.tsx](HostsFilter.browser.tsx) runs this way
through [testing/installHostsFilterClock.ts](testing/installHostsFilterClock.ts).
All Hosts filter cases, including the desktop and phone Spaces navigator, use
test time and fail on uncaught browser errors. Frame cancellation remains effective
until each callback runs, including when an earlier callback disposes a terminal.
The dense production suites above stay on real time, because the latency trend
measures real time.

The terminal-handoff fixture retains real browser frames for Inspector rendering
and focus. It imports [testing/handoffAdmissionClock.ts](testing/handoffAdmissionClock.ts)
before the app; its bundle plugin connects the production admission timer port
to that clock without shortening the deadline. The cancellation probe advances
the full admission window, then awaits a completion registered before creation
and emitted after the actual controller opener settles. Native painted frames
settle the rendering assertion. The browser-local pending-focus probe holds the
real focus request and asserts that no terminal Inspector has rendered; the
headless fixture's controlled opener cannot establish that boundary.

When a fixture models a healthy terminal with a real `TerminalView`, emit a
qualified full `TerminalPush` for each successful `terminal.attach`, using its
connection and runtime generation, terminal ID and requested dimensions. The no-frame watchdog
treats an acknowledgement without a first frame as an unresponsive stream and
retries, resetting terminal input. [The pane-switcher fixture](../paneJump.browser.tsx)
provides those frames and checks that its terminals finished loading. Wait for a
dialog's focused control before sending its next keyboard command.

`useWorldObservation.test.ts` mounts the actual observation hook and watchlist
store on test time. Synthetic runtime snapshots and deferred watchlist replies
exercise old/missing admission revisions and unavailable-only host scopes. The
Actions browser suite retains desktop/phone menu rendering of current counts
and unavailable-host feedback, plus existing qualified routing and focus checks.
No Town case moves.

`components/WorktreeLifecycleDialog.test.ts` mounts the actual lifecycle dialog
in an isolated DOM with timers and frames installed before React DOM loads.
Synthetic operational/service ports and explicit Inspector admission outcomes
exercise retirement/disposal, remembered-workspace validation, refresh and retry.
Those ports are deliberately unfenced so the dialog must reject a late result
itself. This is dialog policy evidence: real qualified RPC routing, Files/Changes
publication, focus and browser file input/download behavior stay in
`HostsFilter.resources.test.ts` and the existing store/runtime consumers. The
resource inventory removes the five policy scenarios at both viewport widths;
retained cases name their browser rendering, focus and file-input boundary.

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
