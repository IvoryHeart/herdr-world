# Implementation summary — Office agent conversation bubble

- **Parent spec:** [`001-office-agent-conversation-bubble-spec.md`](001-office-agent-conversation-bubble-spec.md)
- **Implemented at:** 2026-08-04
- **Implementation status:** Complete
- **Delivery state:** Merged to `main`

> The approved parent specification remains unchanged. The desktop footprint
> extension is recorded in [`001-office-agent-conversation-bubble-spec-extension-001.md`](001-office-agent-conversation-bubble-spec-extension-001.md).

## 2026-08-04 — Delivered implementation

- **Implemented:**
  - Single-selecting a live Office agent from the canvas or shared sidebar opens
    one live terminal conversation bubble.
  - The bubble reuses `TerminalView`, the existing qualified terminal session
    descriptor, capability gates, WebSocket transport, input, mouse, scroll,
    resize, upload, selection, and mobile controls.
  - The bubble uses a fixed lower-right DOM slot. Its terminal remains fixed
    while the lightweight SVG connector follows the selected agent when that
    agent is visible and hides when it is off-screen.
  - Target replacement, explicit close, Escape close, stale/offline/
    incompatible suppression, and successful double-click handoff are covered.
  - Canvas single-click opening is delayed briefly to preserve the existing
    double-click gesture without allowing the new panel to intercept its second
    click.
  - Desktop width is approximately 40% when space permits, with narrow-screen
    fallback styling.

- **Evidence:**
  - `npm run check` — passed: vendor check, web lint, Rust formatting, 296 web
    tests, 112 compatibility tests, 131 bridge tests, web build, and bridge
    build.
  - `npx playwright test tests/e2e/world.spec.ts` — 12 passed.
  - `npx playwright test tests/e2e/world-visual.spec.ts -g "stable Office conversation bubble"` — passed.
  - Visual evidence: [`office-conversation-1440x900.png`](../evidence/spec-001-office-agent-conversation-bubble/office-conversation-1440x900.png).

- **Constraints / operational notes:**
  - A fixed panel can cover an underlying bar sprite. Use its close button (or
    Escape) before double-clicking a covered canvas target; sidebar double-click
    remains available without closing first.
  - No Herdr bridge, protocol, endpoint, or terminal transport changes were
    required.

- **Drift from approved spec:**
  - The approved parent requested an approximately quarter-viewport desktop
    target. The requested larger approximately 40% desktop footprint is
    implemented under extension 001; all other parent requirements are unchanged.

- **Follow-up extension:** None.

### 2026-08-04 — Centered placement refinement

- **Implemented:** Moved the static conversation panel from the lower-right
  slot to a centered Office-stage slot while retaining the approximately 40%
  desktop footprint and moving connector only.
- **Evidence:** Added centered-position assertions to the Office browser
  coverage and rebuilt the web assets.
- **Constraints / operational notes:** Terminal content remains rendered at
  its actual CSS dimensions; no transform or bitmap scaling was introduced.
- **Drift from approved spec:** Placement changed under extension 002 at the
  requester's direction; the earlier lower-right implementation is retained in
  the preceding delivery record as history.
- **Follow-up extension:** None.

### 2026-08-04 — Desk terminal selection refinement

- **Implemented:** Occupied desks now open the attached agent terminal;
  desks with a live non-agent pane open that shell terminal. Empty or
  unavailable desks remain selection-only.
- **Evidence:** `npx playwright test tests/e2e/world.spec.ts -g "attached terminal when an occupied desk"` — passed.
- **Constraints / operational notes:** The same admission, generation, stale,
  and capability checks used for agent selection apply to desk targets.
- **Drift from approved spec:** Desk terminal selection is implemented under
  extension 003; the parent agent-only behavior is unchanged.
- **Follow-up extension:** None.

### 2026-08-04 — Standard terminal footprint and movement resilience

- **Implemented:** Widened the centered conversation panel into a rectangular
  desktop terminal footprint suitable for an approximately 96×30 session,
  while retaining real CSS sizing and responsive narrow-screen behavior.
- **Implemented:** Kept the selected terminal anchored to its pane/terminal
  identity when a live status update moves an agent between the bar, reception,
  and work floor. Desk occupancy changes no longer dismiss an active terminal.
