## Context

Office projects Herdr topology (connections, workspaces, tabs, panes and agent
status) into a Pixi scene. The current contract fixes a CEO Office, receptions,
an Agent Bar and road-separated room bands, and PR #204 added content-grown
rooms with skyline packing. The owner reviewed a playable prototype of a
different model and asked for this proposal. The prototype used synthetic data
only. Its lessons are recorded here; its code is not a production source.

Owner decisions from the review:

- The game look, the zoom transitions and the agent animation are the direction.
- Attention must read at a glance. Today's receptions are a known place to look,
  so the town keeps one per host.
- Replying must take as few actions as possible: hover to peek, then one click
  or typing.
- Floors were rejected because they hide rooms; every room of a host is visible
  at once.
- On desktop the attention list belongs in a left rail that can be hidden and is
  grouped by host and room. On phones it stays a bottom tray.
- Tapping a room zooms into it; double-tap zooms in at that point.
- Scale figures are maximums: up to three hosts, eight rooms per host, fifteen
  desks per room and four panes per desk.

## Goals / Non-Goals

**Goals**

- A town model that is spatially stable, readable at every zoom level and
  complete: every admitted pane stays reachable.
- One-action replies from any zoom level without opening the full terminal.
- Desk and agent moves that change Herdr topology only through qualified,
  confirmed operations.
- Hooks for agent identity, profiles, economy and project signals without
  inventing data.
- The same model on desktop and phone.

**Non-Goals**

- Agent relationships, economy rules, levels or profile persistence.
- Building, room or desk decoration editing beyond moves.
- Cross-host moves, which would mean relocating a running process.
- New observation providers. This change defines the slots and the
  provider-absent behaviour.
- Graph, Tree, Desk or Spaces behaviour changes.

## Decisions

### 1. Keep the projection and Pixi; replace the scene

The qualified projection (`herdrOfficeProjection.ts`), the semantic target layer
and viewport-bounded paint from PR #204 remain. Layout, drawing and in-scene
overlays are replaced. Pixi 8 stays the renderer; a DOM or CSS scene cannot
animate hundreds of characters within the input budgets.

Art is generated at load time from compact pixel definitions into a texture
atlas: tiles, furniture, roofs, façades and characters with walk, sit and carry
frames. Character appearance is derived from agent identity, so there is no
binary art to license and no fixed roster. The twelve existing single-frame
character PNGs are retired. A licensed CC0 tileset can replace the generated
atlas later without changing the model.

### 1a. Art direction and assets

The prototype's look is the reference for production art.

**Style**

- **View and scale**: 3/4 top-down pixel art on a 16-pixel tile grid, drawn with
  nearest-neighbour scaling. Smoothing is used only when zoomed far out.
- **Outlines**: every sprite has a dark one-pixel outline, with highlight and
  shade derived from one base colour per material.
- **Palette**: a warm dusk-green world palette. Each host has a roof, brick and
  floor colour, and each room a carpet colour, drawn from a fixed set.
- **Status colours** are reserved: working blue, waiting amber, done green, idle
  sand and shell green. They always come with text or accessible names.
- **Lighting**: soft drop shadows and additive screen glow. Ambient motion (tree
  sway, cloud shadows, fountain, dust puffs) is disabled by reduced motion or
  Calm.
- **Text** uses three web fonts: Silkscreen for in-world signs and plaques,
  Pixelify Sans for headings and Rubik for interface text. Each has a system
  fallback.

**Characters**

- **Sprite size**: 12 by 18 pixels plus outline.
- **Directions**: down, up and side views, with left mirrored from right.
- **Poses**: stand, four-frame walk, sit with two typing frames, and carry.
- **Blinking and status bubbles**: `!` (waiting), `✓` (done) and a coffee cup
  (idle).
- **Appearance**: skin, hair, hair style, shirt and trousers are chosen
  deterministically from agent identity, which gives profiles a stable avatar
  for free.

**Asset inventory**

- **Ground**: grass, road, sidewalk and plaza tiles.
- **Building shell**: walls, windows, façade, door and awning, and roofs with
  rooftop props.
- **Interior**: carpets, team tables, chairs (front and back), laptop lids and
  screens with a per-agent-kind logo colour, the reception counter with its
  service bell, and lounge furniture (sofa, coffee machine, water cooler).
- **Outdoors**: plants, trees in three variants, bushes, lamps, benches, the
  town board and the fountain.
- **Interface sprites**: status bubbles, the selection ring and the drag ghost.

**Pipeline**

