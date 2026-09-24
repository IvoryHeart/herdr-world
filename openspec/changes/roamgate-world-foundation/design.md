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
  defining World views onto the new native projection and navigation layer, with Office completed
  first as the integration proof.
- Preserve qualified identity and failure isolation while moving federation into the service.
- Restore the mature Pixel Office and make Roamgate's terminal, Files, Changes and Agent History
  available as one focused, shell-owned Office context.
- Restore the connected Tree and spatial Graph after Office over the same qualified projection and
  focused Inspector seam.
- Preserve internal all-host observation plus selected-host visual presentation and conversations
  without replacing Roamgate's focused-host interaction model.
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
- Restoring the former free-form World notes store. Review annotations remain a separate workflow
  and are not described as migrated notes.
- Enabling the existing Spaces-focused Actions palette unchanged on a visual route. It remains
  unavailable there until a follow-up after the Office interaction seam can provide explicit,
  generation-qualified visual context instead of silently targeting hidden Spaces focus.
- Retaining terminal or Inspector contexts from several hosts simultaneously. Multi-host operation
  can be introduced later by deliberately replacing the selected-connection browser lease; it is
  not hidden inside this foundation migration. This intentionally retires behavior delivered by
  the former World implementation, so this change does not claim complete behavioral parity with
  that application.
- Restoring the former task-summary producer or connection-qualified agent/pane watchlist. Those
  useful workflows and their expanded live local/SSH acceptance are tracked as focused follow-up
  work in GitHub issue #95 rather than being represented as present in this foundation.

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
from that store. Ready-inactive hosts remain current observations; unavailable hosts may retain
explicitly stale topology. Those states are distinct from the selected operational host.

Mutations, resource requests and terminal attachments use only the selected connection and its
current runtime generation. Selecting a World entity is observational and never changes that
connection. Explicit connection selection uses Roamgate's existing connection-change lifecycle and
revalidates the target before any operation. Every operational entry point owned by the mounted
Spaces tree, including its command palette and already-open palette state, follows the active-view
gate.

### Require one selected operational host and presentation

The shell restores the existing last/default profile when it still belongs to the managed
catalogue. When no profile is selected, Spaces' connection workflow is shown before Office, Tree or
Graph is presented. The selected host remains stable while the user changes views. The service and
browser runtime store continue to observe the full qualified aggregate, but the shell derives a
selected-host WorldObject for Office, Tree, Graph, their counts and their search. Explicitly
switching the connection changes that whole presentation; a view never mixes disabled entities from
another host into an otherwise operational surface.

An already-open context whose host becomes inactive during a switch is retired through the existing
lease lifecycle. Any transient retained read-only context uses direct host-switch language and an
explicit Switch now action; selection and attempted operations never switch hosts implicitly.

This is an accepted product boundary, not a claim that the former World lacked cross-host terminal
windows. The former implementation could retain conversations from several hosts concurrently;
this replacement deliberately gives those operational contexts the same selected-host lifetime as
Roamgate's browser lease while preserving the aggregate internally for connection management and a
later simultaneous-host client.

### Establish World as native routes over the Roamgate store

The shared World hierarchy is built against the aggregate snapshot types and existing
selection/terminal APIs; Office, Tree and Graph consume its selected-host projection. Roamgate's existing terminal workspace becomes the
Spaces experience. Spaces stays mounted when a visual view is selected, so World uses the same
component tree, Inspector resources and terminal implementation rather than embedding another
application or maintaining a parallel runtime client. Presentation ownership is exclusive: visual
Inspectors own selected-host resources while Office, Tree or Graph is visible; selecting Spaces
suspends those presenters and lets the native Spaces layout present the exact selected terminal.
The current CSS Office, list Tree and static
branch Graph are only foundation checkpoints and do not satisfy the view migration. The CSS Office
must not evolve into a second renderer; it is removed when the retained Pixel Office mounts.
Office rendering receives projection data and shell-owned callbacks and does not query or depend on
the hidden Spaces DOM. Office is the default World surface after connection selection. Keeping
Spaces mounted is a migration technique for its current owners, not a presentation dependency;
Spaces remains an available first-class operational surface while a later change may reduce the
shell after those owners have been extracted.

