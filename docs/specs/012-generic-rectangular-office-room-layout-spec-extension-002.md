# Generic rectangular Office room layout — publication and bounded-failure rules

- **Parent spec:** [`012-generic-rectangular-office-room-layout-spec.md`](012-generic-rectangular-office-room-layout-spec.md)
- **Previous extension:** [`012-generic-rectangular-office-room-layout-spec-extension-001.md`](012-generic-rectangular-office-room-layout-spec-extension-001.md)
- **Spec ID:** `012-generic-rectangular-office-room-layout-extension-002`
- **Status:** Approved
- **Created:** 2026-08-13
- **Owner:** Downstream Herdr World / Office presentation layer
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** Requester
- **Approved at:** 2026-08-13

> This compatible extension closes the remaining contract gaps before
> implementation: pure geometry versus published layout revisions, finite-cap
> failure handling, rectangle containment, downstream ownership, provenance,
> and browser-local settings semantics.

## 1. Purpose

Extension 001 separates viewport and logical-canvas widths and introduces a
shared immutable layout for the Pixi and DOM presenters. It does not yet define
how a pure resolver can coexist with a monotonic publication revision or what
happens when bounded minima cannot fit within bounded maxima. This extension
defines those responsibilities and deterministic failure policies without
changing Herdr, bridge, or upstream contracts.

## 2. Scope

- Separate pure geometry resolution from stateful layout publication.
- Define normalization and ordering for all width/capacity inputs.
- Define emergency ellipsis, content-item omission, priority, and omission
  reasons for bounded-cap failures.
- Make the complete rectangle containment invariant mechanically testable.
- Clarify that this is downstream Herdr World / Office presentation work.
- Require provenance and modified-file notices for Apache-derived Office code,
  while keeping new decoration original and code-native unless separately
  sourced and recorded.
- Define atomic settings preservation as one synchronous read-modify-write
  within a browsing context, without claiming cross-tab transactions.

## 3. Non-goals

- No changes to the approved parent or Extension 001 requirements.
- No Herdr core, upstream workspace, bridge protocol, or identity contract.
- No cross-tab settings transaction protocol.
- No new external artwork or unrecorded adapted assets.
- No change to the deferred final mobile composition.

## 4. Context and constraints

The downstream Office presentation layer has two different kinds of state:
pure geometry derived from normalized inputs and publication state that tells
presenters which immutable result is current. These must not be conflated.

The Office also has finite logical-canvas and room caps. A label or content
item can therefore be too large even after all ordinary layout expansion has
been used. The resolver must return a bounded, inspectable result rather than
producing an impossible width equation, infinite growth, or pixels outside a
room.

The implementation modifies downstream TypeScript adaptations of the
Apache-derived Office geometry/drawing surface. It SHALL follow the existing
provenance and modification-notice requirements in
[`docs/world-assets.md`](../world-assets.md). The CEO Office and Agent Bar are
presentation concepts owned by downstream Herdr World / Office; they are not
Herdr Web core or upstream protocol objects.

## 5. Requirements

### Requirement: Separate pure geometry from layout publication

The implementation SHALL expose two distinct responsibilities:

```ts
const geometry = resolveOfficeGeometry(normalizedInput); // pure
const published = publisher.publish(inputGeneration, geometry); // controller
```

`resolveOfficeGeometry` SHALL be deterministic and side-effect free. It SHALL
NOT retain mutable state, read clocks or randomness, inspect DOM/Pixi state,
perform I/O, or produce externally visible side effects. It MAY allocate the returned
geometry, diagnostics, omission records, and other result objects. It returns
geometry plus its canonical normalized-input digest, normalized diagnostics,
and omission data.

The publication controller SHALL own publication state. `layoutRevision` SHALL
increment if and only if the canonical normalized-input digest differs from the
currently published digest. It SHALL retain the same revision for repeated
publication of the same digest and return one immutable published value
containing the revision, generation identity, validated digest, and geometry.
The controller, not the caller, assigns the revision.

An `inputGeneration` SHALL contain the canonical digest of the complete
normalized input. The digest is the generation identity; the publisher SHALL
retain only the currently published digest and layout, not a history of opaque
generation identifiers. The normalized input MUST include fonts and
font-readiness state, action capabilities, room/content descriptors, title
mode, room alignment, viewport width, logical-canvas minimums/caps, and all
other geometry-affecting inputs. The controller transitions SHALL be:

