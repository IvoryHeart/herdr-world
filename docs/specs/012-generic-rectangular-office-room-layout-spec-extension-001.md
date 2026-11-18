# Generic rectangular Office room layout — responsive-ready foundation

- **Parent spec:** [`012-generic-rectangular-office-room-layout-spec.md`](012-generic-rectangular-office-room-layout-spec.md)
- **Spec ID:** `012-generic-rectangular-office-room-layout-extension-001`
- **Status:** Approved
- **Created:** 2026-08-13
- **Owner:** Downstream Herdr World / Office presentation layer
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** Requester
- **Approved at:** 2026-08-13

> This compatible extension adds responsive-readiness constraints to the
> approved rectangular room contract. It prepares the room engine for a later
> mobile composition without choosing that composition or implementing mobile
> interaction in this slice.

## 1. Purpose

The approved room contract makes Office rooms fluid and role-aware, which is a
good foundation for mobile work. The implementation SHALL establish the
responsive geometry invariants now so a later mobile slice can choose between
stacking, scrolling, collapsing, or another composition without replacing the
room resolver or duplicating canvas and overlay geometry.

## 2. Scope

- Make room geometry depend on explicit viewport and logical-canvas inputs plus
  bounded room descriptors, rather than on a desktop-only composition
  assumption.
- Preserve the current narrow-viewport fallback during this slice: the Office
  may retain a bounded logical canvas and horizontal scrolling while a later
  mobile specification decides whether that is still the desired composition.
- Define responsive invariants for room rectangles, title-safe headers, room
  actions, content safe insets, visual footprints, and inter-room gaps.
- Keep the Pixi renderer and DOM overlays on the same immutable resolved layout
  result at desktop and narrow logical widths.
- Exercise the generic geometry and style tokens at representative narrow and
  desktop widths without adding mobile-only controls or persistence.

## 3. Non-goals

- No final mobile room composition, breakpoint policy, or mobile-specific room
  ordering beyond the approved CEO/work/Agent-Bar precedence.
- No decision between vertical stacking, horizontal scrolling, zooming,
  collapsing, or a hybrid mobile presentation beyond the explicit overflow mode
  defined for this foundation slice.
- No mobile gesture system, pinch zoom, minimap, alternate touch interaction,
  or mobile-specific DOM overlay implementation.
- No new browser setting for mobile layout and no change to Herdr or bridge
  contracts.

## 4. Context and constraints

The parent spec deliberately defers mobile-specific composition. This
extension therefore treats mobile as a future consumer of the generic geometry
API, not as a new room role.

The layout resolver SHALL keep viewport width and logical canvas width as
separate values:

- `availableViewportWidth` is the measured inner width of the Office scroll
  container in logical scene units. It is the visible viewport bound and does
  not include horizontal overflow.
- `minimumLogicalCanvasWidth` is the lower bound required by the bounded CEO,
  Agent-Bar, room, header, action, and style minimums. It is not necessarily
  equal to the viewport width.
- `maximumExpandedCanvasWidth` is a finite renderer/layout cap for title-safe
  expansion and future content. No room or canvas may grow beyond this cap.
- `maximumExpandedRoomWidth` is the finite per-room cap used when an expanded
  title or content descriptor requests more width. It MUST be no greater than
  `maximumExpandedCanvasWidth`.
- `resolvedCanvasWidth` is the final logical canvas width and SHALL satisfy:
  `minimumLogicalCanvasWidth <= resolvedCanvasWidth <= maximumExpandedCanvasWidth`.
  It is derived from the viewport width and bounded content requirements, not
  from the browser viewport alone.
- `overflowMode` is `logical-scroll` for this foundation slice: the scroll
  container is bounded by `availableViewportWidth`, while the logical canvas
  MAY be wider up to `resolvedCanvasWidth`. A later mobile extension may
  replace this mode with stacking, collapse, or another presentation policy.

