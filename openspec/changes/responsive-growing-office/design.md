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
All sections fit the phone's usable width.
Use two readable desk columns where space permits and add rows rather than
shrinking all furniture to fit. Long titles wrap or compact within their headers;
full names and rename/close controls stay reachable.

Remove only the phone's decorative CEO room. Keep host health, waiting/completed
agent access and idle-agent access in the reception/status controls and existing
qualified chooser. An absent expense provider displays an honest unavailable state.
Desktop retains its CEO, receptions, Agent Bar, roads and independently sized
workspace rooms; ordinary desktop rooms use the existing column/row rhythm.

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

### Reach later rooms without traversing a giant room

Keep a room picker reachable outside the scrolling scene and support per-room
collapse. A collapsed room retains its qualified header and truthful item counts.
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
