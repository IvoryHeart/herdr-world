## Context

See [the proposal](proposal.md) for the selected outcome. The Office study used
synthetic browser-local data and simplified drawing. It established the preferred
scroll direction; it did not exercise production Pixi preparation, terminal
ownership or input latency.

Production Office currently bounds its projection to 128 rooms, eight desks and
sixteen room agents, with separate reception, pane-art and canvas geometry limits.
Its minimum logical width is 1000 pixels. Existing visibility admission filters
whole rooms vertically and receptions horizontally; a single visible large room
can therefore still prepare all its content. Removing only the eight-desk slice
would leave other truncation and resource limits in place.

The relevant current contracts are Pixel Office scene, Office pane-linked devices,
Office reception capacity, Office state and room operations, and Office creation
affordances follow operational capacity. Preserve the shared creation contract;
the older Room Full wording in state/room operations must be reconciled with it.

## Goals / Non-Goals

The design separates complete admitted topology and logical geometry from a
bounded paint/control window. It preserves connection-qualified identities and
the existing renderer, artwork, scheduler and shell-owned interactions.

Graph, Tree, service observation limits, runtime protocols, desktop Inspector
policy and terminal transport are outside this change. No new rendering library
or generic scene engine is needed. Four physical device drawings per desk can
remain an artwork choice because every pane remains available through its exact
chooser target; it must not become a pane or agent access limit.

## Decisions

### One vertical phone scene

Resolve a phone-specific scene layout inside the existing Office renderer. Lay
out receptions with waiting/completed agents needing attention first, then the
Economy board, the existing Workforce counts and workspace rooms. Hide empty
receptions on phones. Preserve host order among attention receptions and qualified
identity when attention changes; an empty attention group leaves Economy first.
All sections fit the phone's usable width. Economy and Workforce use the same
free-rectangle packing as other Office footprints: their width derives from the
usable area, sharing a row when both retain readable content, otherwise wrapping
vertically. Artwork uses those published widths without shrinking text, and the
lobby height follows the packed boards rather than a desktop minimum.
Use two readable desk columns where space permits and add rows rather than
shrinking all furniture to fit. Long titles wrap or compact within their headers;
full names and rename/close controls stay reachable.

Remove only the phone's decorative CEO room. Keep host health, waiting/completed
agent access and idle-agent access in the reception/status controls and existing
qualified chooser. An absent expense provider displays an honest unavailable state.
Desktop retains its CEO, receptions, Agent Bar, roads and independently sized
workspace rooms. Desktop room placement uses the fluid packing described below.

The owner compared both axes and selected vertical. A horizontal workspace strip,
sideways reception carousel and nested per-room scrollboxes are rejected for the
phone flow because they introduce a second navigation direction.

### Complete logical rooms with bounded rendering

Project all workspace rooms, tabs and room-destination agents in the admitted
filtered World observation. Preserve tab order and stable qualified keys; status
changes move agent characters without reordering their desks. Keep exact observed,
unavailable and omitted-observation distinctions. This is not a promise to invent
topology that the World service has not observed.

Calculate desk and standing rows from actual counts. Replace scene-owned room,
desk and agent totals, not just their current numeric values. A new tab adds a
desk and, when needed, another row. Multiple panes or agents in one tab keep one
tab desk, distinct pane targets and the established deterministic seated agent;
additional room agents obtain standing geometry. Rooms size independently.

Preserve hard limits on physical canvas dimensions, texture backing and individual
preparation batches. Render a viewport window with small overscan, admitting room
row segments and reception content by both axes. Do not create one enormous room
texture, enumerate all desk controls every frame, or let a tall intersecting room
admit its entire contents. Full logical extent and indexed reveal stay separate
from the small Pixi/control window. If native scroll-coordinate limits are met,
rebase the rendered window and retain indexed access rather than truncating the
logical roster or allocating an oversized surface.

### Fluid desktop room shape and packing

The wide-screen review exposed two independent constraints: shared row height left
large holes beside a 100-tab room, and the four-column grid forced that room to
remain tall. Replace both in the production desktop layout. Phone ordering stays
vertical and the bounded legacy geometry API retains its existing callers.

