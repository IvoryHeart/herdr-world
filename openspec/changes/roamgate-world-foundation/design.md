## Context

See `proposal.md` for motivation. The current product is a Herdr Web-derived React frontend, Rust
bridge and compatibility crate. Its browser federates separately deployed bridge URLs. Roamgate at
commit `81c506e6135f5f3b47f7042252ffdac0ec2bf679` is a React/Bun Web/PWA application whose service
already owns isolated local/SSH Herdr runtimes, terminal transport, resources, connection profiles,
authentication and updates. Current World visual code lives on the PR 78 line and supplies the
shared World model plus Office, Tree and Graph.

## Goals / Non-Goals

**Goals:**

- Deliver one coherent World application based on the pinned Roamgate tree.
- Preserve Roamgate's working product surfaces and test coverage while migrating the complete
  defining World views onto the new native projection and navigation layer.
- Preserve qualified identity and failure isolation while moving federation into the service.
- Restore the mature Pixel Office, live visual-view terminal windows and force-directed Graph;
  adopt the new connected branch diagram as Tree and retain the useful selected-entity drawer.
- Keep the replacement reviewable through staged commits and requirement-linked checks.

**Non-Goals:**

- A generic provider or third-party World plugin SDK.
- Compatibility with old browser bridge profiles, preferences or Roamgate data directories.
- Running Herdr Web and Roamgate bridges side by side inside World.
- Changing Herdr core or defining a new Herdr protocol.
- Native Capacitor Android packaging in the foundation replacement; the responsive PWA is the
  supported mobile application in this change.
- Bit-for-bit preservation of obsolete Herdr Web shell chrome, browser-federation settings or
  retired profile stores. Presentation behavior and geometry that define Office and Graph remain
  required even when their integration seam changes.

## Decisions

### Import Roamgate as source lineage, not a runtime dependency

The branch records both World and the exact Roamgate commit in Git history, then makes the
Roamgate-derived tree the active implementation. Code, services and assets are rebranded and
released as World. This avoids two installers, two UIs, two profile stores and a private inter-app
API. Depending on an installed Roamgate process was rejected because it would preserve the port and
lifecycle collision that the replacement is meant to remove.

### Keep one Bun service and same-origin browser

The compiled World executable serves embedded assets and owns the connection manager. Local and
SSH profiles remain isolated runtimes with connection IDs and generations. The browser uses one
RPC/WebSocket origin. World does not port the former bridge Host, Origin and cross-origin CSP
configuration; it retains the upstream trusted-single-user loopback and authenticated non-loopback
service model.

The browser boundary applies to privileged HTTP resources as well as the WebSocket transport.
Loopback requests normally retain loopback authority; an operator placing an independently
authenticated HTTPS proxy in front of a loopback listener can configure one exact public origin.
That is a single deployment identity rather than the retired arbitrary Host/Origin allow-lists.
World uses its own cookie name so a separately running Roamgate installation on another port cannot
replace its authenticated session.

### Extend the existing connection manager for aggregate observation

Roamgate currently keeps multiple runtimes but gives each browser one selected connection. The
workspace/Inspector surface retains that focused-connection model. A bounded aggregate observation
path publishes status and snapshots for all ready profiles into a browser store keyed by connection
ID and generation. WorldObject is projected from that store. Mutations, resource requests and
terminal attachments always resolve back to one qualified runtime and never fall back.

World-to-Spaces handoff disables the focused-store reconnect retry because that generic convenience
captures a new active lease. A World action is instead bound to the observed connection and runtime
generation and fails when either changes. Every operational entry point owned by the mounted Spaces
tree, including its command palette and already-open palette state, follows the active-view gate.

### Establish World as native routes over the Roamgate store

The shared World hierarchy and focused Office/Tree/Graph views are built against the aggregate
snapshot types and existing selection/terminal APIs. Roamgate's existing terminal workspace
becomes the Spaces experience and its Inspector remains the host-specific operational surface.
Spaces stays mounted when a visual view is selected, so World uses the same component tree and
terminal ownership rather than embedding another application or maintaining a parallel runtime
client. The current CSS Office, list Tree and static branch Graph are only a foundation checkpoint;
they do not satisfy the view migration.

### Migrate presentation behavior, not the retired runtime boundary

Reuse the delivered Office projection, geometry, renderer, semantic targets, room actions,
conversation layout and Graph layout behavior from the pre-foundation World line. Adapt their
inputs to the connection-qualified `WorldObject` and current Roamgate-derived action/terminal
owners. Do not restore browser federation, the Rust bridge, a second profile catalogue or a second
runtime subscription.

The migration proceeds through view-local adapters so each view can be reviewed independently. A
compatibility adapter may expose the bounded labels, task summaries, state labels, tab metadata and
qualified action targets expected by a presenter, but it cannot create a second authoritative
world model. Presentation-only relocation, such as a blocked agent appearing in reception, never
changes its host/space ancestry.

### Restore Pixel Office as the Office view

Port the established Pixel Office composition rather than styling the checkpoint cards toward an
approximation. The migrated scene retains the CEO Office, per-host reception stations, bounded
status and optional-observability boards, Agent Bar, roads, content-sized work rooms, desks,
characters, selection callouts, room/seat actions, completion markers and semantic targets.