The Roamgate-derived top bar remains the single application header. Insert the Office/Spaces/Tree/
Graph selector between its version and machine controls, and remove the checkpoint World navigation
bar and the separate Visual Control Plane/status header so every view receives the rest of the
viewport without duplicating shell chrome. Keep the selected host/runtime state and bounded
ready/space/agent/stale summary in the inherited top bar, with compact layouts progressively hiding
counts before they hide the selected host state.

The same header owns a view-control slot. Office, Tree and Graph place search there; Graph also
places Fit and zoom there. The views SHALL reuse that control treatment and SHALL not reserve a
second stage header for those controls. View-specific overflow or transient errors may remain in the
stage where their context is visible.

The workspace frame below that header is shared too. Keep the existing Spaces workspace navigator,
focused tab strip and review-annotations control mounted around Office, Tree and Graph; replace the
Graph-specific desktop outline rather than showing two competing left hierarchies. The center
surface alone changes with the selected view. The shared frame follows the selected Herdr host and
workspace, while `WorldObject` continues to retain the aggregate topology and supplies only its
selected-host projection to the visualizations. Review drafts remain workspace-qualified and synchronize between every Inspector
presentation and the one shell annotation panel. Visual views do not clone the navigator, tab or
annotation state. Navigator rows and focused-tab choices resolve to the same qualified World entity
and admit the docked Inspector only after the exact Herdr focus succeeds.

### Treat the pre-foundation Pixel Office as retained source

World commit `9c8f650853ad2d598d476dac1eecdeaea16716c6` is the source baseline for the
established Office. Restore its pinned PixiJS dependency, character assets and licence, then port
`PixelOfficeCanvas`, Office geometry, layout publication, renderer lifecycle/resources, scene
signature, selection, semantic targets, observability presentation and their focused tests as
retained modules. Preserve their deterministic behavior and provenance notices. Do not redraw that
scene in React DOM/CSS or use the retained implementation only as a screenshot reference.

Adapt the delivered projection's input to the connection-qualified `WorldObject` while preserving
the presentation output contract consumed by the renderer. Adapt renderer callbacks at the current
Roamgate-derived action, Inspector and terminal owners. These narrow adapters are the intended
rewrite boundary. The migration does not restore browser federation, the Rust bridge, simultaneous
cross-host operational contexts, a second profile catalogue or a second runtime subscription.

The migration proceeds through view-local adapters, beginning with Office. An adapter may expose
the bounded labels, task summaries, state labels, tab metadata and qualified action targets
expected by a presenter, but it cannot create a second authoritative world model. Presentation-only
relocation, such as a blocked agent appearing in reception, never changes its host/space ancestry.

### Restore Pixel Office as the Office view

Port the established Pixel Office composition rather than styling the checkpoint cards toward an
approximation. The migrated scene retains the CEO Office, per-host reception stations, bounded
status and optional-observability boards, Agent Bar, roads, content-sized work rooms, desks,
characters, hover callouts, room/seat actions, completion markers and semantic targets. Selection
uses the scene state plus the shared Inspector; it does not add a persistent floating identity
badge over the Office.

Use the delivered deterministic geometry and publication boundary for room sizing, title/action
containment, natural row packing, alignment, logical-canvas scrolling and renderer acknowledgement.
The World shell may change the available viewport, but it does not replace those layout invariants
with a generic responsive CSS grid.

### Present one Inspector surface in docked or floating form

Visual-view selection is observational. Office proves the seam first: its explicit Docked/Floating
preference determines whether a newly selected entity opens in the one docked Inspector overlay or
as a movable Inspector window above the unchanged Pixi stage. Both are presentations of the same
reusable Inspector surface. The header contains only compact identity and safety state; Files, Changes,
Agent History and Terminal occupy the useful area and are visible as tabs immediately. The identity
and resources have one lifecycle and close control. A floating Inspector exposes Dock in and a
docked Inspector exposes Dock out plus dock-position and expand controls. Terminal is ordered first
and is the initial tab for each newly opened terminal-capable entity; changing a window's tab does
not silently change another entity's state or the default for the next entity. Full ancestry,
generation, persona, model, focus and task metadata are not repeated as a large profile card;
appropriate admitted information remains available in scene callouts or the relevant resource view.