For desktop rooms, consider readable desk-column counts that fit the usable
width, preserving nearby space for another readable room where possible. Prefer
balanced room aspect ratios and fewer empty desk slots; standing rows derive from
the resolved width. Small rooms keep readable furniture spacing and can use another column when it
reduces depth without wasting desk slots. This is a
bounded deterministic heuristic, not a claim of globally optimal packing.

Choose room shape and placement together. Compare two completed building searches:
one prefers compact height, while the other also retains aligned room boundaries.
Choose the lower completed height; equal-height fits prefer fewer fragmented
vertical bands before minimizing empty desk slots. This prevents a locally cheap
five-desk strip from defeating a 3×2 room and a 4×1 neighbour below it. Enumerate readable desk-column counts
within the building's usable width, deriving standing rows and minimum title/action
bounds for each candidate. A bounded beam retains eight partial layouts in logical
room order. For each next room, consider its legal shapes at the origins of maximal
free rectangles, ranking resulting scene height, unused desk capacity and wasted
floor area with deterministic coordinate tie-breaks. Reserve corridor gaps in the
footprints, split intersected free rectangles and prune contained ones. Unlike an
outer contour alone, these free rectangles retain cavities under bridging rooms
for later rooms to fill. Qualified source indices and roster order remain stable.

Use the same free-rectangle kernel for building placement with fixed footprints and
a single branch. Keep the preliminary whole-World size estimate on its lightweight
contour pass; it does not choose published room positions. Detailed shape fitting
runs inside each host with the existing cooperative host handoffs. A 32,768-room
synthetic preparation check identified and removed an expensive global search pass;
production responsiveness remains the acceptance test, with unchanged budgets.
Phone rooms retain their vertical flow and readable fixed-width desk grid. This is
bounded heuristic search, not a global optimality guarantee or an item-count cap.

Keep qualified identities and roster order independent of spatial placement. On
refresh/resize anchor to the nearest visible room header, preserving negative
header offsets when the viewport begins in a corridor, and translate a desk or
standing row through its logical item index when column counts change. Physical
surfaces, row paint and controls still follow the viewport; admission evidence
scales with viewport area rather than a fixed count chosen for the old sparse grid.

### Nested host buildings and host collapse

The owner selected named host containers, host-level collapse and the same packing
algorithm at both levels. Resolve readable, content-derived building widths from
room area and available width. The wide-screen review exposed unused horizontal
space from independently favoring compact building aspect ratios. Allocate a shared
width budget to the next hosts whose readable minimum footprints fit, distributing
remaining width by content area up to each building's useful content width. Collapsed
and tiny buildings stay compact; larger buildings consume spare width when their
rooms can use it. These width budgets do not impose shared row heights: the same
free-rectangle packer still places independent footprints into available openings.
Run joint room-shape packing inside each building, then the same kernel over
building footprints. On phones, stack full-width buildings
vertically after Workforce. Keep the reception/CEO/Agent Bar composition separate.

Render a cutaway pixel-art building with a stepped roof, brick courses, side
pillars and a framed wooden sign board, using the existing office furniture
palette. The sign retains connection/stale state, room/agent counts and attention
count. The sign is a native accessible button over matching painted geometry,
with a minimum 48-pixel touch height; its focus outline stays visible. Prepare only
visible pillar courses rather than enumerating a tall building's full brickwork. Headers and room targets share the published
layout and completed-paint readiness. Header controls follow the viewport, retaining
an eligible focused host header through repaint and collapse. Collapse is local
presentation state keyed by qualified host identity; it does not change observation,
operational authority, native work or Inspector ownership. It hides its room paint,
anchors and controls while preserving complete rosters and each room's collapse set.
Navigation expands the exact required host/room before revealing a target.

Geometry retains source indices and explicit host membership; equal labels never
define ownership. Yield between host layout preparations and cancel superseded
requests before publication. Empty hosts still have truthful summary headers.
This remains a bounded deterministic heuristic; it does not claim globally optimal
packing or replace host/runtime admission and stale-generation fences.

### Materials distinguish buildings from their surroundings