- **Evidence:** Added the desk idle-to-working transition regression to
  `tests/e2e/world.spec.ts`; the panel geometry test now requires a readable
  rectangular desktop footprint.
- **Drift from approved spec:** Geometry and target-lifecycle behavior are
  recorded under extension 004; parent spec and extensions 001–003 remain
  unchanged.
- **Follow-up extension:** None.

### 2026-08-04 — Dual workbench and agent connectors

- **Implemented:** Added separate connector endpoints for the selected
  agent's associated workbench and current visual position. The workbench line
  stays stable while the agent moves; the live-agent line follows destination
  changes when visible.
- **Implemented:** Connector styling now distinguishes the stable workbench
  line from the stronger live-agent line, and each endpoint is independently
  viewport-gated.
- **Evidence:** The stable conversation browser test now verifies both
  connector paths.
- **Drift from approved spec:** Dual connector behavior is recorded under
  extension 005; earlier specifications remain unchanged.
- **Follow-up extension:** None.

### 2026-08-04 — Full terminal handoff from Office

- **Implemented:** Added an “Open full terminal in Spaces” control to the
  conversation bubble. It preserves the attached pane, bridge, and tab
  context, closes the overlay, and focuses the standard Spaces terminal view.
- **Evidence:** Added an end-to-end handoff test covering Office selection,
  Spaces navigation, pane identity, and bubble closure.
- **Drift from approved spec:** Full Spaces handoff is recorded under extension
  006; earlier specifications remain unchanged.
- **Follow-up extension:** None.

### 2026-08-04 — Startup selection and event-burst resilience

- **Implemented:** Preserved Office pane selections made while the initial
  projection is still being admitted, then resolved them when the matching
  roster entry becomes available.
- **Implemented:** Coalesced refreshes caused by bursts on `/ws/events` so a
  stream of Herdr events cannot trigger an unbounded sequence of full snapshot
  refreshes and delay first interaction.
- **Implemented:** Shortened early capability-probe retry delays for bridges
  recovering during page startup.
- **Implemented:** Added opt-in Office diagnostics via `?officeDebug=1` or
  `localStorage.setItem("herdrWeb.debug.office", "1")`; diagnostics are silent
  unless explicitly enabled.
- **Evidence:** `npm run lint:web`, `npm run test:web` — 296 passed;
  `npx playwright test tests/e2e/world.spec.ts` — 15 passed; targeted bridge
  and RuntimeConnection tests passed; production web build passed.
- **Follow-up:** Movable/resizable bubble geometry and connector tracking are
  intentionally deferred to a separately approved extension.

### 2026-08-04 — Movable, resizable, and translucent Office conversation bubble

- **Implemented:** Added ephemeral desktop geometry for the Office bubble with
  pointer-captured header dragging, bounded resizing, keyboard arrow movement/
  resizing, visible focus states, and a labelled resize affordance. Geometry
  resets when the bubble closes and is never persisted or sent to Herdr.
- **Implemented:** Kept the terminal at its configured font size and refit the
  existing renderer against the bubble's real CSS dimensions after resizing.
  The full Spaces terminal remains opaque and unchanged.
- **Implemented:** Added controlled Office-only translucency using Ghostty's
  transparency support and a restrained backdrop blur; terminal text, cursor,
  selection, controls, and connection state are not given blanket opacity.
- **Implemented:** Continued tracking both workbench and live-agent SVG
  connectors after bubble movement, resizing, scrolling, viewport changes, and
  agent destination changes. Bubble geometry remains stable across target
  replacement and idle-to-working movement.
- **Implemented:** Preserved the existing compact/mobile fixed presentation;
  desktop drag and resize controls are hidden there.
- **Evidence:** `npm run check` passed: 301 web tests, 112 compatibility tests,
  131 bridge tests, formatting, builds, and vendor validation. The complete
  `npm run test:e2e` run passed with 33 tests and 2 expected skips. Added
  browser coverage for drag, resize, connector updates, target/movement
  continuity, mobile fallback, transparency, and serious/critical Axe results.
- **Visual evidence:**
  [`office-conversation-1440x900.png`](../evidence/spec-001-office-agent-conversation-bubble/office-conversation-1440x900.png)
  and
  [`office-conversation-390x844.png`](../evidence/spec-001-office-agent-conversation-bubble/office-conversation-390x844.png).
