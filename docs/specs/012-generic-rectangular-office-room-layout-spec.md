# Generic rectangular Office room layout

- **Spec ID:** `012-generic-rectangular-office-room-layout`
- **Status:** Approved
- **Created:** 2026-08-13
- **Owner:** Herdr Web / Office
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** Requester
- **Approved at:** 2026-08-13

> This contract expands the original title-overlap fix into a reusable rectangular
> room layout and visual-style contract. It addresses the reported room-header
> and reception-boundary overlaps while making the CEO Office, work rooms, and
> Agent Bar explicit room roles with different layout precedence.

## 1. Purpose

Long workspace and host names currently extend beneath the room rename and
close controls because room widths are derived from seat content alone. The
Office also has a fixed CEO/Agent-Bar composition that treats future CEO
boards as an afterthought. The Office SHALL use generic rectangular room
geometry, keep room-title text and room actions readable, keep every visual
element inside its owning room, and allocate space according to room role and
precedence. A small shared visual style guide SHALL make those boundaries and
layering rules explicit so future room types do not invent incompatible
spacing, wall, shadow, or decoration behaviour.

## 2. Scope

- Define a generic rectangular `OfficeRoom` presentation contract with a role,
  bounded content minimum, header minimum, preferred size, and layout
  precedence. The initial roles are `ceo`, `work`, and `agent-bar`; future
  room roles SHALL be able to use the same contract.
- Define an Office visual style guide for room walls, borders, header bands,
  decorative wall boards, furniture shadows, spacing, safe insets, and canvas
  layer order. The guide SHALL be expressed as reusable geometry/style tokens
  rather than room-specific magic offsets.
- Measure every room header from its rendered title, host context, and action
  controls. A work-room minimum SHALL include its title, host, rename/close
  controls, and `+` new-seat action when that action is available.
- Keep room headers, action controls, and room-local actions inside their
  rectangular room bounds at every supported viewport width.
- Keep the complete visual footprint of room contents inside its room bounds,
  including furniture, shadows, labels, selection strokes, and decorative
  wall boards. A decorative element SHALL be clipped, inset, or bounded by its
  owning room rather than changing the room into a non-rectangular shape.
- Make the CEO room elastic and primary: it may add board/control rows when
  its content exceeds the width available beside the Agent Bar, and its
  rectangle grows vertically to contain those rows.
- Give work rooms the next precedence after CEO content. Work rooms SHALL use
  independent rectangular rows, retain title-safe and desk/`+` minimums, and
  pack without overlap below the CEO region.
- Treat the Agent Bar as lower-precedence and fluid: it SHALL retain at least
  the Party board and one agent, may yield horizontal space to CEO content,
  and SHALL grow vertically to match the CEO rectangle when CEO content adds
  rows. Its counter/table may extend vertically; it SHALL remain rectangular.
- Add a browser-local Office layout preference for long-title handling:
  `expand` (default) permits rows to grow to title-safe width; `compact`
  keeps the responsive width cap and ellipsizes visual titles while retaining
  accessible full-name labels and title metadata.
- Preserve existing room alignment, seat geometry, room caps, and host/bridge
  command behavior.

## 3. Non-goals

- No Herdr protocol, workspace identity, or bridge command changes.
- No change to room title data, title sanitization, or host display labels.
- No polygonal or free-form room shapes. Every room remains a quadrilateral
  rectangle, including the CEO room, work rooms, and Agent Bar.
- No persistence of canvas geometry, terminal state, or provider data beyond
  the existing browser-local Office layout preference scope.
- No mobile-specific room composition or a free-form pixel-width editor.
- No requirement to implement future board types in this slice; the CEO
  content model only needs to support bounded row wrapping for future boards.

## 4. Context and constraints

The approved Office productivity contract already requires room widths to be
derived from content and to avoid overlap. The current renderer uses a Pixi
canvas for room geometry and a DOM overlay for rename/close/new-seat actions.
Both must consume the same resolved room rectangles. Display labels remain
bounded by the existing projection; the layout must remain bounded by the
viewport and the existing room/seat limits.

`expand` is the default because it preserves the full visible title when the
row has room. `compact` is an explicit operator preference for dense layouts;
it may shorten only the visual title and MUST retain the full accessible name.