Building interiors use continuous slate woven carpet, including the space between
rooms. Workspace floors use quiet carpet tiles with a muted host tint; identity
accents remain on room headers, furniture and trim. Activity changes floor tone
only subtly so characters and state badges carry attention. Reception/common
areas and the Agent Bar use warm wood planks, matching existing furniture and
wooden/blackboard signs. Brick façades, stone caps and curbs separate interiors
from asphalt streets. Street lane markings appear only outside buildings; the
public lobby's internal passage is carpeted too. The phone's reception, Economy
and Workforce section shares the wood floor without restoring a decorative CEO.

Use small renderer-owned repeating nearest-pixel material textures, shared by a
bounded material/theme palette. Each floor is one exact clipped rectangle, even
at fractional origins and on very tall buildings. Do not prepare per-cell paths,
allocate a texture as large as a logical floor or let an edge tile protrude into
a corridor. Keep viewport preparation, painting and physical backing admission.
The older checker helper retains its pixel-equivalence regression independently
of the new production materials. Browser evidence covers material containment
at DPR 1/2 and constant drawing work for large logical areas.

### Reach later rooms without traversing a giant room

Reuse the existing shell Office search for room/agent navigation with bounded
paged results and support per-room collapse. Remove the separate Rooms / Receptions /
Agents row on desktop and phone so the scene gains its height. Room search expands
the qualified host/room and reveals it without opening another Inspector; agent
search keeps idle-agent terminal access reachable. A collapsed room retains its qualified header and truthful item counts.
Choosing a target expands it if necessary, reveals the correct logical row and
then admits its semantic target before focus or activation. Collapse changes only
presentation; it does not close tabs, change agent state or dismiss Inspectors.

Preserve the visible room/row anchor across observation refreshes and additions
above it. Validate stored state, distinguish phone/desktop layout anchors and
safely fall back from legacy raw scroll coordinates. Switching layouts must not
restore a phone onto an offscreen decorative desktop region.

### Keep operational and visual ownership aligned

Reuse current qualified targets, room actions, creation coordination and readiness
fences. The canvas and semantic window consume the same published geometry.
Retain focused controls when appropriate, and reveal before admitting offscreen
selection. Do not draw a connector to an unpainted target. A stale or replaced
generation remains non-actionable even if its old geometry is still cached.

Creating a ninth or later tab uses the existing prepared source and terminal
completion path. A room's new logical desk is revealable without using a stale
hit target during layout preparation. Renderer capacity never disables creation.

## Interaction study: host focus and arranging (proposed, not implemented)

The graphical building treatment above is part of the current implementation.
The following interactions are a design recommendation prompted by the owner;
they are not implemented or acceptance claims for this PR. Review them before
changing scope, contracts or implementation tasks. Graph remains parked.

### Reach a host without scrolling through every building

| Option | Behaviour | Assessment |
| --- | --- | --- |
| Focus a host | A reception sign's explicit Focus host action shows just its building in Office; All hosts restores the overview. | Recommended first: directly addresses reaching a host among large buildings. |
| Bring to front / pin | Move a host earlier in the packed layout, retaining all other buildings. | Useful later for a preferred order; still leaves a long scene. |
| Free placement | Drag buildings anywhere in a persistent two-dimensional world. | Most like a building game, but arbitrary coordinates conflict with responsive packing and the accepted vertical phone flow. |

Keep agent clicks at reception available for inspection. Do not make one
unlabelled desk click ambiguously inspect, collapse, hide or reorder. Give the
reception's host sign a visible Focus host action; on a phone, use an explicit
button without depending on hover, double-click or a context menu. Collapse on
the building sign remains a distinct action: it keeps a host summary in the
current overview, whereas focus scopes the displayed workspace buildings.

In focused mode, a persistent Office host switcher displays Focus: <host>, other
admitted hosts with attention badges, and All hosts. It must include hosts whose
receptions are absent because they have no attention. Keep attention access to
other hosts visible without repeating every full reception inside focused mode.
A tap on another host switches directly and reveals its building or last room
without making the user traverse shared panels first. All hosts restores the previous overview
scroll anchor; each host can retain its own qualified room/row position. System
Back and Escape should leave focus before leaving Office. Focused mode follows the
phone's vertical layout; it does not introduce a swipe carousel.