- repeated `A → A`: no revision increment;
- `A → B → A`, where A and B have different canonical digests: two increments,
  one for each digest transition; and
- a publication request with an identical normalized digest: accepted as a
  no-op publication request, returns the existing immutable published value,
  and does not increment while the current normalized generation is unchanged.

The publisher SHALL validate that `geometry.inputDigest` equals
`inputGeneration.canonicalDigest` before publication. A mismatch MUST be
rejected without changing the current published layout or revision; callers
cannot publish geometry resolved from one input with another generation's
identity.

The controller SHALL separately track mutable `canvasRenderedRevision` state;
that acknowledgement MUST NOT be stored inside the immutable published value.
The DOM overlay MUST be hidden or non-interactive until both the published
`layoutRevision` and controller `canvasRenderedRevision` equal the published
layout revision. Receiving the same object reference alone is not proof that
Pixi has rendered it.

`ackCanvasRendered(revision)` SHALL accept only the currently published
`layoutRevision`. Older acknowledgements and acknowledgements for a future or
unknown revision SHALL be ignored or rejected and MUST NOT change or regress
`canvasRenderedRevision`.

#### Scenario: Identical geometry is published twice

- **GIVEN** a normalized input generation has already been published
- **WHEN** the same generation is requested again without an input change
- **THEN** pure geometry is equal and the controller does not increment the
  layout revision.

#### Scenario: A prior generation becomes current again

- **GIVEN** generations `A` and `B` have been published in that order
- **WHEN** generation `A` is published again with the same canonical digest
- **THEN** the controller increments once for the `B → A` transition rather
  than treating the earlier revision as current.

#### Scenario: Geometry changes before canvas rendering completes

- **GIVEN** the published layout is revision `N` and Pixi has rendered `N`
- **WHEN** a new normalized generation publishes revision `N+1` before Pixi
  reports completion
- **THEN** the DOM overlay remains hidden or non-interactive until
  `canvasRenderedRevision` also becomes `N+1`.

#### Scenario: A stale canvas acknowledgement arrives

- **GIVEN** the current published revision is `N+1` and the canvas has not yet
  acknowledged it
- **WHEN** `ackCanvasRendered(N)` or `ackCanvasRendered(N+2)` is received
- **THEN** the acknowledgement is ignored or rejected, and
  `canvasRenderedRevision` remains unchanged until `ackCanvasRendered(N+1)` is
  received.

#### Scenario: Geometry and generation digests disagree

- **GIVEN** geometry carries `inputDigest: digest-A` and the publication
  request carries `canonicalDigest: digest-B`
- **WHEN** the publisher validates the request
- **THEN** publication is rejected without changing the current layout or
  revision.

### Requirement: Normalize widths, caps, and capacities deterministically

All numeric layout inputs SHALL be normalized before geometry resolution:

- non-finite values use their declared finite default;
- negative finite values normalize to `0`;
- fractional finite values are rounded down to integer logical units;
- missing values use the declared default; and
- normalized values are never allowed to become `NaN`, `Infinity`, or
  negative.

The normalized constants SHALL obey this ordering:

```text
0 <= minimumRoomWidth
  <= maximumExpandedRoomWidth
  <= maximumExpandedCanvasWidth
  and
0 <= minimumLogicalCanvasWidth
  <= maximumExpandedCanvasWidth
  and
0 <= minimumRoomHeight
  <= maximumExpandedRoomHeight
  <= maximumExpandedCanvasHeight
  and
0 <= minimumLogicalCanvasHeight
  <= maximumExpandedCanvasHeight
```

The implementation SHALL define immutable absolute ceilings that normalization
cannot raise. The initial ceilings are:

```text
ABSOLUTE_MAX_LOGICAL_CANVAS_WIDTH  = 4096
ABSOLUTE_MAX_LOGICAL_CANVAS_HEIGHT = 8192
ABSOLUTE_MAX_ROOM_WIDTH            = 2048
ABSOLUTE_MAX_ROOM_HEIGHT           = 4096
ABSOLUTE_MAX_CONTENT_ITEMS         = 128
ABSOLUTE_MAX_LAYOUT_ROWS           = 128
```

Normalization SHALL apply this order:

```text
requested value
  → finite fallback / non-negative floor
  → clamp to its immutable absolute ceiling
  → establish minimum/maximum ordering within that ceiling
  → resolve or report bounded omission
```