The common settings menu owns Office room alignment, long-title treatment, Inspector presentation
and optional observability configuration; Office does not reserve a persistent scene toolbar or a
mobile/Zen shortcut strip for these infrequent controls. Office settings persist an explicit
default presentation for subsequent entity opens, with Floating as the fresh-install default so
the established multi-window Office interaction remains immediately available. Docked mode admits
new contexts to the one docked target; Floating mode admits each new context directly to the
bounded cascaded window registry. The preference does not migrate already-open contexts between
targets, so users control those transitions only with Dock in and Dock out.

The overlay receives one focused operational context containing the exact connection, observed
runtime generation, workspace and optional pane/terminal identity. Its connector uses the retained
scene-layout publication to join the pane edge to the selected agent anchor without affecting
layout. The action revalidates that target and then presents the existing Roamgate-derived resource
or terminal component while the visual view remains visible. An entity on another host remains
read-only until its host is explicitly activated; a stale or replaced target keeps its captured
bounded identity, fails closed and never silently rebinds by native identifier.

Spaces and non-agent terminal panes reuse the same Inspector surface rather than losing the earlier
contract or masquerading as agent profiles. Their compact header names the actual entity; their tab
set is capability-derived, with Files and Changes for spaces, Files, Changes and Terminal for
terminal panes, and Agent History only for an admitted agent session. Host selection remains a
bounded status/activation context without a fabricated workspace scope.

The Inspector implementation remains shell-owned and shared with Spaces and the visual views, but
its presentation state becomes a bounded registry keyed by qualified entity identity. Each entry
owns only independent Inspector UI state—active tab, file/diff selection, history presentation and
geometry—while reusing the existing resource components, connection client, caches and terminal
owner. It does not create another application store, runtime observer or transport. Switching or
opening entities does not advance Spaces' connection or retain another host's resources. Admission
awaits qualified pane focus before publishing identity and resources, so delayed or failed focus
cannot combine one entity's header with another entity's content. An actionable entity has no
separate profile card; only inactive or stale selections use a compact read-only activation context
outside the Inspector. Explicit host activation uses Roamgate's normal teardown and selection
lifecycle before a new Inspector context can open.

Optional observations appear in the compact header only after the provider qualifies them to the
same connection, generation and agent session. Host totals are not divided or attributed by the UI,
and absent observations produce no zero-value placeholders. Provider configuration is a
service-owned World setting reachable from the common settings menu in every native view. It uses
one shell-level dialog above whichever view is active and the same configuration endpoint; Office
does not retain a separate metrics shortcut.

### Keep selected-host Inspector conversations on existing resource owners

Office first proves that qualified entities can consume the existing Inspector resources and
terminal/session owner without duplicating transport. The shell maintains one docked Inspector and
a bounded floating registry keyed by selected connection, runtime generation and entity identity.
Office, Tree and Graph present those contexts, but no presenter owns SSH, terminal transport,
reconnect or pane lifecycle. Selecting the same entity through another representation focuses its
existing Inspector instead of opening a competitor.

The terminal implementation remains the current Roamgate-derived `TerminalView`, bridge
`ConnectionClient` and terminal support machinery already present in World. Do not import the
retired Herdr Web terminal or establish it as a second application upstream. Retained World window
geometry and connector code wraps the complete Inspector surface, not a terminal-only card. While
a terminal tab is live in an Inspector conversation, mounted-but-hidden Spaces does not mount a
second `TerminalView` for that terminal. Selecting Spaces first retires the visual presentation,
then lets the native Spaces layout mount the same qualified terminal identity and fit it to the new
container. Returning to a visual view performs the inverse and restores retained Inspector tab,
resource and geometry state. A UI remount and terminal detach/attach are permitted at this boundary;
creating or closing the underlying Herdr terminal session is not.

The registry exposes mutually exclusive docked and floating targets for each qualified Inspector.
Dock out transfers the whole docked Inspector—including its selected tab and resource state—into a
movable, resizable window. Dock in performs the inverse. When another Inspector is already docked,
the two entries swap presentations so no context is discarded and the floating-window count does
not increase. A transfer may remount a live terminal only after its old target detaches, so there is
never more than one input listener or attachment for that terminal. The × control closes only that
Inspector entry and never creates another presentation as a side effect. Activating an Office desk
opens or focuses its Inspector on Terminal using the configured default presentation. Focusing a
terminal tab first focuses its exact Herdr pane so the existing input gate
remains authoritative. The overlaid docked presentation can also be dragged across the application
viewport rather than being clamped to the current visual-stage frame; an explicit dock-position or
expand/restore action clears that free position and reapplies its named dock geometry.