The current shared Hosts filter affects multiple views. Prefer a separate Office
focus inside that admitted scope so visiting a building does not silently change
Desk, Graph, open Inspectors or an operation's captured owner. Label Economy and
Workforce scope explicitly: keep their current admitted-host totals unless a
truthful host-specific observation is available. Do not relabel aggregate cost as
host cost. Keep stale/offline buildings browsable but non-actionable; a disappearing
focused profile returns to the admitted overview with an explanation. Equal host
labels must never substitute for qualified keys.

### Make arrangement playful without making ordinary clicks unpredictable

Recommend an explicit Arrange mode after host focus is accepted. Normal mode
retains current selection, activation and vertical scrolling. Arrange mode exposes
handles, a lifted pixel-art ghost, valid placement previews and a short snap on
drop. A visible Done control exits; Escape or a cancel gesture abandons the active
drag. Provide Move earlier / Move later or choose-position alternatives for touch
and keyboard, with the scoped undo/reset behaviour described below. Avoid requiring a phone long-press
anywhere on a working terminal or agent.

The owner clarified what movement means at each level:

| Object | Meaning of a move | Owner |
| --- | --- | --- |
| Building / reception | Reorder hosts visually; no host or runtime migration. | Herdr World presentation preferences, keyed by qualified host identity. |
| Room | Reorder the corresponding workspace within its host. | Herdr workspace order. |
| Desk | Reorder its tab within the room, or move that tab into another workspace on the same host. | Herdr tab/workspace membership and order. |
| Agent | Stay attached to its desk, screen or pane and move with that underlying item. | Observed pane/terminal relationship; no independent character move. |

Reuse the adaptive packer for the visible result. Moving a building changes host
presentation order and re-packs its footprint. Reception signs use the same host
order; phone attention receptions remain first, with preferred host order applied
within that group. Hosts without attention remain available in the host switcher.
A room drag requests Herdr workspace reordering, and a desk drag requests tab
reordering or a tab transfer. Room and desk order must then come from refreshed
native state so the Office, sidebar and other clients do not disagree. Preserve
readable sizes, no overlaps and a stable qualified room/row scroll anchor through
re-packing. Avoid reordering all buildings on every status update.

### Native operation integration and drop behaviour

The current implementation already exposes `workspace.move` through
`store.moveWorkspace` and uses it in WorkspaceTree. Office room projection already
sorts by observed workspace number. Add the qualified connection/generation-aware
workspace-move entry point before wiring aggregate Office drops; the current
ambient-focus helper alone is not sufficient for rooms on another host.

Within-workspace tab reordering already uses `tab.move` with insert-before-index
semantics and advertised capability checks. The qualified store context exposes
`moveTab`, and TabBar uses the existing reorder/index helpers. Reuse that path for
moving a desk within its room. Current World calls pass only tab ID and insertion
index: they do not expose a destination workspace for cross-room transfer. Verify
the runtime's supported transfer operation and capabilities before designing that
adapter. A tab transfer must preserve its panes, running processes and attached
agents; closing and recreating a tab is not an acceptable substitute. Do not
advertise a valid cross-room drop until the destination operation is supported.
Cross-host workspace/tab migration is outside the clarified arrangement scope.

While dragging, show the source host/room and the destination room/insertion
position, plus a ghost for the whole desk with its screens and attached agents.
An individual character is not a separate draggable work item. Keep truthful agent
status destinations: a tab transfer must not fabricate a working state for an
agent currently needing attention. The underlying tab/pane association determines
which room its work belongs to even when its character is at reception.

A valid native drop commits the captured qualified operation once, marks that
placement pending, and reconciles it with the authoritative observation after
completion. No new modal is needed for each ordinary reorder. Cancel before drop
has no native effect. If a connection retires, a target disappears, the operation
fails or the result becomes uncertain, refresh and show the authoritative position
with an explanation; never replay the operation on another connection or treat a
visual ghost as a completed move. Keep Inspectors attached to their exact panes
and reconcile any native identity change from observed results.

Undo for host ordering is local. Undo for a native move must be a supported inverse
operation against current topology, not restoration of an old snapshot. Reset
layout resets World presentation preferences only; it must not silently reset
Herdr workspace/tab order. Provide equivalent move controls for touch and keyboard
and keep dragging distinct from normal vertical scrolling.