If an input cap is below its required minimum, the normalized maximum is
raised only to the already-clamped minimum. If a requested minimum exceeds an
absolute ceiling, the minimum is clamped to that ceiling and content that
still cannot fit is reported as bounded omission; no absolute ceiling is
raised. `maximumExpandedCanvasWidth` and `maximumExpandedCanvasHeight` are
therefore never less than their normalized logical minima, and room caps are
never greater than their corresponding canvas caps.

The fixed header chrome width (icons, actions, gaps, safe insets, and stroke
allowance) MUST be included in `minimumRoomWidth` before text measurement or
emergency ellipsis. Fixed header chrome height, the overflow-marker minimum
width and height, and their safe gaps MUST likewise be included in
`minimumRoomWidth` and `minimumRoomHeight` respectively. The immutable room
ceiling MUST be greater than or equal to the normalized fixed chrome width and
height. If a future style change violates either invariant, normalization SHALL
return `invalid-style-capacity` as a top-level normalization error, not as a
content-item omission reason. The resolver SHALL return a bounded fallback
geometry with decorative/content artwork disabled and an accessible in-bounds
“Office layout unavailable” marker; it SHALL not render normal room content
out-of-bounds.

`maxContentItems` SHALL be a finite integer capacity in the inclusive range
`1…128`. The initial bounded default and hard cap are both `128`; descriptors
may request fewer but not more. Normalization SHALL clamp the effective value
to `1…128`; invalid or missing values use the finite default. The resolver
SHALL return aggregate omission counts and, for
diagnostics, at most eight stable omitted-item IDs per reason/importance. It
MUST NOT return an unbounded list of omitted items.

#### Scenario: Width inputs are malformed

- **GIVEN** a viewport or cap is negative, fractional, `NaN`, or infinite
- **WHEN** the input is normalized
- **THEN** it becomes the documented finite default or non-negative floored
  value, the ordering invariant holds, and the pure resolver receives only
  finite non-negative integers.

#### Scenario: Style capacity is internally inconsistent

- **GIVEN** normalized fixed header or overflow-marker dimensions exceed the
  normalized room minimum/capacity
- **WHEN** the input is normalized
- **THEN** the result reports top-level `invalid-style-capacity`, disables normal
  decorative/content artwork, and provides an in-bounds accessible “Office
  layout unavailable” fallback without emitting an item omission reason.

#### Scenario: Content-item capacity is requested outside its range

- **GIVEN** `maxContentItems` is zero, negative, fractional, non-finite, or
  greater than `128`
- **WHEN** the input is normalized
- **THEN** the effective capacity is an integer in `1…128`, using the finite
  default for invalid/missing values and clamping oversized requests.

### Requirement: Bound vertical growth and row capacity

The resolver SHALL apply `maximumExpandedRoomHeight`,
`maximumExpandedCanvasHeight`, and `ABSOLUTE_MAX_LAYOUT_ROWS` to CEO wrapping,
Agent-Bar expansion, work-room packing, and all bounded content flows. It SHALL
return `resolvedCanvasHeight` and SHALL never grow a room, row set, or canvas
beyond its normalized vertical cap. Content that would require another row or
height beyond those caps receives `canvas-capacity-exhausted` and follows the
required or non-required omission policy.

#### Scenario: CEO content exceeds the vertical cap

- **GIVEN** synthetic CEO content requires more rows than the bounded row or
  canvas-height capacity
- **WHEN** the CEO region resolves
- **THEN** the layout remains finite and rectangular, the Agent Bar receives
  the matching bounded region height, and excess content is represented by
  deterministic omission counts and a required overflow marker when needed.

### Requirement: Define bounded text failure behavior

In `expand` mode, the presentation layer SHALL first measure the full
normalized room and host labels using the declared font/style contract. If the
full measured header cannot fit within `maximumExpandedRoomWidth` after fixed
icons, actions, and gaps, the visual label SHALL use emergency ellipsis to fit
the bounded header rectangle. Emergency ellipsis is a cap-failure fallback,
not a change to the user's saved title mode.

The full bounded room and host names SHALL remain available in semantic DOM
regardless of emergency ellipsis or action permissions.

#### Scenario: An expanded label exceeds the hard room cap

- **GIVEN** `longRoomTitleMode` is `expand` and the full measured header is
  wider than `maximumExpandedRoomWidth`