The CEO room is the primary rectangular composition. Its content receives the
available horizontal space after the Agent Bar's minimum footprint is
reserved. If the CEO content needs more rows, the CEO rectangle grows in
height; the Agent Bar follows that height rather than forcing the CEO content
to clip or become polygonal. Work-room packing begins below the completed CEO
rectangle.

The visual style guide is part of the presentation contract, not a separate
source of geometry. It SHALL define a consistent wall treatment for all room
roles, with small wall boards available as bounded decoration where they help
the room read as an intentional space. Decorative boards must never consume
the minimum content area or extend beyond the room rectangle.

## 5. Requirements

### Requirement: Model rooms as generic rectangles

The Office SHALL resolve all visible room types through one bounded rectangular
room model with role-specific content and precedence policies.

#### Scenario: A future room role is added

- **GIVEN** a future room supplies a bounded header and content minimum
- **WHEN** the Office layout resolver receives that room role
- **THEN** it can place the room using the generic rectangle contract without
  changing existing room identity, bridge commands, or canvas/overlay routing.

### Requirement: Keep room headers inside their rooms

The Office SHALL ensure that the room title background, workspace/host labels,
rename control, and close control fit within the resolved room rectangle with
their required spacing and without overlap.

#### Scenario: A room has a long workspace and host title

- **GIVEN** the room title is longer than the current seat-derived room width
- **WHEN** the Office resolves and renders the room
- **THEN** the room width expands to the title-safe minimum, or the title is
  compacted according to the saved preference, and the action controls remain
  readable and separate from the title.

### Requirement: Keep room decoration inside its rectangle

The Office SHALL apply the visual style guide's safe insets and layer order to
all room furniture and decoration. Shadows, selection strokes, labels, and
wall-board decoration SHALL not visibly cross the room boundary or overlap an
adjacent room/road when the owning room is rendered at its minimum or expanded
size.

#### Scenario: A reception station is at the CEO Office boundary

- **GIVEN** the final reception station is rendered near the CEO Office edge
- **WHEN** its table, chairs, shadow, label, and selection treatment are laid
  out
- **THEN** the complete visible footprint remains inside the CEO Office
  rectangle, with the existing inward offset treated as a geometry constraint
  rather than a best-effort visual adjustment.

#### Scenario: A room uses decorative wall boards

- **GIVEN** a room style includes small wall-board decoration
- **WHEN** the room is rendered at its minimum width and height
- **THEN** each board stays within the wall safe inset, remains behind room
  content in the declared layer order, and does not reduce the room's content
  minimum or overlap an action control.

### Requirement: Apply one visual style guide across room roles

The Office SHALL use shared style tokens and layer rules for all rectangular
rooms while allowing bounded role-specific accents. The guide SHALL define at
least the room wall/border treatment, header placement, content safe inset,
shadow extent, decoration layer, interactive layer, and spacing relationship to
the road between rooms.

#### Scenario: A future room role is added

- **GIVEN** a future room supplies its role accent and content descriptors
- **WHEN** it is rendered through the generic room contract
- **THEN** it inherits the shared wall, safe-inset, shadow, layering, and
  spacing rules without copying room-specific pixel offsets.

### Requirement: Prioritize the CEO room

The Office SHALL allocate the CEO room before lower-precedence content. The CEO
room SHALL retain its minimum board/control footprint and Agent Bar SHALL yield
space down to its Party-board-plus-one-agent minimum before CEO content is
clipped or hidden.

#### Scenario: CEO content needs more horizontal space

- **GIVEN** the CEO room contains boards whose combined minimum width exceeds
  the space beside the Agent Bar
- **WHEN** the Office resolves the CEO region
- **THEN** the Agent Bar contracts only to its minimum, CEO content wraps into
  additional rows, and the CEO remains a complete rectangle.

### Requirement: Let CEO height drive the Agent Bar

The Agent Bar SHALL remain a rectangle whose height is at least its own content
minimum and at least the resolved CEO room height. Its table/counter and agent
slots MAY extend vertically to fill that height.

#### Scenario: CEO content wraps to a second row