The resolver MUST be deterministic for the same inputs. It MUST return finite,
non-negative, non-overlapping rectangles whose visible ink bounds are inside
their owning room and whose rightmost edge is no greater than
`resolvedCanvasWidth`.

## 5. Requirements

### Requirement: Resolve viewport and logical canvas separately

The Office SHALL resolve layout from the explicit width values and bounds
defined above rather than conflating the scroll-container viewport with the
logical canvas.

#### Scenario: The viewport is narrower than the logical minimum

- **GIVEN** `availableViewportWidth < minimumLogicalCanvasWidth`
- **WHEN** the layout is resolved
- **THEN** `resolvedCanvasWidth` remains at least
  `minimumLogicalCanvasWidth`, the scroll container remains bounded by
  `availableViewportWidth`, and the current `logical-scroll` overflow mode
  exposes the complete bounded rectangular scene without room overlap.

#### Scenario: The viewport is wider than the logical minimum

- **GIVEN** `availableViewportWidth >= minimumLogicalCanvasWidth`
- **WHEN** the layout is resolved
- **THEN** the canvas expands only as required by bounded content and title-safe
  widths, never beyond `maximumExpandedCanvasWidth`, and does not introduce
  unnecessary overflow.

### Requirement: Use a sufficient bounded composition descriptor

The geometry contract SHALL distinguish room identity from composition data. A
room descriptor SHALL include:

- `role` and `precedence`;
- `region` (`ceo`, `agent-bar`, or `work` for this slice);
- deterministic `order` within that region;
- `flow` (`row`, `column`, `wrap-row`, or `grid`);
- `spanPolicy` describing whether the room may use one row, multiple rows, or
  the remaining region span;
- `headerMinWidth`, `contentMinWidth`, `preferredWidth`, and `preferredHeight`;
- bounded room action requirements; and
- bounded `contentItems[]`, where each item has an id, kind, minimum and
  preferred width/height, and any supported row/column span.

The resolver SHALL return the enclosing room rectangles and the resolved
rectangles for bounded content items and rows. This slice uses that generic
contract for work-room descriptors and for the explicit CEO content flow; the
CEO region and Agent Bar remain named presentation compositions rather than
arbitrary room descriptors. A future room role MAY reuse the generic rectangle
and style primitives only after a presenter routes it into one of the supported
composition flows and policies; a novel region composition requires a later
approved extension rather than an undocumented resolver change.

#### Scenario: A future role uses an existing composition flow

- **GIVEN** a future room is explicitly routed as a work-room descriptor,
  supplies bounded header/content descriptors, and uses the existing `grid`
  flow with a deterministic order
- **WHEN** the resolver receives it
- **THEN** it can reuse the generic room rectangle, style tokens, safe bounds,
  and presenter contract; adding a new region or presenter routing remains a
  separately approved integration task.

#### Scenario: A CEO room wraps synthetic content

- **GIVEN** a CEO descriptor contains bounded boards, reception stations, and
  future controls whose minimum widths exceed the available CEO row
- **WHEN** the CEO flow resolves
- **THEN** it returns deterministic child-item and row rectangles, wraps only
  at the declared row boundary, grows the CEO enclosing rectangle, and gives
  the Agent Bar the matching resolved region height.

### Requirement: Preserve responsive invariants across widths

The Office SHALL preserve the parent spec's room precedence, title-safe
minimums, content safe insets, visual-footprint bounds, and inter-room gaps at
every supported logical width.

#### Scenario: A long-title room is rendered at two widths

- **GIVEN** the same descriptors, title mode, and alignment are used
- **WHEN** the layout is resolved below, at, and above the logical minimum
- **THEN** each result remains deterministic, rectangular, non-overlapping,
  and keeps its room title and actions within the resolved room bounds.

### Requirement: Define mechanically testable rectangle semantics

Every resolved room SHALL expose these distinct rectangles/allowances:

- `outerRect`: the allocated room rectangle and the sole owner of room space;
- `wallRect`: the interior wall/floor bounds after border allowance;
- `headerRect`: the in-room title and action region;
- `contentSafeRect`: the region available to furniture and content after wall,
  header, and safe-inset allowances;
- `clipRect`: the renderer clipping bounds for visible room pixels;
- `inkBounds`: the complete visible footprint of the room's content, including
  shadows, labels, borders, decorative boards, and selection treatment; and
- `shadowAllowance` and `selectionStrokeAllowance`: explicit bounded insets
  included when proving `inkBounds` containment.

The contract SHALL require `inkBounds` to be wholly contained by `outerRect`
and `clipRect` to be wholly contained by `outerRect`. A room heading MUST be
inside `headerRect`; placing a heading above `outerRect` is not conformant.
“Preserve seat geometry” means preserving seat dimensions and local spacing,
not absolute scene coordinates; room movement caused by a larger header or CEO
height is expected.

#### Scenario: A reception station is at the CEO boundary

- **GIVEN** the final reception station is rendered near the CEO Office edge
- **WHEN** its table, chairs, shadow, label, and selection treatment are laid
  out
- **THEN** their union is represented by `inkBounds` and remains inside the
  CEO `outerRect` and `clipRect`, with no visible pixels crossing into a road or
  adjacent room.

### Requirement: Keep one immutable layout revision for presenters

The Office SHALL produce one immutable resolved layout object containing a
monotonic `layoutRevision`, the width inputs, room rectangles, child-item
rectangles, and style bounds. The Pixi renderer and DOM overlays SHALL consume
that same object rather than independently recalculating geometry.

An overlay whose layout revision does not equal the canvas revision MUST be
hidden or non-interactive until the matching immutable layout object is
available. A width, title-mode, alignment, projection, font-readiness, or
content change SHALL increment the revision exactly once for the resulting
layout.

#### Scenario: A resize races with an overlay update

- **GIVEN** the canvas has rendered revision `N` and a resize produces revision
  `N+1`
- **WHEN** the DOM overlay still holds revision `N`
- **THEN** the stale overlay is hidden or non-interactive, and it becomes
  interactive only after consuming revision `N+1` and its matching rectangles.

### Requirement: Keep style tokens viewport-independent

The visual style guide SHALL express walls, safe insets, shadows, selection
allowance, decorative boards, and layer order through bounded reusable tokens.
Those tokens MAY be applied at different logical scales later, but the current
slice SHALL not introduce room-specific viewport magic offsets.

#### Scenario: A room reaches its minimum logical size

- **GIVEN** a room is rendered at its smallest supported logical rectangle
- **WHEN** its furniture and decoration are laid out
- **THEN** the declared safe insets and complete visual footprints remain
  valid without clipping into roads, adjacent rooms, or action controls.

### Requirement: Use a canonical, preserving settings codec

The Office SHALL read and write the complete `herdrWeb.worldLayout.v1` record
through one canonical codec with atomic read-modify-write semantics. Adding or
changing `longRoomTitleMode` MUST preserve `roomAlignment`, and adding or
changing `roomAlignment` MUST preserve `longRoomTitleMode`.

The codec SHALL normalize missing or invalid fields independently, retain valid
sibling fields when another field is malformed, and recover older
alignment-only records by defaulting the title mode to `expand`.

#### Scenario: Alignment changes after title mode is saved

- **GIVEN** a valid record contains `roomAlignment: "left"` and
  `longRoomTitleMode: "compact"`
- **WHEN** the user saves `roomAlignment: "right"`
- **THEN** the persisted record contains `right` and preserves `compact`.

#### Scenario: Title mode changes after alignment is saved

- **GIVEN** a valid record contains `roomAlignment: "center"` and
  `longRoomTitleMode: "expand"`