Before implementation, compare the focus flow and Arrange mode with synthetic
phone/wide-screen interactions, including returning from a distant host, receiving
attention on another host, keyboard/touch cancellation, workspace reorder and tab
transfer failures, resize, new/removed items and connection retirement during a
drag. Keep visual host preferences separate from native order and membership, and
bound preview/animation work to the viewport. Host focus, host ordering, native
workspace/tab reordering and supported tab transfer can be reviewed in that order;
this candidate implements none of those new interactions.

## Risks / Trade-offs

- Tall rooms increase travel to later rooms → fixed room navigation and optional
  collapse, without a second scroll direction or hidden item-count cap.
- Large retained scenes can freeze cold preparation or terminal input → row-level
  paint/control admission, existing cooperative batches, viewport texture budgets,
  and unchanged production responsiveness acceptance.
- Virtualization can lose keyboard focus or select a stale target → stable keys,
  captured qualified identities, reveal-before-focus and geometry readiness tests.
- Responsive changes can regress desktop artwork → retain ordinary desktop
  composition and compare updated synthetic mobile/large-room baselines separately.

## Verification and migration

Use production projection, geometry, semantic target and browser fixtures, not the
prototype, as implementation evidence. Include 0/1/8/9/12/100 tabs, more than sixteen
room agents, more than four panes per tab, more than six hosts and more than 128
rooms. Prove first/last-item reachability, exact counts, bounded visible admission,
non-overlap, creation and cross-host/runtime isolation. Cover a very tall room and
navigation to a later room while observations refresh.

Assess Q17 for creation coordination, Q19 for presentation capacity, Q20 for
qualified identity, Q23 for Inspector intent, Q39 for renderer lifetime, Q42 for
validated presentation preferences and Q43
for rendering/layout under
`verification/coverage.json`; verify the exact inventory mapping during
implementation. Geometry and touch/focus need direct implementation/browser
evidence. Reuse maintained identity/lifetime models for changed asynchronous
boundaries; add model work only when a new ordering or ownership decision needs it.

Retain the production Office desktop/mobile transport acceptance and its strict
p95 below 150 ms / maximum below 450 ms input acknowledgement ceilings. Do not
raise budgets to accommodate growth. Run the full delivery/behavioral gate for
the implementation, update affected consumer evidence and current contracts, and
obtain the normal independent PR review.

The implementation supersedes only the listed Office clauses and preserves
unrelated contracts. The overlapping Office clauses in the older active
`simultaneous-multi-host` delta are reconciled to prevent restoring retired caps. No
service or dependency migration is planned. Keep the study out of production
assets and commits; a rollback restores the previous presentation while native
workspaces, tabs and terminals remain authoritative.


## Implementation evidence

Logical membership is complete; the remaining presentation bounds cover only
compact pane, reception and Agent Bar artwork backed by complete qualified rosters.
Room descriptors are prepared in cooperative batches, immutable default room
presentations, signatures and the complete default projection are prepared
cooperatively with the observation, and geometry
publication uses the existing compact 64-bit digest. Large immutable layout copies
also yield in bounded batches; a newer publication or retired build cancels the old
copy before its revision becomes observable. Pixi hits, semantic actions and
connector anchors wait for the matching completed paint. Renderer-owned font and
resize paint acknowledgements explicitly schedule a fresh anchor report, even
without a React property update. Physical Pixi surfaces and
semantic controls follow the viewport, including rows inside a tall room. Readiness
waits for canvas paint as well as semantic admission. Preparation gates activation
immediately while retaining a still-current focused control.

The production browser regression reaches the hundredth tab with colliding native
identifiers on three hosts, retains a focused offscreen control, collapses the exact
qualified room, pages beyond 128 rooms and preserves the visible room when an
earlier room grows. Native browser scroll anchoring is disabled for this scroller
because the shell restores the qualified logical anchor after canvas readiness.
The production transport fixture exercises 64 hosts, 32,768 admitted workspaces and
262,144 admitted leaves without raising the existing input acknowledgement budgets.
The PR records the final checks; independent review remains a delivery obligation.