- **GIVEN** the CEO room adds a board/control row
- **WHEN** the layout is resolved
- **THEN** the CEO room height increases, the Agent Bar expands to the same
  region height, and no content is clipped or rendered as a polygon.

### Requirement: Preserve responsive work-room packing

The Office SHALL derive each work room's width from the maximum of its desk,
standing, title-safe header, and available `+` action minimums, then pack rows
below the CEO region using the existing room gap and alignment rules.

#### Scenario: A title-safe room is next to ordinary rooms

- **GIVEN** one room needs extra header width and neighboring rooms do not
- **WHEN** the layout is resolved
- **THEN** the wide room occupies only the required row space, later rows remain
  independently packed below the completed CEO rectangle, and no room
  boundaries overlap.

### Requirement: Provide bounded long-title preference

The Office settings layout section SHALL expose `Expand long room titles` and
`Compact long room titles` options, defaulting to `Expand long room titles`.
The preference SHALL be stored per browser profile and SHALL not alter Herdr
workspace names.

#### Scenario: User chooses compact title handling

- **GIVEN** the user selects `Compact long room titles` in Office settings
- **WHEN** the user saves and returns to the Office
- **THEN** long visual titles use bounded ellipsis where needed, the full title
  remains available to accessible text/hover metadata, and room rows stay
  within the responsive width cap.

### Requirement: Keep settings and canvas state consistent

The Office SHALL apply the saved long-title preference to both the Pixi room
geometry and the DOM room-action overlay in the same render/update cycle.

#### Scenario: User changes the preference while rooms are visible

- **GIVEN** the Office contains at least one long-title room
- **WHEN** the preference is saved
- **THEN** the canvas room header and its rename/close controls move together,
  and no stale overlay remains at the previous room position.

## 6. Data and interface contract

The browser-local layout preference record SHALL remain versioned and bounded.
It MAY add a field such as `longRoomTitleMode: "expand" | "compact"` to the
existing `herdrWeb.worldLayout.v1` record without changing bridge or Herdr
protocols. Invalid or missing values SHALL normalize to `expand`.

The geometry resolver SHALL accept bounded room descriptors rather than raw
Herdr protocol objects. A descriptor contains a role, title/header minimum,
content minimum, preferred width/height, and bounded action requirements. The
resolver returns rectangular room rectangles and a CEO-region layout with:

- CEO content rectangle;
- Agent Bar rectangle;
- work-room rectangles;
- row/column placement and alignment; and
- bounded overflow/omission counts when content exceeds limits.

The resolved room rectangles remain the single source for canvas and overlay
positioning.

The visual style contract SHALL expose bounded presentation tokens for room
padding, header safe inset, wall-board bounds, furniture shadow bounds,
selection-stroke allowance, room-to-road gap, and layer order. These tokens are
presentation-owned and MUST be applied consistently by the Pixi renderer and
any DOM overlay that participates in the room presentation.

## 7. Privacy and security

- The setting stores only a presentation preference, never workspace contents,
  terminal output, credentials, or provider configuration.
- Full accessible title text uses the existing bounded display labels.
- No new network route, bridge capability, command, or external dependency is
  introduced.

## 8. Acceptance evidence

- Geometry tests prove generic rectangular room descriptors, title-safe minimum
  widths, compact-mode caps, CEO precedence, CEO row wrapping, Agent Bar
  vertical expansion, work-room row packing, and no overlap between room
  rectangles.
- Geometry/style tests prove that reception tables and their shadows stay inside
  the CEO rectangle, room decoration respects safe insets, wall boards do not
  consume content minimums, and room layers remain behind interactive controls.
- Settings tests prove persistence, defaulting, and invalid-value recovery.
- Renderer/World tests prove the canvas and DOM overlay use the same room rects
  after a preference change.
- Frontend lint, full Vitest suite, and production build pass.
- Manual responsive smoke checks cover long-title work rooms, CEO row wrapping,
  Agent Bar expansion, and narrow/desktop Office widths.

## 9. Deferred decisions

- A numeric user-defined room width or typography scale.
- Per-room title overrides.
- Automatic title abbreviation beyond the `compact` bounded mode.
- Additional room roles beyond CEO, work, and Agent Bar.
- Rich room-specific decoration or bespoke wall-board artwork beyond the shared
  style-guide treatment.