- **Generation**: sprites are defined as compact pixel-drawing functions in
  `web/src/world/` and composed into a texture atlas at load time. There are no
  binary assets, and characters and caches regenerate deterministically.
- **Static layers**: the ground, building interiors, façades and roofs are baked
  once per layout into cached textures. Only furniture, desks and agents are
  drawn per frame.
- **Updating art**: a sprite changes by editing its definition. A sprite gallery
  fixture renders every sprite and pose so changes can be reviewed visually.

**Licensing**

- **What is allowed**: original art, plus CC0 or MIT assets with a recorded
  source.
- **Recording sources**: imported assets go under `web/public/world/` with
  their licence file and a notices entry.
- **Third-party tilesets**: one may replace generated sprites later if its
  licence permits redistribution in this repository and in releases.
- **Retired images**: the twelve existing character PNGs are removed, and their
  licence note goes with them if nothing else uses it.

### 2. Town model as a pure function

`town = layoutTown(projection, formFactor)` produces buildings, rooms, desk
cells, seats, lounge spots, reception queue slots and roads in 16-pixel tiles.
It holds no animation state. The renderer, hit testing and semantic targets all
read the same model.

- **Desktop** (≥ 640 CSS px): buildings in one row in the host filter's order,
  with a road in front and a park strip below.
- **Phone** (< 640 CSS px): buildings stacked in one column, each with its own
  road. This matches the vertical phone flow the owner chose for PR #204.
- **Building interior**: a wall with windows, a commons strip with the lounge,
  room rows of three, then the reception lobby at the entrance.
- **Room**: a carpet holding a grid of desk cells (four tiles of table plus an
  aisle). Each cell has four seats: two facing the viewer behind the table and
  two with their backs to the viewer showing their screens.

### 3. Stable placement

- Room order follows Herdr workspace order and desk order follows tab order, so
  World stores no layout of its own.
- Room capacity steps through 2, 4, 6, 9, 12, 16 and 20 cells, always leaving at
  least one free cell.
- While a scene is live, existing desks keep their cells. A new tab takes the
  first free cell, and a closed tab leaves its cell free. A reload re-derives
  placement from native order.
- When a room grows a capacity step, later rows of the same building may shift,
  but rooms are never reordered and desks never change rooms except by an
  explicit move.

Re-deriving from native order keeps desktop, phone and other browsers consistent
without a persisted World arrangement that could drift from Herdr.

### 4. Zoom levels over one placement

Thresholds depend on on-screen size, not device:

| Level    | When                                              | Shows                                                                                                                                     |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Town     | Zoomed out past the fit-all view                  | Roofs with host name, room and desk counts, and a waiting badge                                                                           |
| Overview | Desktop default                                   | Room status cards (name, desks, working count, status bar, waiting badge, project signal line) and reception boards with waiting agents' faces |
| Room     | A table is roughly 40 to 90 px on screen          | Tables with a status mark per seat, room plaques and waiting bubbles                                                                      |
| Desk     | A table is wider than roughly 90 px               | Characters, laptop glow, typing and walking animation, and per-seat targets                                                               |

Roofs fade and lift as the camera zooms in. Attention indicators (waiting
badges, reception faces and bubbles) appear at every level. Status always has
text or an accessible name as well as colour.

### 5. Where agents stand

- **Working**: seated at their pane's seat.
- **Blocked** (needs input): stands up, walks to the host reception and queues
  oldest first in bounded slots. Further blocked agents stay at their seat with a
  waiting bubble, and the reception board shows an exact overflow count. When
  answered, the agent walks back.
- **Done**: stays seated with a completion marker until that completion is
  inspected, using the existing browser-local seen rule, which never mutates
  Herdr. The owner preferred following done agents at their desk over sending
  them to reception.
- **Idle**: walks to a lounge spot. If no spot is free, the agent stays seated
  with an idle cue.

Movement is presentation only. Operational state is never delayed by animation,
and an agent keeps its exact qualified pane target wherever it stands.

### 6. Peek and quick reply

The peek is an accessible DOM overlay anchored to its target in the world, the
reception board or the rail:

- **Opening**: hovering for about 130 ms opens it; leaving for 300 ms closes it
  unless the user has pinned it by clicking, tapping or typing. A tap opens it
  pinned.
- **Content**: the agent's name, room, desk and host; the latest bounded lines
  from the existing pane observation; answer options when the agent integration
  exposes a structured choice; a reply box; Open terminal; Profile and moves; and
  Next, which goes to the next waiting agent.