- **WHEN** the layout is resolved
- **THEN** the visual label uses deterministic emergency ellipsis inside the
  header rectangle, the room remains within its cap, and the full label remains
  in semantic DOM.

### Requirement: Define content-item priority and omission

Every bounded content item SHALL declare `importance` as `required`,
`preferred`, or `optional`, a deterministic declared order, minimum and
preferred dimensions, and a stable id. Numeric priority MAY refine ordering
within an importance class.

Selection order SHALL be: required items in declared order, then preferred
items by descending numeric priority and declared order, then optional items by
descending numeric priority and declared order. Packing SHALL preserve that
selected order within each declared flow.

When a content item cannot be represented within the normalized caps, the
resolver SHALL return an omission record with one of these stable reasons:

- `content-item-count-cap` — the bounded item capacity was reached;
- `required-minimum-exceeds-room-cap` — a required item cannot fit the maximum
  room width or height;
- `non-required-minimum-exceeds-room-cap` — a preferred or optional item
  cannot fit the maximum room width or height;
- `canvas-capacity-exhausted` — the bounded canvas cannot provide another
  permitted row/region; or
- `invalid-content-descriptor` — one or more mandatory descriptor fields are
  malformed after normalization, regardless of item importance.

Required items MUST NOT be silently dropped. Every omitted required item,
including items omitted for count capacity, invalid descriptors, room-capacity,
or canvas-capacity reasons, SHALL activate a bounded accessible overflow marker
inside the room's content-safe rectangle. If a required item exceeds the room
cap, it is returned as an omitted required item with the corresponding reason.
Preferred and optional items MAY be omitted according to the stable reasons
above. The result SHALL include aggregate counts grouped by reason and
importance plus only the bounded stable-ID samples described above.

`invalid-content-descriptor` means that one or more mandatory descriptor fields
are malformed after normalization, regardless of the item's importance. The
mandatory fields are stable id, importance, declared order, and finite
non-negative minimum width and height. `invalid-style-capacity` is not an item
omission reason; it is the top-level normalization error and fallback state
defined above.

#### Scenario: Content exceeds the item capacity

- **GIVEN** a descriptor contains more than `maxContentItems` items
- **WHEN** the resolver selects content
- **THEN** the first items selected by the declared importance/priority/order
  policy receive rectangles, later items receive
  `content-item-count-cap`, and the result exposes deterministic omission
  counts and bounded ID samples without growing beyond the canvas cap.

#### Scenario: A required board exceeds the room cap

- **GIVEN** a required content item has a minimum width greater than
  `maximumExpandedRoomWidth` or a minimum height greater than
  `maximumExpandedRoomHeight`
- **WHEN** the resolver resolves its region
- **THEN** it returns the item with
  `required-minimum-exceeds-room-cap`, places a bounded accessible overflow
  marker inside the room, and emits no out-of-bounds item pixels.

### Requirement: Enforce nested rectangle containment

For every room and resolved content item, the general invariant SHALL be:

```text
inkBounds ⊆ clipRect ⊆ outerRect
```

The invariant includes furniture, labels, borders, shadows, decorative boards,
and selection treatment. `wallRect`, `headerRect`, and `contentSafeRect` SHALL
also be finite, non-negative, and contained by `outerRect`; their named
allowances MUST be included when calculating `inkBounds`.

#### Scenario: A decoration or shadow reaches a room edge

- **GIVEN** a room is rendered at a minimum or cap-limited size
- **WHEN** its visible bounds are calculated
- **THEN** `inkBounds` remains wholly inside `clipRect`, and `clipRect` remains
  wholly inside `outerRect`; the renderer does not rely on an adjacent road or
  room to hide overflow.

### Requirement: Preserve downstream ownership and provenance

The implementation SHALL identify this work as downstream Herdr World / Office
presentation code. It MUST NOT add CEO Office or Agent-Bar concepts to Herdr
core, upstream workspace state, or bridge protocol contracts.

Any modified Apache-derived geometry or drawing file SHALL retain or receive a
prominent modification notice satisfying the existing Apache-2.0 Section 4(b)
requirements and SHALL remain covered by the provenance record in
`docs/world-assets.md`. New room decoration SHALL be original code-native work
unless an asset is separately sourced, licensed, hashed, and added to the
provenance record.

#### Scenario: The implementation adds a wall board