- **Drift from approved spec:** None. Keyboard movement and resizing are
  included as an accessibility enhancement; mobile drag/resize and geometry
  persistence remain deferred.
- **Follow-up extension:** None.

### 2026-08-05 — Stage-bounded bubble growth

- **Implemented:** Retained the existing preferred centered opening footprint
  while removing the interactive resize ceiling at 960×560. The bubble can
  now grow to the current usable Office stage dimensions, with the existing
  margin, minimum size, refit, and connector behavior preserved.
- **Evidence:** Updated geometry unit coverage to prove oversized dimensions
  clamp to the stage rather than the former fixed ceiling. The resize browser
  regression remains green, and the full repository check passes.
- **Drift from approved spec:** None; this behavior is covered by extension
  008.
- **Follow-up extension:** None.

### 2026-08-05 — Full terminal surface after bubble expansion

- **Implemented:** Removed the shared terminal host padding only inside the
  Office conversation bubble, so the terminal begins at the full content edge
  after opening and resizing.
- **Implemented:** Continued the matching translucent terminal background
  beneath Ghostty's whole-cell canvas remainder. The terminal remains
  unscaled, with its configured font and cell metrics intact.
- **Evidence:** Added browser coverage for zero bubble-terminal padding,
  full-edge placement, and bounded canvas dimensions; the focused resize test
  passes.
- **Drift from approved spec:** None; this behavior is covered by extension
  009.
- **Follow-up extension:** None.

### 2026-08-05 — Connector continuity and centered terminal surface correction

- **Implemented:** Kept the live-agent connector present when its agent moves
  beyond the current Office scroll viewport. The connector now terminates at
  the nearest viewport edge with a small off-screen marker, so a move to the
  Agent Bar remains visually associated without moving the conversation bubble
  or changing the Office scroll position.
- **Implemented:** Centered the Office terminal's rendered whole-cell canvas
  within its host so fractional unused space is balanced across both sides and
  top/bottom rather than appearing as a one-sided right gap.
- **Evidence:** `npm run test:web` — 303 passed; `npm run build:web` — passed;
  `npx playwright test tests/e2e/world.spec.ts` — 19 passed. Added browser
  coverage for the working-to-bar connector transition and symmetric terminal
  canvas spacing.
- **Drift from approved spec:** The earlier connector extension specified
  hiding endpoints outside the viewport. User testing showed that behavior was
  confusing, so the live endpoint now uses an edge marker instead.
- **Follow-up extension:** None; retain this behavior unless a later approved
  connector extension replaces it.

### 2026-08-05 — Bounded multi-window Office terminals

- **Implemented:** Added extension 010, allowing up to five simultaneous Office
  terminal windows. Each window keeps independent geometry, z-order, terminal
  session, and workbench/live-agent connectors.
- **Implemented:** Qualified bridge/pane identity deduplicates selections made
  through an agent, occupied desk, or shared sidebar entry. Selecting an
  existing terminal focuses it instead of opening another renderer or
  transport session.
- **Implemented:** A sixth distinct terminal is rejected with a visible status
  message; Escape and close actions remove only the focused/requested window.
  Compact layouts retain one active presentation.
- **Evidence:** `npm run lint --prefix web`, `npm run build:web`,
  `npm run test:web` — 303 passed, and
  `npx playwright test tests/e2e/world.spec.ts` — 20 passed. Browser coverage
  includes duplicate suppression, the five-window cap, independent geometry,
  connector continuity, handoff, mobile fallback, and stale-host behavior.
- **Bug fix:** Office canvas selection now preserves already-open windows when
  selecting another agent or desk. Previously, the canvas selection path
  cleared the existing conversation set before opening the newly selected
  target; sidebar selection remains independently routed through its qualified
  pane target.
- **Verification:** The rebuilt local bridge was exercised against the live
  runtime with distinct sidebar agents; two independent Office windows opened
  and retained their qualified window IDs. Web lint, build, 303 web tests, and
  the five-window E2E test remain green.
- **Drift from approved spec:** None; behavior is covered by extension 010.
- **Follow-up:** Window-limit configuration, persisted layouts, and mobile
  multi-window presentation remain deferred.