- **Keys**: shortcuts work only when keyboard focus is in the Office scene or
  the peek itself; pointer hover alone never captures keys.
  - **Scene or peek focused** (not the reply box): digits pick an answer and other
    printable keys move focus into the reply box and type there.
  - **Reply box focused**: digits and every other key are ordinary text, and
    answer shortcuts are off.
  - **Never captured**: keys while a terminal, search field, editor or any other
    editable control has focus, keys during IME composition, and keys with
    Ctrl, Alt or Meta held. A hover peek over another agent does not change the
    keyboard target.
- **Delivery**: replies use the existing qualified input path to the exact pane.
  A retired target closes the peek and never redirects input.
- **Open terminal** uses the existing Inspector presentation preference, Docked
  or Floating.

### 7. Attention rail

The rail reuses Desk attention triage ordering: waiting agents oldest first,
then done agents newest first.

- **Desktop**: a left rail grouped host → room → agent, with collapsible hosts.
  It can be hidden to a count chip, and that choice is remembered per browser.
- **Phone**: a flat bottom tray.
- **Actions**: hovering an entry peeks; activating it opens the terminal (on a
  phone, it peeks). Activating a room entry zooms to that room, and N opens the
  next agent.

### 8. Desk and agent moves

A move request carries the qualified connection ID, runtime generation, source
tab and panes, and target workspace or tab. The service rejects requests across
connections, for retired generations, or for runtimes without `pane.move`.

- **Desk move** (one tab with n panes):
  1. **Capture before any change.** Read the source tab's layout and rebuild its
     complete split tree from the pane rectangles Herdr reports. This must
     happen first, because moving a pane collapses its split and removes the
     direction and ratio the replay needs. Validate that every source pane
     still exists and the tree accounts for all of them; otherwise refuse the
     move without sending anything. This reconstruction is derived from
     herdr-drovr (MIT), which also snapshots the tree before its first move.
     World keeps drovr's copyright and licence notice. drovr is a Herdr plugin
     that runs inside Herdr and needs node and fzf, so World ports the
     algorithm into the service instead of depending on the plugin.
  2. **Anchor.** Send `pane.move` for the tree's first pane with destination
     `new_tab` in the target workspace and `focus: false`.
  3. **Replay.** Walk the captured tree and move each remaining pane into the
     new tab as a split with its captured direction and ratio.
  4. **Follow pane ID changes.** A move can replace a pane's operational ID:
     `pane.moved` carries `previous_pane_id` and the new `pane_id`, as
     `server/src/workspace/last-step-turns.ts` already handles. World keeps an
     old-to-new ID map from each confirmed event and uses the current ID for
     every later split target, for rollback and for any further change during
     rollback. drovr keeps the same kind of map.
  5. **Confirm each step** from `pane.moved` and tab events before the next.
  6. **Roll back on failure.** If step k fails, move the already-moved panes back
     into the original tab, which still holds the remaining panes, using their
     current IDs and the captured tree, and report the result. drovr does not
     roll back; World adds rollback because the move starts from a drag in the
     scene, not from a picker the user can retry.
  7. **Never retry an uncertain step**, matching the existing rule against
     replaying uncertain mutations. If rollback fails, World reports the actual
     resulting topology instead of hiding it.
- **Agent move** (one pane): one `pane.move` into the target tab as a split
  toward the chosen seat, confirmed the same way, with the pane's replacement ID
  recorded.
- **Identity vs. pane ID**: agent identity (decision 9) is separate from the
  operational pane ID. Office follows each confirmed replacement ID, so the
  agent keeps its appearance, profile and location while its seat, peek, rail
  entry and terminal targets switch to the new pane ID.
- **Presentation**: the source and target cells are reserved and the crew
  animate carrying the table. The final placement always follows confirmed Herdr
  topology. On failure the table is carried back.

Moves are available by drag (long-press first on touch) and by a Move action on
the card, so no gesture is the only path.

### 9. Agent identity and profile hook

Identity is the connection profile plus the agent session identity reported
through `pane.report_agent_session` when present. Otherwise it is the qualified
pane, which is ephemeral. Appearance is a deterministic function of identity.

The profile surface shows only provider-backed figures, such as worked time from
observations and cost from the existing OpenTelemetry economy provider, and
otherwise says the figure is unavailable. This change adds no profile store.

### 10. Project signals

Room cards reserve one line for project signals: open PRs, last deployment and
spend. Values come only from optional observation providers mapped to a
workspace. With no provider, the line is omitted. Status text, never colour
alone, conveys a failed deployment.

