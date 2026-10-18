## Why

Office is World's default and flagship view, but it reads as a dashboard drawn in
pixel art: bordered boxes under nameplate bars, "empty" and "new seat" labels,
agents away from their desks, and a layout that re-packs rooms whenever topology
changes. The owner wants Office to become the foundation of a game-like
workspace: hosts as buildings in a town, workspaces as rooms on carpets, agents
that live at their desks, fluid animation, and later agent profiles, an economy
and relationships. Rooms will also carry project signals such as pull requests,
deployments and per-project OpenTelemetry metrics.

It must stay usable every day at the owner's largest observed scale: three hosts,
eight rooms per host, fifteen desks per room and four panes per desk. Attention
must be visible at a glance, replying to an agent must take one action, and the
same model must work on desktop and phone.

PR #204 (responsive growing Office) improved completeness and responsiveness
inside the current composition but kept the dashboard look and a packer that
moves rooms on every change. A playable prototype reviewed with the owner on
2026-10-16 and 2026-10-17 settled the direction described here.

## What Changes

On 2026-10-17 the owner chose to keep the Pixel Office as Office and launch the
town as a new **Town** view next to it. Everything below describes Town; Office,
its settings and its contract are unchanged.

- Add a Town view: one building per presented host along roads, rooms on
  carpets, and a lounge and a reception inside each building.
- Present a desk as a team table for one tab with one seat per pane. Agent panes
  show a character at their seat; shell panes show a laptop with no one at it.
- Place rooms and desks stably from Herdr's native workspace and tab order.
  Topology changes fill free spots instead of re-packing, and rooms grow in
  capacity steps that always keep a free spot.
- Add semantic zoom over one placement: town (roofs and host summaries),
  overview (room status cards and reception boards, the desktop default), room
  (tables with per-seat status) and desk (characters, screens and animation).
- Send blocked agents to their host's reception, where they queue oldest first,
  with finished agents after them, and send idle agents to the lounge.
- Add an attention rail, grouped host → room → agent and hideable on desktop and
  a flat bottom tray on phones, plus a hover or tap peek showing the pane's
  latest lines, answer options when those lines show a numbered menu or a yes/no
  prompt, and Reply, which opens World's terminal composer for that pane.
- Add desk moves (a tab to a free spot in another room on the same host) and
  agent moves (a pane to a free seat at another table) through Herdr
  `pane.move`, qualified by connection and runtime generation, confirmed by
  Herdr events and rolled back on partial failure. Cross-host moves are refused.
- Reserve room-card slots for project signals supplied by optional providers,
  never invented when no provider answers.
- Give each agent a deterministic appearance and a profile surface keyed by a
  stable agent identity, as the hook for later profiles and economy.
- Stack buildings in one vertical flow on phones, with every gesture backed by a
  visible control.
- Keep Town inside the existing World shell as its own route and view-switcher
  entry: search, menus and the shared Inspector stay as they are, and the
  attention rail lives inside the Town view.

## Capabilities

### New Capabilities

None. This changes the existing World surfaces contract.

### Modified Capabilities

- `world-surfaces`: a Town view with its scene, placement, zoom levels, attention
  locations, attention rail, peek, chat dock, desk and agent moves, project
  signal slots, agent identity and phone layout. Office requirements are
  unchanged.

## Impact

- **Browser**: Town reuses the qualified Herdr-to-Office projection (with a
  larger desk bound) and adds `web/src/world/town/` and `TownView`; Office keeps
  its renderer.
- **Service**: a qualified move operation that executes ordered `pane.move`
  steps, waits for Herdr confirmation and rolls back on partial failure,
  available only for connections whose runtime advertises the method.
- **Herdr**: no change is required. Moving panes between tabs is native
  (`pane.move`). Herdr 0.9.3 `tab.move` reorders within a workspace only, so a
  desk move is several pane moves. The split-layout replay is derived from
  [herdr-drovr](https://github.com/AVGVSTVS96/herdr-drovr) (MIT), with its
  notice retained, and World adds rollback. A cross-workspace tab move upstream
  would remove the rollback path but is optional.
- **PR #204**: close in favour of this change once Town is merged.
- **Verification**: move ordering, authority and rollback need modelled evidence;
  exact-target replies, attention ordering, zoom-level attention visibility and
  the phone flow need browser evidence; existing input acknowledgement budgets
  remain binding.
- **Documentation**: README, knowledge map and changelog at implementation
  delivery.