- **GIVEN** a new wall board is needed for the visual style guide
- **WHEN** it is added to a room
- **THEN** it is implemented as original code-native geometry or receives the
  required explicit provenance; no uncredited external artwork is introduced.

### Requirement: Scope settings atomicity to one browsing context

“Atomic read-modify-write” SHALL mean one synchronous preserving update of the
complete `herdrWeb.worldLayout.v1` record within one browsing context: read the
current record, independently normalize sibling fields, merge the requested
field, and perform one `localStorage.setItem`.

The contract MUST NOT claim cross-tab transactional atomicity. Cross-tab
conflict detection, locking, or reconciliation requires a later approved
extension.

#### Scenario: One setting changes while its sibling is valid

- **GIVEN** the current browsing context stores valid alignment and title-mode
  fields
- **WHEN** one field is changed
- **THEN** one synchronous read-modify-write preserves the unchanged sibling and
  writes the normalized complete record.

## 6. Data and interface contract

The pure geometry function accepts normalized width/capacity inputs and
bounded descriptors and returns deterministic geometry, child rectangles,
containment bounds, omission records, top-level normalization diagnostics, and
the canonical `inputDigest` for the normalized input. It does not return a
monotonic revision and does not retain publication state.

The stateful publication controller accepts a normalized-input generation and a
pure geometry result whose `inputDigest` it validates against the generation's
canonical digest. It returns an immutable layout with:

- `layoutRevision`;
- the normalized width/capacity values;
- room, row, and content-item rectangles;
- nested wall/header/content/clip/ink bounds; and
- omission counts and stable reasons.

The controller separately exposes mutable `canvasRenderedRevision` state and
`ackCanvasRendered(revision)`; neither is a field of the immutable published
layout. Acknowledgements are accepted only for the currently published
revision and never regress the acknowledgement state. The normalized input also
includes `minimumLogicalCanvasHeight`, `maximumExpandedCanvasHeight`,
`minimumRoomHeight`, `maximumExpandedRoomHeight`, and the bounded row/count
limits. Vertical growth MUST stop at the normalized canvas-height cap or row
cap; content that cannot be represented receives `canvas-capacity-exhausted`
and follows the required or non-required omission policy.

`invalid-style-capacity` is a top-level normalization diagnostic. When present,
the published fallback contains only bounded accessibility/status content and
does not claim that normal room items were omitted.

The browser-local settings codec remains the complete versioned
`WorldLayoutSettings` record from Extension 001. Its one-context update
operation is synchronous and preserving; no cross-tab guarantee is implied.

## 7. Privacy and security

No new data, network route, bridge capability, browser permission, or external
dependency is introduced. Omission diagnostics contain presentation metadata
only and do not expose workspace contents, terminal output, credentials, or
provider data.

## 8. Acceptance evidence

- Pure resolver tests prove deterministic output for identical normalized
  inputs, permitted result allocation, no retained mutable state, and no
  revision side effects, including a matching canonical input digest.
- Publication-controller tests prove one revision per canonical digest,
  stable repeated publication, `A → B → A` transitions beyond the old
  retention boundary, rejection of digest-mismatched geometry, and separate
  canvas-rendered revision gating including stale and future acknowledgements.
- Normalization tests cover negative, non-finite, fractional, invalid ordering,
  immutable horizontal and vertical absolute ceilings, row/count caps, and
  `maxContentItems` inputs plus top-level `invalid-style-capacity` fallback;
  style-capacity tests include fixed header width/height and overflow-marker
  width/height requirements.
- Text tests cover expand-mode emergency ellipsis and full semantic labels.
- Content tests cover required/preferred/optional ordering, all omission
  reasons, required overflow markers for every required omission path, bounded
  aggregate counts, and stable ID samples.
- Geometry tests prove `inkBounds ⊆ clipRect ⊆ outerRect` for rooms and content
  items, including shadows, selection strokes, and decoration.
- Settings tests prove one-context synchronous preserving updates and make no
  cross-tab atomicity claim.
- Provenance checks verify modified-file notices, source/hash records, and
  original code-native decoration policy against `docs/world-assets.md`.
- Frontend lint, the full Vitest suite, production build, and exact narrow and
  desktop screenshots pass after implementation.

## 9. Deferred decisions

- Cross-tab settings conflict handling.
- New composition flows or span policies beyond those approved in Extension
  001.
- Final mobile room composition and interaction.
