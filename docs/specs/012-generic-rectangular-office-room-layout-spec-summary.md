# Implementation summary — Generic rectangular Office room layout

- **Parent spec:** [`012-generic-rectangular-office-room-layout-spec.md`](012-generic-rectangular-office-room-layout-spec.md)
- **Implemented at:** 2026-08-13
- **Implementation status:** Complete

### 2026-08-13 — Delivered implementation

- **Implemented:** Commit [`657e560`](../../commit/657e560) adds the bounded pure Office geometry resolver, publication controller, immutable layout revisions, stale-canvas acknowledgement gating, title-safe room headers, nested room bounds, wrapped CEO reception/content layout, vertically elastic Agent Bar, logical-canvas scrolling, synchronized DOM/Pixi geometry, accessible overflow markers, and preserving Office layout settings. Apache-derived geometry and drawing files carry the required downstream modification notices. Observability/settings synchronization was delivered separately in [`241c2cb`](../../commit/241c2cb), which is pushed to the feature branch.
- **Evidence:** `npm run lint`; `npm test` — 52 files, 369 tests; `npm run build`; targeted Playwright checks for persistent World navigation and narrow horizontal Office scrolling — 2 passed; room capability actions — 1 passed; narrow and desktop visual capture checks — passed. Focused layout tests cover the geometry/publication/bounded-content contract, including A → B → A revisions, stale acknowledgements, emergency ellipsis, CEO wrapping, nested bounds, settings preservation, bounded omission samples, vertical and horizontal caps, fallback markers, generic descriptor ordering, and Agent-Bar revision gating.
- **Constraints / operational notes:** The approved logical-scroll mode remains in effect: the viewport bounds the scroll container, while the resolved logical canvas may be wider. Mobile-specific composition remains deferred by the approved contract. Existing generated evidence images and the pre-existing repository analysis file were intentionally left outside the implementation commit.
- **Implementation boundary:** The generic descriptor contract is implemented as bounded geometry/content primitives for routed work-room descriptors and the explicit CEO content flow. CEO and Agent Bar remain named presenter compositions; arbitrary future region descriptors are normalized deterministically but are not automatically routed or rendered by this slice. A new room role therefore needs an explicit presenter integration or later approved composition extension.
- **Follow-up extension:** None.

### 2026-08-14 — Review contract corrections

- **Implemented:** The review corrections now publish one deep-frozen presenter-facing geometry snapshot, use an explicit normalized DTO with canonical serialization, account for every content descriptor beyond the bounded cap, include room/content minima in width resolution, and implement distinct bounded row/column/wrap/grid/span placement behavior. CEO reception and Agent Bar rectangles are carried by the resolved layout and consumed directly by drawing and anchor paths.
- **Implemented:** Font readiness and Pixi text measurement are supplied by the presentation layer; font completion triggers remeasurement and a new published revision when geometry changes. Canvas acknowledgement is deferred to a post-render ticker priority, and stale acknowledgements remain rejected by revision.
- **Evidence:** The web suite now passes 52 files / 369 tests, including complete published-snapshot immutability, property-order digest equivalence, 3,000-item omission accounting, explicit content minima, exact column-row capacity, hard vertical/horizontal caps, bounded fallback geometry, deterministic descriptor ordering, and presenter revision gating. `npm run lint --prefix web` and `npm run build --prefix web` pass; the full root test suite also passes (114 compatibility tests and 148 bridge tests).
- **Implementation boundary:** Extensions 001/002 describe reusable geometry primitives; this implementation does not claim automatic placement of arbitrary future CEO/Agent-Bar room descriptors. CEO wrapping and Agent Bar growth are implemented through their current explicit composition paths.

## Delivery record

The approved parent specification, Extensions 001 and 002, and their implementation are retained as separate immutable history. The observability synchronization commit was pushed before the layout implementation commit; the layout implementation commit is local on the current feature branch pending the repository owner's push decision.

### 2026-08-13 — Visual header correction

- **Implemented:** Commit [`6bff148`](../../commit/6bff148) removes a decorative room-window drawing that occupied the title band and makes the header background span the complete safe header rectangle, keeping title text and action controls visually separate.
- **Evidence:** `npm run lint` and `npm run build` passed; the running bridge serves the rebuilt `web/dist` asset.
- **Constraints / operational notes:** Refresh the existing `localhost:8787/world` tab to load the rebuilt asset.
- **Drift from approved spec:** None.

### 2026-08-13 — Per-room action-zone correction

- **Implemented:** The room-header renderer now reserves the edit/trash action zone for every room and applies renderer-font measurement with deterministic ellipsis to both workspace and host labels before that boundary. This covers the asymmetric collision visible only on some room titles.
- **Evidence:** Fresh 1440×900 and 375×812 captures were inspected after rebuilding `web/dist`; all visible room headers keep text separate from their action controls. `npm run lint`, the full 360-test web suite, and `npm run build` pass.
- **Drift from approved spec:** None.

### 2026-08-13 — Separate title boxes from room actions

- **Implemented:** Room header geometry now distinguishes the root title-box width from the action group width/gap. The edit and delete controls are positioned outside the title box while remaining inside the room's header-safe area; normal titles are no longer truncated merely to reserve those controls.
- **Evidence:** Fresh 1440×900 and 375×812 screenshots were captured and inspected. All visible rooms show complete headings where capacity allows, with edit/delete controls outside the title backgrounds. Focused layout tests now cover the title-box/action-width invariant; lint, focused tests, and production build pass.
- **Drift from approved spec:** None.

### 2026-08-14 — Header-aware room sizing and action anchoring

- **Implemented:** Room width now resolves from the maximum of the complete header footprint (centered title box, adjacent rename control, and right-corner close reserve) and the widest desk/standing row. Header text measurement uses the uppercase form rendered by Pixi. The title box is centered on the room's top border, rename remains immediately beside it, and close is anchored to the room header's top-right safe edge.
- **Evidence:** Fresh 1704×1400 desktop and 375×812 narrow captures were inspected after rebuilding `web/dist`; no title text or header control escapes its room. Focused geometry tests cover header-group centering, close containment, and header-versus-desk sizing; lint and production build pass.
- **Drift from approved spec:** None.

### 2026-08-14 — Preserve roads between room rows

- **Implemented:** The inter-room road pass now renders after room floors and borders, while using the resolved room rectangles for its horizontal and vertical gaps. Room-row geometry also asserts enough clearance for room shadows and selection strokes.
- **Evidence:** Fresh desktop capture inspected after rebuilding `web/dist`; the horizontal road remains continuous between the two room rows. Focused geometry tests, lint, and production build pass.
- **Drift from approved spec:** None.

### 2026-08-14 — Browser authority and publication identity correction

- **Implemented:** Browser hit-testing and interaction tests now consume the published immutable Office layout exposed by the renderer diagnostics instead of reconstructing heuristic room geometry. Full room labels are retained for semantic DOM while visible canvas labels remain renderer-fitted. Publication identity is the canonical normalized-input digest; no generation-history retention is required. A mounted React regression test covers Agent-Bar hiding across layout revisions until the matching canvas acknowledgement arrives.
- **Evidence:** The original Office hover regression and long-title browser checks pass; the focused interaction set passes 6/6; the web suite passes 52 files / 369 tests.
- **Implementation boundary:** Generic composition claims are limited to the routed work-room and explicit CEO/Agent-Bar flows described above.