Use the delivered deterministic geometry and publication boundary for room sizing, title/action
containment, natural row packing, alignment, logical-canvas scrolling and renderer acknowledgement.
The World shell may change the available viewport, but it does not replace those layout invariants
with a generic responsive CSS grid.

### Keep one terminal owner while restoring visual conversation windows

Office, Tree and Graph may present live terminal conversation windows, but they consume the
Roamgate-derived shell's qualified terminal/session ownership. Opening the same pane through an
agent, desk, Tree node or Graph node focuses one existing conversation rather than attaching a
competing transport. Up to five desktop conversations retain independent geometry and order;
compact layouts expose one usable conversation at a time. Explicit handoff moves focus to the
already-mounted Spaces experience without changing the terminal identity.

The presenter owns only window geometry, z-order and scene connectors. It never owns terminal
transport, pane lifecycle or reconnect authority. A conversation survives projection refreshes and
temporary reconnect state, and closes automatically only after current admitted state confirms the
qualified pane no longer exists.

### Promote the checkpoint branch diagram to Tree

The connected host-to-space-to-agent diagram currently labelled Graph becomes the canonical Tree
presentation. It retains search, independent disclosure, visible connectors, selected-entity
details and qualified actions. The list-style checkpoint Tree is not the main desktop design; its
semantic hierarchy can be reused as a compact or assistive fallback where the branch layout is not
practical.

This explicitly supersedes the archived oversized Operations Console Tree direction. Tree remains
a deterministic containment view, not a force simulation, and does not acquire a second runtime or
terminal owner.

### Restore the spatial Graph canvas

Port the delivered force-directed Graph canvas and its stable host-first projection onto
`WorldObject`. Restore deterministic seeding, topology-only reheating, node dragging/pinning,
bounded pan/zoom, Fit, search, disclosure, saved camera/positions, status updates, terminal-window
connectors and the equivalent semantic interface. Host, space and pane identities remain qualified;
equal native identifiers on different hosts never merge.

The selected-entity drawer is shared shell behavior across Office, Tree and Graph. It exposes only
admitted details—ancestry, connection freshness, agent/model/state labels and bounded task summary—
and delegates Files, Changes, Agent History, terminal and Spaces actions through the existing
generation-fenced paths.

### Accept each view against preserved behavior

Each view gets focused unit, mounted-browser and synthetic visual acceptance before its task is
checked. Acceptance compares the migrated result with the delivered feature inventory at desktop
and compact sizes, including dense and unequal topologies, stale hosts, colliding native IDs and
live terminal continuity. A green repository check alone cannot establish visual completeness.

### Rebrand before release integration

Executable names, package metadata, environment variables, service definitions, data directories,
browser storage, update assets and plugin IDs become World-owned before a distributable build is
accepted. Legacy `ROAMGATE_*` and old World bridge variables are not public aliases. The upstream
commit and MIT attribution are recorded in `UPSTREAM.md` and notices.

### Start settings fresh

Connection registries use the World schema in the World data directory. Browser keys use a new
World namespace. Old World URL profiles cannot identify SSH destinations, and importing Roamgate
state would unexpectedly couple separate products. The implementation leaves existing files and
browser keys untouched for rollback but does not read them.

## Risks / Trade-offs

- **Large source replacement obscures behavioral regressions** → Preserve Roamgate's existing
  suites, add focused characterization at the World projection seam, and land staged commits that
  separate import/rebrand/projection/packaging.
- **Aggregate World observation can leak stale or cross-host identities** → Key every record by
  connection and generation, test colliding native IDs, and reject retired results.
- **World styles and renderers can destabilize Roamgate's responsive shell** → Keep a dedicated
  route boundary and accept each migrated view independently at desktop and compact sizes before
  enabling it in the final shell.
- **A minimal presenter can satisfy shallow topology tests while deleting product behavior** → Use
  explicit per-view feature contracts, retained synthetic fixtures and rendered visual evidence;
  do not mark a view complete from hierarchy tests alone.
- **Porting the old terminal component can create duplicate pane attachments** → Keep transport and
  reconnect ownership in the new shell and test that repeated selections and view changes preserve
  one qualified session.
- **Upstream Roamgate evolves quickly** → Pin and validate one exact synchronization point; future
  refreshes are explicit upstream-sync changes rather than floating dependencies.
- **Dropping native Android changes distribution expectations** → Keep mobile/PWA behavior in
  acceptance, document the break, and leave Android restoration as a separate outcome.

## Migration Plan

1. Record the exact Roamgate source parent and import it on a branch targeting World `main`.
2. Rebrand all runtime and release identities before producing installable artifacts.
3. Add and test aggregate connection observation and the World projection.
4. Migrate and independently accept the shared entity drawer, Pixel Office, connected Tree,
   terminal conversation layer and spatial Graph over the new runtime seam.
5. Integrate all visual surfaces and verify local plus SSH workflows through the one World service.
6. Update operational, lineage and release documentation; do not translate old profile stores.
7. Deliver the complete replacement as a reviewed PR. Existing releases remain the rollback path;
   installing an older release reuses only the old release's untouched storage.
