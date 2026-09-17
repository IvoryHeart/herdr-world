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
  defining Pixel Office onto the new native projection and navigation layer.
- Preserve qualified identity and failure isolation while moving federation into the service.
- Restore the mature Pixel Office and make Roamgate's terminal, Files, Changes and Agent History
  available as one focused, shell-owned Office context.
- Preserve all-host observation, the agent/pane watchlist and the supported task-summary reporting
  workflow without replacing Spaces' focused-host interaction model.
- Keep the replacement reviewable through staged commits and requirement-linked checks.

**Non-Goals:**

- A generic provider or third-party World plugin SDK.
- Compatibility with old browser bridge profiles, preferences or Roamgate data directories.
- Running Herdr Web and Roamgate bridges side by side inside World.
- Changing Herdr core or defining a new Herdr protocol.
- Completing the connected Tree or force-directed Graph migrations in this change. Their qualified
  projection can be reused later after the Office seam is accepted.
- Retaining several simultaneous visual terminal or Inspector contexts across different hosts.
  This change deliberately follows Roamgate's one-focused-connection operational model.
- Native Capacitor Android packaging in the foundation replacement; the responsive PWA is the
  supported mobile application in this change.
- Bit-for-bit preservation of obsolete Herdr Web shell chrome, browser-federation settings or
  retired profile stores. Presentation behavior and geometry that define Office remain required
  even when their integration seam changes.
- Restoring the former free-form World notes store. Review annotations remain a separate workflow
  and are not described as migrated notes.

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

The pinned Roamgate source, and upstream main as rechecked during specification review, keep
multiple local or SSH runtimes ready concurrently while giving each browser one selected connection
for workspace/Inspector interaction. The workspace/Inspector surface retains that focused
connection model. A bounded aggregate observation path publishes status and snapshots for all
ready profiles into a browser store keyed by connection ID and generation. WorldObject is projected
from that store. Mutations, resource requests and terminal attachments always resolve back to one
qualified runtime and never fall back.

World-to-Spaces handoff disables the focused-store reconnect retry because that generic convenience
captures a new active lease. A World action is instead bound to the observed connection and runtime
generation and fails when either changes. Every operational entry point owned by the mounted Spaces
tree, including its command palette and already-open palette state, follows the active-view gate.

### Establish Spaces and Office as native routes over the Roamgate store

The shared World hierarchy and Office view are built against the aggregate snapshot types and
existing selection/terminal APIs. Roamgate's existing terminal workspace becomes the Spaces
experience. Spaces stays mounted when Office is selected, so World uses the same component tree,
Inspector resources and terminal ownership rather than embedding another application or
maintaining a parallel runtime client. The current CSS Office is only a foundation checkpoint and
does not satisfy the Office migration.

### Migrate presentation behavior, not the retired runtime boundary

Reuse the delivered Office projection, geometry, renderer, semantic targets and room actions from
the pre-foundation World line. Adapt their inputs to the connection-qualified `WorldObject` and
current Roamgate-derived action, Inspector and terminal owners. Do not restore browser federation,
the Rust bridge, a second profile catalogue or a second runtime subscription.

An Office adapter may expose the bounded labels, task summaries, state labels, tab metadata and
qualified action targets expected by the presenter, but it cannot create a second authoritative
world model. Presentation-only relocation, such as a blocked agent appearing in reception, never
changes its host/space ancestry. Keeping this adapter independent of Office geometry leaves a
straightforward input boundary for later Tree and Graph work without designing a generic provider
SDK now.

### Restore Pixel Office as the Office view

Port the established Pixel Office composition rather than styling the checkpoint cards toward an
approximation. The migrated scene retains the CEO Office, per-host reception stations, bounded
status and optional-observability boards, Agent Bar, roads, content-sized work rooms, desks,
characters, selection callouts, room/seat actions, completion markers and semantic targets.

Use the delivered deterministic geometry and publication boundary for room sizing, title/action
containment, natural row packing, alignment, logical-canvas scrolling and renderer acknowledgement.
The World shell may change the available viewport, but it does not replace those layout invariants
with a generic responsive CSS grid.

### Reuse one focused Inspector and terminal context inside Office

Office selection is observational. When the user explicitly opens a terminal, Files, Changes or
Agent History, the shell creates one focused operational context containing the exact connection,
runtime generation, workspace and optional pane/terminal identity. The action activates that
connection through the existing selected-connection path, revalidates the target and then presents
the existing Roamgate-derived resource or terminal component while Office remains visible. A stale
or replaced target fails closed and never falls back to the currently active host.