Changing selection while an Inspector is docked performs an ordered replacement without asking the
new entity to inherit the old resource state: the outgoing docked entry closes before the new
context mounts. Docked mode does not manufacture a floating window as a side effect of ordinary
navigation; floating entries arise through explicit Dock out or a new Office activation in Floating
mode. Docking an existing floating entry into an occupied dock still swaps the two retained presentations. The
common workspace navigator and focused tab strip resolve their selected workspace or pane to the
exact selected-host WorldObject identity and always invoke the docked admission path, regardless of
the Office scene's Docked/Floating preference, so their highlighted selection and the visual
Inspector cannot diverge. On compact layouts the registry is preserved while one active Inspector
remains usable at a time.

Every visible floating or docked Inspector connects to its qualified desk when present, otherwise
to its agent or hierarchy node. Connectors consume published scene positions and presentation
geometry, update during pan, scroll, move and resize, and disappear rather than retarget when their
exact anchor is absent. A connector never owns or changes topology, selection, resource state,
transport or terminal identity.

The registry remains inside the inherited browser routing lease and uses the one browser WebSocket,
resource clients and existing terminal bridges; it does not create connection-independent clients,
another SSH tunnel, application store or terminal manager. Changing the selected host deliberately
retires all outgoing Inspector resources and terminal mounts before the new lease becomes
operational, so actions cannot be redirected across hosts. Reconnecting the selected runtime
invalidates conversations from its retired generation.

Up to five floating desktop Inspectors from the selected host retain independent geometry, order,
tab and resource-selection state alongside the one docked Inspector. This is the deliberate
multi-window boundary: users can compare terminals, files, changes and histories across qualified
entities without cloning runtime ownership. Compact layouts expose one usable Inspector at a time.
Spaces remains available from the primary view selector, without an Inspector-local Open in Spaces
shortcut. Visual Inspector windows never cover visible Spaces. A conversation survives projection
refreshes and view changes while its host remains selected, but its presentation is suspended while
Spaces owns the operational workspace and restored on return. It closes after host switching,
generation retirement or current admitted state confirms the qualified entity no longer exists.

The shared `TerminalView` fits from the dimensions of its current visible container after every
portal transfer, window move/resize, dock change and Spaces handoff. Mobile input affordances follow
the active qualified pane rather than a stale presenter. Desktop browser-focus recovery remembers
whether that terminal held focus before blur and restores only that cursor, avoiding both the extra
click and unwanted focus theft. A desktop floating Inspector may move into the lower viewport while
keeping its draggable title region reachable; compact presentation remains fully contained. Its
resize affordance uses a compact corner bracket without reducing the usable pointer target.

### Defer operational-summary production and pane pinning

The foundation may present bounded task-summary metadata already admitted by Herdr, but it does not
ship the former `herdr-world task-summary` producer. It also does not carry the former
connection-qualified pane/agent watchlist into the new service. Neither workflow has a truthful
implementation at this seam, so retaining their requirements would describe product behavior that
is absent. GitHub issue #95 records their deliberate restoration as separate, testable changes.
Workspace pins, Graph position pins and review annotations remain distinct features and are not
presented as replacements for the deferred agent/pane watchlist or the retired free-form notes
store.

### Promote the checkpoint branch diagram to Tree after Office

After the Office projection, focused Inspector and conversation seams pass their own acceptance,
the connected host-to-space-to-agent diagram currently labelled Graph becomes the canonical Tree
presentation. It retains search, independent disclosure, visible connectors, selected-entity
details and qualified actions. The list-style checkpoint Tree is only a compact or assistive
fallback where the branch layout is not practical.

Tree presents the shell-owned dock target inline: opening an actionable leaf expands that exact
leaf and mounts the same Inspector resources beneath its card. Only one leaf is expanded as the
inline dock at a time. Dock out moves the complete Inspector to the existing floating-window
registry; Dock in while Tree is active returns it to the exact leaf, restoring ancestor disclosure
when necessary. This is a presentation-target change only—the conversation registry, resource
state, terminal owner and connection fencing remain shell-owned.