- **WHEN** the user saves `longRoomTitleMode: "compact"`
- **THEN** the persisted record contains `compact` and preserves `center`.

#### Scenario: Older or malformed records are read

- **GIVEN** storage contains an alignment-only record or a record with one
  malformed field and one valid sibling field
- **WHEN** the codec reads and then writes the settings
- **THEN** the missing/malformed field receives its default while the valid
  sibling is retained; malformed input does not erase the whole record.

### Requirement: Make header measurement stable and accessible

The presentation layer SHALL supply the geometry resolver with a normalized,
already-measured `headerMinWidth`. Measurement SHALL identify the exact
expanded or compact strings used for workspace and host labels, the fixed
icon/action widths, gaps, font family and size token, font-readiness state,
integer rounding rule, and `maximumExpandedRoomWidth` cap.

The presentation layer MUST remeasure after a relevant font/style change and
MUST use the bounded cap before passing the value to geometry. The geometry
resolver MUST remain pure and MUST NOT depend on Pixi font loading or DOM
measurement.

The semantic DOM SHALL expose the full bounded room and host names in a room
heading or equivalent accessible element regardless of rename/close
permissions. Button `title` attributes and hover metadata alone are
insufficient.

#### Scenario: Font readiness changes after initial layout

- **GIVEN** a room was measured using a fallback font
- **WHEN** the declared Office font becomes ready or its style changes
- **THEN** the presentation layer remeasures the normalized header, publishes a
  new layout revision, and updates canvas and semantic DOM together.

## 6. Data and interface contract

This extension adds no new persisted data beyond the parent spec's
`longRoomTitleMode` field. The canonical settings record is:

```ts
type WorldLayoutSettings = {
  roomAlignment: "left" | "center" | "right";
  longRoomTitleMode: "expand" | "compact";
};
```

The layout interface accepts:

- `availableViewportWidth`;
- `minimumLogicalCanvasWidth`;
- `maximumExpandedCanvasWidth`;
- `maximumExpandedRoomWidth`;
- `overflowMode` (fixed to `logical-scroll` in this extension);
- title mode and alignment; and
- bounded generic room descriptors with content items and flow metadata.

It returns one immutable `OfficeResolvedLayout` containing
`resolvedCanvasWidth`, `layoutRevision`, room rectangles, child-item and row
rectangles, header/content/clip/ink bounds, and the style allowances used to
prove containment. All presenters consume this result by reference.

## 7. Privacy and security

No new data, network route, bridge capability, browser permission, or external
dependency is introduced. Settings remain presentation-only and contain no
workspace contents, terminal output, credentials, or provider data.

## 8. Acceptance evidence

- Deterministic geometry tests cover widths below, at, and above the logical
  minimum; expand and compact modes; all three alignments; maximum rooms,
  desks, standing agents, and receptions; long Latin, wide Unicode, and emoji
  labels; every room-action capability combination; synthetic CEO wrapping;
  and finite, non-negative rectangles contained by `resolvedCanvasWidth`.
- Settings tests cover cross-field preservation, alignment-only migration,
  malformed sibling recovery, and atomic read-modify-write behaviour.
- Renderer/World tests compare `layoutRevision`, immutable layout identity, and
  rectangle values between Pixi and DOM presenters after rapid resize and font
  readiness changes; stale overlays are hidden or non-interactive.
- Resize tests prove there are no resize loops and that each settled input
  produces one resulting revision.
- Frontend lint, the full Vitest suite, and the production build pass.
- Exact narrow and desktop screenshots are captured for one supported narrow
  viewport and one desktop viewport; these verify responsive readiness only,
  not final mobile UX.

## 9. Deferred decisions

- Final mobile room composition and breakpoint policy.
- Mobile room navigation, scroll direction, zoom, collapse, and touch-target
  treatment.
- Mobile-specific art density, typography, and overlay presentation.
- Novel future room flows or span policies not listed in this extension.