The Inspector remains a single shell-owned facility shared with Spaces. Office does not clone its
file, Git, history, preview or resource stores. Switching the focused Office context may replace the
previous Inspector or terminal context and may dispose the outgoing Spaces terminal mounts exactly
as Roamgate does today. This is an explicit user-visible context change, not a background attempt to
keep every host operationally active.

The focused Office terminal consumes the existing terminal/session owner and one browser
WebSocket. Opening the same selected pane focuses the existing attachment rather than creating a
competing transport. The Office presenter owns only selection and scene association; it never owns
SSH, terminal transport, reconnect or pane lifecycle. Retained simultaneous cross-host terminal
windows are deferred. They may be added only after a separate bounded proof shows that
connection-qualified browser leases can coexist without another socket, tunnel, application store
or hidden active-connection switching.

### Restore operational summaries and pane pinning at the new seam

Task summaries remain optional Herdr pane metadata, but optional data needs a supported producer.
Port the bounded report/update/clear command as a World CLI mode that talks directly to the owning
Herdr metadata API and does not require the World web service to start. It remains bound to the
pane's active agent session, expires, normalizes and redacts content, and can run wherever the
owning local or remote Herdr socket is reachable. SSH display and control remain fully usable when
that optional producer is not installed on the remote host.

Port the old pane/agent watchlist into the World service with connection-qualified records and a
bounded World-owned store. This pin means “keep this live agent or terminal in my operational
watchlist”; it is distinct from Roamgate workspace pins and any later view-position pins. Pin, unpin and
Pinned-only presentation revalidate the owning runtime and prune panes that are authoritatively
gone. The former free-form notes store remains retired rather than being conflated with review
annotations.

### Defer Tree and Graph until the Office seam is proven

The aggregate `WorldObject` remains suitable for later alternate projections, but this change does
not complete or accept Tree or Graph. Checkpoint implementations may remain available to
development, but primary product navigation does not present them as finished views. A later change
can promote the connected branch diagram to Tree and restore the force-directed Graph without
altering the connection manager, Office geometry or focused operational ownership established here.

### Accept Office against preserved behavior

Office gets focused unit, mounted-browser and synthetic visual acceptance before its task is
checked. Acceptance compares the migrated result with the delivered Office feature inventory at
desktop and compact sizes, including dense and unequal topologies, stale hosts, colliding native
IDs, focused terminal use and the in-Office Inspector. A green repository check alone cannot
establish visual completeness.

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
- **World styles and the Office renderer can destabilize Roamgate's responsive shell** → Keep a
  dedicated route boundary and accept Office at desktop and compact sizes before enabling it in
  the final shell.
- **A minimal presenter can satisfy shallow topology tests while deleting product behavior** → Use
  an explicit Office feature contract, retained synthetic fixtures and rendered visual evidence;
  do not mark Office complete from hierarchy tests alone.
- **Embedding rich operational context in Office can duplicate Roamgate state** → Lift or reuse the
  shell-owned Inspector and terminal owners, pass one qualified context and reject any design that
  creates a second resource store, WebSocket, SSH tunnel or application instance.
- **Following one focused host limits simultaneous visual conversations** → Make that limitation
  explicit for this outcome and defer cross-host retained terminals until a bounded proof can
  satisfy generation isolation without fighting the selected-connection lifecycle.
- **Upstream Roamgate evolves quickly** → Pin and validate one exact synchronization point; future
  refreshes are explicit upstream-sync changes rather than floating dependencies.
- **Dropping native Android changes distribution expectations** → Keep mobile/PWA behavior in
  acceptance, document the break, and leave Android restoration as a separate outcome.

## Migration Plan

1. Record the exact Roamgate source parent and import it on a branch targeting World `main`.
2. Rebrand all runtime and release identities before producing installable artifacts.
3. Add and test aggregate connection observation and the World projection.
4. Enrich the shared World projection and expose one qualified shell-owned Inspector/terminal
   context while Office remains visible.
5. Migrate and independently accept the complete Pixel Office over local plus SSH observations and
   the focused operational context; do not gate this outcome on Tree, Graph or simultaneous
   cross-host conversations.
6. Update operational, lineage and release documentation; do not translate old profile stores.
7. Deliver the complete replacement as a reviewed PR. Existing releases remain the rollback path;
   installing an older release reuses only the old release's untouched storage.