Tree and Graph share one explicit presentation-budget policy: at most 128 hosts, 128 spaces globally
and 16 leaves per presented space, ordered by selected/focused and attention-requiring relevance.
Each renderer and its semantic equivalent consume one bounded projection and disclose exact global
and affected-branch omissions. This avoids rendering the unbounded selected-host projection twice and makes search
truthful about the hierarchy currently presented.

### Restore the spatial Graph after Tree

Port the delivered force-directed Graph canvas and stable host-first projection onto `WorldObject`.
Restore deterministic seeding, topology-only reheating, node dragging/pinning, bounded pan/zoom,
Fit, search, disclosure, saved camera/positions, status updates, Inspector-window connectors and the
equivalent semantic interface. Equal native identifiers on different hosts never merge.

The selected-entity context remains shared shell behavior. It exposes only admitted details and
delegates Files, Changes, Agent History, terminal and Spaces actions through generation-fenced
paths; Tree and Graph do not acquire another Inspector or runtime owner.

### Accept the delivered views against the retained view contract

Office, Tree and Graph receive focused unit, mounted-browser and synthetic desktop/compact checks
over the shared projection and operational seams. The delivery establishes their selected-host
composition, bounded projection, guarded actions and shared Inspector ownership. Expanded live
local-plus-SSH matrices, the deferred task-summary producer and the agent/pane watchlist proceed in
focused follow-up issue #95; they are not silently inferred from a green repository check. The
explicitly retired behavior remains recorded as a product boundary rather than an unexplained
parity gap.

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
  route boundary and accept Office first, then Tree and Graph independently at desktop and compact
  sizes before completing the replacement.
- **A minimal presenter can satisfy shallow topology tests while deleting product behavior** → Use
  the retained renderer and geometry source, its focused tests, an explicit Office feature
  contract, retained synthetic fixtures and rendered visual evidence; reject a parallel DOM/CSS
  Office and do not mark Office complete from hierarchy tests alone.
- **Embedding rich operational context in Office can duplicate Roamgate state** → Lift or reuse the
  shell-owned Inspector and terminal owners, pass one qualified context and reject any design that
  creates a second resource store, WebSocket, SSH tunnel or application instance.
- **Reusing the retired Herdr Web terminal would create two UI upstreams** → Keep the current
  Roamgate-derived terminal as the only implementation; adapt retained World windowing around it,
  suppress hidden Spaces attachments and hand presentation back to native Spaces when it becomes
  visible.
- **An aggregate view can make inactive hosts look operational** → Retain aggregate observation
  internally but present only the selected host in Office, Tree and Graph until simultaneous-host
  operations are supported; switch hosts only through the existing connection selector.
- **Switching hosts retires live conversation windows** → Keep view changes separate from host
  changes, expose the selected host persistently and use the existing teardown path so no terminal
  input can be redirected to the replacement host.
- **Upstream Roamgate evolves quickly** → Pin and validate one exact synchronization point; future
  refreshes are explicit upstream-sync changes rather than floating dependencies.
- **Dropping native Android changes distribution expectations** → Keep mobile/PWA behavior in
  acceptance, document the break, and leave Android restoration as a separate outcome.

## Migration Plan

1. Record the exact Roamgate source parent and import it on a branch targeting World `main`.
2. Rebrand all runtime and release identities before producing installable artifacts.
3. Add and test aggregate connection observation and the World projection.
4. Restore the retained Pixel Office dependency, assets, projection contract, geometry, renderer,
   semantic targets and tests before adapting its `WorldObject`, action and shell boundaries.
5. Require one selected operational host, expose the qualified shell-owned Inspector registry and
   accept the retained Pixel Office through focused unit, mounted-browser and responsive checks.
6. Extend the existing selected-host Inspector and terminal owners to bounded conversation windows,
   then migrate and verify connected Tree and spatial Graph without reopening the runtime or
   Inspector boundaries.
7. Update operational, lineage and release documentation; do not translate old profile stores.
8. Deliver the foundation replacement as a reviewed PR. Existing releases remain the rollback path;
   installing an older release reuses only the old release's untouched storage.