### 11. Phone

- **Default view**: width-fit on the first building, with overview room cards,
  the reception board and the bottom tray.
- **Navigation**: buildings stack vertically, so scrolling stays in one
  direction. ALL zooms out to the whole town.
- **Peek** opens as a sheet above the tray.
- **Back** closes the peek, card and terminal through the existing system Back
  module rather than per-surface history code.

### 12. Office inside the World shell

Office stays a view inside the existing World shell, which is derived from
Roamgate. The prototype's top bar was a stand-in. In production:

- **Switching views** uses the shell's existing controls: the view selector on
  desktop and the bottom navigation (Office, Graph, Desk, Spaces) on phones.
- **No second top bar**: Office adds nothing above the scene. Its counts move into
  a compact overlay inside the scene; Jump to uses the shell's search; and Calm and
  Office settings join the shell's common menu.
- **Desktop rail**: while Office is active, the attention rail occupies the shell's
  left sidebar slot. It uses the sidebar's existing hide control, so a single
  left column holds the hierarchy.
- **Terminals** open in the shared Inspector, Docked or Floating, so moving to
  Graph, Desk or Spaces keeps the same terminal windows.
- **Roamgate files**: changes stay in World-owned layers plus the minimal marked
  seams already used for the mobile app bar, so Roamgate syncs stay cheap.

### 13. Accessibility and motion

Semantic targets cover buildings, rooms, desks, seats, agents, reception entries
and rail entries. Compact targets are at least 24 by 24 CSS pixels and other
targets at least 48 by 48. Every target is reachable by keyboard and has a name
that includes status text.

Reduced-motion preferences and a Calm setting remove ambient motion and shorten
camera moves to at most 350 ms.

### 14. Performance

- Rooms outside the viewport are culled.
- Below the room level, tables draw without per-seat detail.
- Glow and particles appear only at room and desk levels.
- Characters are drawn only at the desk level, except walking or queued agents,
  which appear from the overview level.
- The dense transport fixtures and input acknowledgement budgets (p95 under
  150 ms, maximum under 450 ms) remain binding. A new fixture covers the owner's
  maximum scale: three hosts, eight rooms, fifteen desks and four panes.

### What carries over from PR #204

Carried over:

- Qualified projection fixes, including colliding host identifiers and exact
  pane activation.
- The semantic target layer and focus retention.
- Viewport-bounded preparation and paint, plus yielding projection work.
- Renderer-owned paint completion and anchor republication.
- Performance and browser fixtures at 390, 1440 and 3440 px.

Dropped:

- The skyline packer and packing search.
- The phone-specific scene layout.
- Brick façades with nameplate signs.
- The CEO room, the Agent Bar and the empty-desk labels.

## Alternatives Considered

- **Isometric view**: more depth, but harder hit testing, text placement and
  phone width usage. The 3/4 top-down view keeps rectangular layout.
- **Floors per building**: smaller buildings, but rooms on other floors are
  hidden. The owner rejected it.
- **Keep content packing**: denser, but spatially unstable. Spatial memory
  matters more for a game-like daily surface.
- **Persist a World-owned arrangement**: allows free placement, but can drift
  from Herdr. Native order is used until a real need for free placement appears.

## Risks / Trade-offs

- **Non-atomic desk moves**: mitigated by checking the source again, ordered
  confirmation, layout replay derived from herdr-drovr, rollback and honest
  reporting. An upstream cross-workspace tab move would still remove the
  rollback path.
- **Structured answer options depend on agent integrations**: without one, the
  peek offers the reply box only, never guessed buttons.
- **Canvas accessibility**: the semantic target layer must stay in step with the
  model. It is a required browser check, not a follow-up.
- **Animation cost at maximum scale**: mitigated by zoom-level drawing and
  culling, and verified by the maximum-scale fixture.
- **Removing the Agent Bar and CEO Office changes a familiar picture**: the
  reception, with the user seated behind the counter, keeps the known place for
  attention.

## Migration Plan

Office is replaced in place behind the existing route; there is no feature flag.
The work is delivered in the tranches listed in `tasks.md`, each keeping Office
complete and usable. The settings for room alignment and long titles become
obsolete and are removed, while the Inspector presentation preference is kept.

## Open Questions

- Should building order follow the host filter order, or be draggable later?
- Which agent integrations can expose structured choices today, beyond the
  Claude Code permission prompt?
- Should a later "tidy room" action compact free cells on demand?
