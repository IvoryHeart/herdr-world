## Context

**Five views today:** World offers Desk, Spaces, Office, Town, Board, Tree and Graph. Town is the default.

**Inspector lines:** each spatial view reports node anchors to `WorldControlPlane`, which draws the connector from each Inspector window to its node (`worldConnectorGeometry`, `WorldIntentConnector`).

**Town still depends on Office modules:**

- the projection of hosts into rooms, desks and seats (`herdrOfficeProjection`);
- room actions, selection, observability, the callout and `officePreferences`.

The anchor types `OfficeCanvasAnchor`, `OfficeCanvasAnchors`, `OfficeConversationAnchors` and `OfficeConversationAnchorTarget` live in `PixelOfficeCanvas.tsx`. Town, Board, the connector and the Inspector controller import them as types only.

**Dead code after retirement:** an import analysis of `web/src` (runtime imports from `main.tsx`, with the four retired entry points removed) leaves 36 files and about 12,400 lines unreachable:

- Graph: `SpatialGraphView` and `graph/*`.
- Tree: `ConnectedTreeView` and `treePreferences`.
- Office: `PixelOfficeView`, `PixelOfficeCanvas`, `OfficeRoomActionsOverlay`, `OfficeCompletionNotices`, and the pixel renderer and drawing modules (`officeRenderer*`, `office*Drawing`, `officeLayout`, `officeGeometry`, `officeVirtualization`, `officeStaticCache`, `officeScenePreparation`, `officeSceneSignature`, `officeSemanticTargets`, `officeInteraction`, `officeArtwork`, `officeFloorTextures`).

`treeProjection` stays, because the common navigator uses it.

**Frame scheduling:** `worldFrameScheduler.ts` gives canvas views one queue:

- an ordinary task runs before each animation frame, so socket replies progress;
- motion is suspended while a terminal receives input;
- views off screen or in a hidden document are skipped;
- each flush has an 8 ms budget.

Town and the Office renderer use it. Board's `boardScheduler.ts` is its own rAF loop with invalidation reasons and error isolation.

**Input handling:**

- Town handles pointers in one effect in `TownCanvas.tsx`: a pointer map, pinch, a 350 ms touch hold to drag, a mouse drag after 6 px, double tap and fling.
- Board has the pure `boardGesture.ts` machine, `boardTrace.ts` and an overlay.

## Goals / Non-Goals

**Goals**

- Remove Graph, Tree and Office completely, keeping every behaviour Town, Board, Desk and Spaces rely on.
- Old addresses and saved views keep working by landing somewhere sensible.
- One gesture machine and one trace serve Town and Board.
- Board animates on World's scheduler.

**Non-Goals**

- **Renaming the office model modules** Town uses (for example `herdrOfficeProjection` to a neutral name): churn without behaviour. That can happen separately.
- **Changing Desk or Spaces.**
- **New interactions.** Gestures stay as they are today; only their implementation is shared.
- **The appearance work in #221**, and test-suite redesign beyond removing retired suites (#223).

## Decisions

**Old views map to their nearest current view.**

- `/office` and a saved `office` view open Town, the Office's successor.
- `/graph` and `/tree` open Board: Board replaced Graph in the phone navigation, and it shows the same host, workspace and agent hierarchy, which Tree and Graph drew.
- The browser history entry is replaced, not pushed, so Back doesn't bounce.

An alternative was showing a notice that the view is retired. Rejected: the redirect is enough, and the changelog records the removal.

**Settings that survive are renamed only where users see them.** Inspector presentation (Docked or Floating) is already World-wide in code (`useWorldObservation`), so the requirement becomes shared. Town calm motion stays. Room alignment, long titles and Office scroll position go, along with their menu items. The storage key `officePreferences:v1` is kept, so saved Inspector and calm choices survive. Ignored fields are dropped on the next write.

**Anchor types move to `worldConnectorGeometry.ts`.** It is already the shared geometry module the connector consumes. The `Office*` names become `World*`; it's mechanical.

**Gestures: one pure machine, with view adapters.** `boardGesture.ts` becomes `world/interaction/gesture.ts`. It gains the one capability Town has and Board lacks: a touch hold that turns a press on a draggable target into a drag, so a quick swipe still pans. Its parameters are hold time, drag threshold, double-tap window and distance, and whether a target can be dragged.

Each view classifies targets into its own `GestureTarget` kinds and applies effects:

- **Town:** hit testing on the canvas; drag desks and agents; tap selects; double tap opens.
- **Board:** DOM classification, as today.

Both keep their own camera. The machine stays pure, so every past input bug stays a unit test of an event sequence.

**Frames: Board registers with World's scheduler.** `boardScheduler.ts` becomes a thin adapter over `registerWorldFrames`:

- `invalidate(reason)` requests a `state` frame and records the reason.
- A frame that reports "still moving" requests the next `motion` frame. Motion frames are what the scheduler suspends during terminal input and under reduced motion.
- Errors are caught per frame and reported to the trace.

Board's tests keep their fake clock by injecting the scheduler, as they do today.

An alternative was moving Board's loop into the scheduler module unchanged. Rejected: it would lose terminal-input pausing and the shared frame budget, which is the point.

**Development tools: one module, compiled out of release builds.** Board's trace and overlay, `officeDebug` and the renderer counters in `worldRendererDebug` become one `world/devtools/` module with three parts:

- a bounded trace ring with view labels;
- the overlay;
- renderer counters.

How it is switched:

- **Build flag:** a Vite define `__HERDR_WORLD_DEVTOOLS__` is true for `vite --mode development` or when `HERDR_WORLD_BUILD_DEVTOOLS=1`, and false otherwise.
- **Release builds:** the release and package scripts never set it.
- **Views:** call `devtools()` only behind the flag. A release build therefore drops the module, the overlay, the menu toggle and the `?debug=` and `?officeDebug=` switches. Each call site costs a constant `false`.
- **Selection:** in a development build, `?debug=town` and `?debug=board` select per view, and the ⋯ menu toggle sits in each view's menu.
- **Privacy:** records stay in a bounded ring, local to the page, and are never sent anywhere.
- **Bundle check:** asserts that release output contains no dev-tools strings.

An alternative was keeping the trace in production behind a query switch. Rejected: the owner wants instrumentation to exist only for development. It also removes a diagnostic surface from the trusted single-user service.

**Order: retire first, then share.** Removing the retired views first means the shared module has exactly two consumers to fit, and Part A's deletions don't conflict with Part B's moves.

### Board Send binds a note to its agent (#228, folded in by the owner)

A pane outlives its agent: one agent can exit and another start in the same
shell, keeping the pane and terminal IDs. Send used to check only the pane, the
witnessed terminal and that some agent was present. When a note is strung to
a pane, the browser sends the agent it showed there (kind and Herdr session).
After the save returns, the service reads the pane and records the recipient
(kind, hashed session, foreground process group) only if it finds that same
agent, so a replacement between the user's action and the read fails closed.
A string without a recipient (no session shown, a replacement, a host not
ready, a re-witness after Herdr restarts, or made before this change) asks the
user to confirm the agent at Send. The service's record is qualified by the
anchor's connection, pane and terminal, so a late answer cannot land on a
string that has since moved to another host.

Two recipients are the same agent when kinds match and sessions match, or, when
either has no session, process groups match: an agent may report its session
only after it starts, and a replacement in the same shell has a new process
group. Herdr cannot hold a pane between a check and `agent.prompt`, so Send
reads the agent before and after the prompt; a change after submission is
reported as possibly delivered to another agent, never as sent. That window is
Herdr's authority boundary, the same one the assistant's prompt action has.
Clients cannot set or claim a recipient; a confirmed replacement becomes the
string's recipient.

## Risks / Trade-offs

- **Users who relied on Office's pixel scene or Graph's force layout lose them.**
  - Mitigation: Town and Board are their successors, and the owner made the decision.
  - The changelog's Removed entry names the replacements.
- **A Town module silently depends on deleted Office code.**
  - Mitigation: the import analysis decides what's deleted.
  - Typecheck and the Town browser suite must pass with the files gone.
  - Deletion is one commit, so it's easy to bisect.
- **Moving Board onto the shared scheduler changes timing.** Motion frames pause while the user types, and frames run after a task tick.
  - Mitigation: Board's settling and drag behaviour are checked in the browser suite.
  - A drag is user input, not motion, so it continues.
- **Town's input moves onto the shared machine and could regress touch behaviour.**
  - Mitigation: Town's existing touch and drag behaviour becomes gesture unit tests first:
    - hold to drag;
    - a quick swipe pans;
    - a second finger cancels a drag into a pinch;
    - the mouse drags after 6 px.
  - Then the switch, with the Town browser suite and a real-input CDP run at phone size.

## Migration Plan

1. **Retirement commits:**
   - move the anchor types;
   - remove routes and navigation, and add the redirects;
   - delete the retired code and tests;
   - update settings;
   - update the spec deltas, docs and coverage.
2. **Shared-core commits:**
   - gesture module plus tests;
   - Board on the shared gesture, trace and scheduler;
   - Town on the shared gesture and trace.
3. **Rollback:** revert the PR. No stored data changes shape. Saved Office settings that are dropped only cost the user re-choosing alignment, which no longer exists.

## Decisions Confirmed

- Owner, 2026-10-19: `/tree` and `/graph` open Board, `/office` opens Town, and Desk stays.
- Owner, 2026-10-19: instrumentation exists only for development, not in production builds.
