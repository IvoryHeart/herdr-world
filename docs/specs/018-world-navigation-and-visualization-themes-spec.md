# World navigation and visualization themes

- **Spec ID:** `018-world-navigation-and-visualization-themes`
- **Status:** Draft
- **Created:** 2026-08-31
- **Owner:** IvoryHeart / Herdr World
- **Reviewers:** —
- **Approved by:** —
- **Approved at:** —
- **Depends on:** completed Spec 004 repository and runtime boundaries

> This document may be edited only while its status is `Draft` or `In review`.
> After approval it is immutable. After implementation completes, record
> delivery and material drift in a summary. A later Mindcraft implementation
> requires its own approved specification; it must not rewrite this completed
> Graph delivery record.

## 1. Purpose

Herdr World currently opens Spaces at `/` and exposes Office as a separate
World surface at `/world`. The product direction is instead for Office to be
the default experience, while Spaces remains immediately available. Office is
also the first of several presentations of the same World state, rather than a
separate data-owning application.

This specification defines:

1. Office as the default entry experience;
2. a primary navigation control with Spaces on the left and a World theme
   selector on the right;
3. a compile-time World theme boundary shared by Office, Graph, and the future
   Mindcraft presentation; and
4. the first new theme delivery: a project/space-centric live Graph whose
   agents appear as child nodes.

The observable outcome of this specification is a working Office/Graph theme
choice backed by one existing Herdr World runtime. Mindcraft is named and
bounded here so the theme model does not preclude it, but its substantial
visual redesign is not part of this delivery.

## 2. Scope

This feature includes:

- making World with the Office theme the canonical `/` entry;
- moving Spaces to the explicit `/spaces` route;
- preserving `/world` as a compatibility alias for existing links;
- replacing the right-hand Office tab with an accessible World theme selector
  in the same position;
- keeping Spaces as the left-hand primary navigation choice;
- defining a small compile-time theme registry and route/history behavior;
- retaining Office as the default and preserving its current capabilities;
- implementing Graph as the next available World theme;
- projecting Graph nodes from the already admitted multi-host Herdr snapshots;
- rendering one main node per qualified project/space and child nodes for its
  detected agents, within explicit presentation bounds;
- preserving stable identity and layout across live snapshot updates;
- providing pan, zoom, fit, search, collapse, selection, keyboard, and
  semantic-list behavior for Graph;
- reusing the current selection, capability, and Open-in-Spaces action paths;
- recording the exact earlier Graph and Voxel sources that may be reworked;
- lifecycle, resize, long-session, accessibility, and multi-host validation;
  and
- reserving the product name and theme ID `mindcraft` for the later
  block-world theme.

## 3. Non-goals

This feature does not:

- implement, ship, or expose an unfinished Mindcraft option;
- treat Office, Graph, or Mindcraft as separate applications, surfaces,
  bridge processes, snapshot clients, or terminal-session owners;
- add a dynamic theme/plugin marketplace or load untrusted theme code;
- import the `ai-observability` visualization server, collectors, APIs, or
  standing polling loops;
- scan Claude sessions, Codex rollout files, process tables, repositories, or
  GitHub from the browser or bridge to populate Graph;
- add the old Agent Graph token-economy, CI, GitHub, or model dashboards;
- infer project equality across hosts from matching labels or paths;
- infer agent parentage from display names, paths, process names, or timing;
- add host, tab, pane, tool, CI, or observability nodes to the first Graph
  topology;
- create or mutate Herdr projects, spaces, panes, or agents from the graph;
- redesign the Office scene, its actions, or its observability contract;
- change the Herdr protocol or add a bridge route merely for theme selection;
- add a 3D graph; or
- retain the current Voxel art as the required visual quality of Mindcraft.

## 4. Context and constraints

### 4.1 Completed architectural boundary

[Spec 004](004-world-packaging-and-upstream-boundaries-spec.md) is a completed
repository-boundary and synchronization decision. It remains unchanged. This
specification depends on its rule that one application owns one bridge manager,
one runtime cache, and one terminal-session owner.

### 4.2 Current implementation

At the audited Herdr World baseline `ab8ef2d`:

- `web/src/surfaceRegistry.tsx` registers Spaces at `/` and World at `/world`;
- `web/src/CoreNavigation.tsx` explicitly falls back to Spaces and only maps
  one path per surface;
- `web/src/App.tsx` renders Spaces first and Office second in the primary
  switch;
- `web/src/world/worldSurfaceDefinition.ts` exposes Office as the `world`
  surface;
- `web/src/world/herdrOfficeProjection.ts` derives a bounded Office projection
  from admitted bridge snapshots; and
- `web/src/world/WorldSurface.tsx` owns Office presentation state and delegates
  terminal activation back to the existing Spaces handoff.

The requested left/right visual order therefore already exists. The route
default, World theme selection, and Graph presentation do not.

### 4.3 Terminology

| Term | Meaning in this specification |
| --- | --- |
| Primary surface | Either Spaces or World. They share the application shell and runtime. |
| World theme | A trusted compile-time presentation of World state: Office, Graph, or later Mindcraft. |
| Project/space | One runtime-qualified Herdr workspace. Exact worktree/project metadata may decorate it but does not merge it with another workspace. |
| Agent | An admitted pane recognized by the existing Herdr World agent-detection rules. |
| Available theme | A theme whose implementation, assets, fallback, tests, and lifecycle checks all ship in the current build. |

### 4.4 Reusable source audit

The earlier implementation is in
[`IvoryHeart/ai-observability` at `ecde9e154bbfd5ec705080e3420ff55767892c88`](https://github.com/IvoryHeart/ai-observability/tree/ecde9e154bbfd5ec705080e3420ff55767892c88),
not in the audited `herdr-web` checkout:

| Source | Useful material | Required treatment |
| --- | --- | --- |
| [`visualizations/public/graph/index.html`](https://github.com/IvoryHeart/ai-observability/blob/ecde9e154bbfd5ec705080e3420ff55767892c88/visualizations/public/graph/index.html) | Force-directed canvas, stable reconciliation, status rendering, selection, search, collapse, and fit interactions | Rework into tested React/TypeScript components using current Herdr World data and lifecycle ownership. |
| [`visualizations/server.js`](https://github.com/IvoryHeart/ai-observability/blob/ecde9e154bbfd5ec705080e3420ff55767892c88/visualizations/server.js) | Earlier workspace/repository/agent topology | Use only as behavioral reference. Do not import its server, collectors, action endpoints, or schema. |
| [`visualizations/public/graph/vendor/force-graph.min.js`](https://github.com/IvoryHeart/ai-observability/blob/ecde9e154bbfd5ec705080e3420ff55767892c88/visualizations/public/graph/vendor/force-graph.min.js) | `force-graph` 1.51.4 prototype dependency | Do not copy the minified artifact. Select and license a maintained production dependency through this repository's normal dependency/notices process, or implement the required renderer locally. |
| [`visualizations/public/city/index.html`](https://github.com/IvoryHeart/ai-observability/blob/ecde9e154bbfd5ec705080e3420ff55767892c88/visualizations/public/city/index.html) | Office/Neon/Voxel skin separation and Voxel renderer | Reference for the later Mindcraft spec only. The existing look is not an acceptance baseline. |
| [`visualizations/public/city/assets/LICENSE-kenney.txt`](https://github.com/IvoryHeart/ai-observability/blob/ecde9e154bbfd5ec705080e3420ff55767892c88/visualizations/public/city/assets/LICENSE-kenney.txt) | Kenney Voxel assets provenance | Re-audit each reused asset and carry its required attribution/notices when Mindcraft is specified. |

The prototype used a standalone Node server and independent collectors. Herdr
World already has the authoritative browser runtime and MUST reuse it.

### 4.5 Runtime and presentation ownership

```text
BridgeManager + admitted runtime snapshots + current event stream
                            |
                    pure World projections
                   /          |          \
              Office        Graph      Mindcraft
             available     this spec      later
                   \          |          /
                    one World theme slot
                            |
        existing selection, actions, terminal handoff, settings
```

Theme components may own presentation-local camera, collapse, hover, and
layout state. They do not own observation, connection, commands, terminal
attachments, or another copy of the application state.

## 5. Requirements

### Requirement: Make Office the canonical default entry

The application SHALL resolve a bare `/` load to the World surface with the
Office theme. A stored preference MUST NOT silently replace Office on a bare
entry. Spaces SHALL remain directly addressable at `/spaces`.

The route contract is:

| URL | Result |
| --- | --- |
| `/` | World with Office; canonical default |
| `/?theme=office` | World with Office; normalize to `/` without adding history |
| `/?theme=graph` | World with Graph |
| `/spaces` | Spaces |
| `/world` | Compatibility alias for `/`; normalize without adding history |
| `/world?theme=<available-theme>` | Compatibility alias for the canonical World theme URL |
| unknown path or unknown theme | Fall back safely to Office and normalize to `/` |

The reserved `/?theme=mindcraft` URL is not an available theme until a later
approved implementation ships. Before then it follows the unknown-theme
fallback and MUST NOT display an incomplete theme.

#### Scenario: A user opens Herdr World without a route

- **GIVEN** a fresh browser navigation to the application root
- **WHEN** the application resolves its primary surface and World theme
- **THEN** Office is visible, the World theme control reports Office, and the
  address remains `/`

#### Scenario: An existing Office bookmark is used

- **GIVEN** a bookmark to `/world`
- **WHEN** the application loads it
- **THEN** Office opens and the URL is replaced with `/` without creating a
  redundant browser-history entry

### Requirement: Keep Spaces left and use a right-hand theme selector

The primary navigation SHALL present Spaces as the left-hand control and the
World theme selector as the right-hand control in the current Office position.
The selector trigger SHALL show the active theme's label and icon and SHALL
offer every available theme exactly once.

The initial delivered choices are Office and Graph. Mindcraft MUST appear only
after its own implementation satisfies its acceptance contract. A disabled or
non-functional promotional menu item is not acceptable.

The selector SHALL be operable with pointer, keyboard, and touch input; expose
its name, expanded state, selected item, and menu relationships to assistive
technology; close on Escape and outside activation; and restore focus to its
trigger when dismissed.

#### Scenario: A keyboard user changes themes

- **GIVEN** Office is active
- **WHEN** the user opens the right-hand selector, moves to Graph, and confirms
- **THEN** Graph replaces Office in the World stage, the trigger reports Graph,
  focus remains usable, and the URL becomes `/?theme=graph`

### Requirement: Keep route, history, and selected theme consistent

A user-initiated primary-surface or theme change SHALL add exactly one browser
history entry. `popstate` navigation SHALL restore both the correct primary
surface and World theme. Canonicalization and compatibility aliases SHALL use
replacement, not insertion. Selecting the already active destination SHALL be
a no-op.

Theme URLs are the shareable source of truth for the current entry. Theme-local
camera or collapse preferences MAY be stored separately, but local storage
MUST NOT override the theme named by the URL or make a bare `/` open Graph.

#### Scenario: Back crosses a surface and a theme

- **GIVEN** the user navigated Office → Graph → Spaces
- **WHEN** Back is pressed twice
- **THEN** the first Back restores Graph at `/?theme=graph` and the second Back
  restores Office at `/`, without stale trigger or stage state

### Requirement: Register trusted themes at compile time

World themes SHALL be declared by a small typed compile-time registry. A theme
definition SHALL have a stable ID, display label, semantic icon, lazy component
loader, and availability determined by the shipped build. Theme IDs use
lowercase ASCII letters, digits, and hyphens and are URL-safe.

The required IDs are:

| ID | Label | Status in this delivery |
| --- | --- | --- |
| `office` | Office | Available and default |
| `graph` | Graph | Implemented and available |
| `mindcraft` | Mindcraft | Reserved; not registered as available |

A theme load or render failure SHALL be contained inside the World stage. The
application shell, bridge observation, Spaces, and active terminals remain
usable, and the failure UI offers a return to Office.

#### Scenario: The Graph chunk fails to load

- **GIVEN** the core application and Office chunk loaded successfully
- **WHEN** the Graph lazy import fails
- **THEN** the World stage reports a bounded error with a return-to-Office
  action while runtime observation and Spaces remain alive

### Requirement: Reuse the existing runtime and live state

Office and Graph SHALL consume projections derived from the same admitted
`BridgeManager` runtimes, connection states, snapshots, agent-activity events,
capabilities, settings, and action controllers already owned by the
application. Theme selection MUST NOT create another WebSocket, snapshot poll,
event subscription, bridge profile registry, terminal attachment, or provider
request.

Projection functions SHALL be pure and independently unit tested. Sharing the
runtime does not require forcing every theme through the Office-specific
presentation model; Office may retain its existing bounded projection while
Graph derives a graph-specific projection from the same source snapshots.

#### Scenario: Themes are switched repeatedly

- **GIVEN** all configured hosts are connected and observed once
- **WHEN** the user switches Office ↔ Graph repeatedly
- **THEN** bridge connection counts, runtime subscriptions, provider requests,
  and terminal-session ownership do not increase

### Requirement: Project a project/space-centric Graph

Graph SHALL contain one main node for each presented runtime-qualified Herdr
workspace. The node's label comes from the workspace display label. Exact
worktree metadata MAY add a project/repository subtitle or badge, but MUST NOT
cause two workspace identities to merge.

Each detected agent pane in that workspace SHALL be represented as a child
node linked to its project/space node. Tabs, ordinary panes, hosts, tools, and
observability records are attributes or filters, not first-class nodes in the
initial graph. A project/space with no detected agent remains visible as an
empty main node.

If a future admitted source provides an authoritative parent-agent identity,
Graph MAY place that agent below its parent. Without that fact, the agent
remains a direct project/space child. The implementation MUST NOT guess
parentage.

Node IDs SHALL derive from runtime-qualified source IDs, never labels or array
positions. The same source entity retains its Graph identity across label,
status, focus, task-summary, and snapshot-revision changes. Distinct hosts or
runtimes with equal labels remain distinct and display enough host context to
disambiguate them.

#### Scenario: Two hosts contain a space named `main`

- **GIVEN** two admitted runtimes each report a workspace labelled `main`
- **WHEN** Graph projects the combined snapshot
- **THEN** two distinct main nodes appear with stable qualified identities and
  visible host context, and their agents attach only to the correct node

#### Scenario: An agent status changes

- **GIVEN** an agent node has a stable qualified pane identity
- **WHEN** its status changes from working to blocked in a later snapshot/event
- **THEN** the existing node updates its semantic and visual status without
  being removed, recreated, or losing its settled position

### Requirement: Bound Graph presentation explicitly

The first Graph presentation SHALL render at most 128 project/space nodes and
at most 16 agent nodes per presented project/space, matching the established
Office room and room-agent presentation bounds. Ordering SHALL prioritize the
focused space/agent, working or blocked agents, and stable source order so an
important live agent is not omitted merely because it appears late in a
snapshot.

Omitted projects or agents SHALL be represented by exact, non-interactive
overflow counts in both the visual and semantic presentation. Complete
observed counts remain available to status/coverage reporting. Bounds MUST be
constants covered by tests rather than accidental renderer limits.

#### Scenario: A snapshot exceeds presentation bounds

- **GIVEN** more than 128 spaces or more than 16 detected agents in one space
- **WHEN** Graph builds its presentation
- **THEN** it remains responsive, includes priority entities, reports exact
  omitted counts, and does not silently imply that omitted entities vanished

### Requirement: Provide useful Graph interaction without accidental actions

Graph SHALL support:

- pointer/touch pan and bounded zoom;
- Fit graph;
- expand/collapse for each project/space;
- search across bounded display-safe project, space, agent, host, model, and
  task-summary labels already available to the browser;
- selection with a details view;
- visible working, blocked, idle, done, unknown, focused, stale, and
  disconnected distinctions where the source data supports them; and
- explicit Open in Spaces activation for an actionable project/space or agent.

Status MUST NOT rely on color alone. Selecting, dragging, expanding, or
collapsing a node MUST NOT start, resume, stop, or send input to an agent.
Existing capability and qualified-target validation remains authoritative for
Open in Spaces.

The initial view SHALL seed deterministically from stable node IDs. Live data
updates SHALL reconcile existing node objects and reheat layout only when
topology changes; ordinary status or label changes MUST NOT reset the complete
layout.

#### Scenario: Live status updates without topology change

- **GIVEN** a settled Graph with unchanged project and agent identities
- **WHEN** status-only updates arrive repeatedly
- **THEN** labels and status cues update without resetting zoom, selection,
  collapse state, pinned positions, or the force layout

### Requirement: Supply an equivalent semantic interface

The canvas SHALL NOT be the only way to perceive or operate Graph. A bounded
semantic tree/list SHALL expose the same presented project/space hierarchy,
agents, statuses, selection, overflow counts, and explicit actions. Keyboard
focus and selection remain synchronized between the semantic interface and
the visual graph without requiring every moving canvas node to become a DOM
element.

At compact widths the semantic interface and theme selector remain reachable,
and Graph controls MUST NOT overlap or make the primary application navigation
unusable.

#### Scenario: Canvas content is not perceivable

- **GIVEN** a screen-reader or keyboard-only user
- **WHEN** Graph is selected
- **THEN** they can find projects/spaces, inspect their agents and statuses,
  select an entity, and invoke an allowed Open-in-Spaces action without using
  canvas hit testing

### Requirement: Preserve Office and cross-theme continuity

Office SHALL retain its current projection bounds, semantic overlay,
conversation windows, room actions, selection, layout settings, observability,
and Open-in-Spaces handoff unless this specification explicitly changes them.

Selection of an entity shared by Office and Graph SHALL survive a theme change
when that qualified identity still exists. Presentation-local state such as
Office scroll/conversation geometry and Graph camera/collapse positions SHALL
be namespaced and restored only by its owning theme. A theme MUST NOT interpret
another theme's persisted state.

#### Scenario: Office is revisited after Graph

- **GIVEN** Office has saved scroll and conversation-window geometry
- **WHEN** the user switches to Graph and then back to Office
- **THEN** Office restores its own view state and Graph state does not corrupt
  or replace it

### Requirement: Dispose renderer work completely

Graph SHALL have one renderer/animation owner. Unmount, theme change, page
visibility, and container resize handling SHALL stop or pause work as
appropriate and release observers, event listeners, timers, animation frames,
canvas references, simulation callbacks, and retained node/link collections.

Resize handling SHALL be frame-coalesced and use the latest dimensions. It
MUST NOT send resize commands to Herdr terminals, rebuild live-data
subscriptions, restart the force simulation for unchanged topology, or create
one queued update per raw resize event.

#### Scenario: The window is continuously resized

- **GIVEN** Graph is active with a settled topology
- **WHEN** hundreds of resize observations arrive during a drag
- **THEN** the latest size is applied through bounded frame-coalesced work,
  navigation remains responsive, and no terminal resize or new runtime
  subscription is produced by the Graph theme

## 6. Data and interface contract

### 6.1 Theme definition

The implementation SHALL define an equivalent of this internal contract:

```ts
type WorldThemeId = "office" | "graph" | "mindcraft";

type WorldThemeDefinition = {
  id: WorldThemeId;
  label: string;
  semanticIcon: string;
  load: () => Promise<{ default: WorldThemeComponent }>;
};
```

The exact component prop name is an implementation detail. It SHALL receive
the existing World context or a smaller typed view of it; it SHALL NOT receive
credentials, raw provider responses, or ownership of runtime connections.

### 6.2 Graph projection

The pure Graph projection SHALL expose equivalent bounded data:

```ts
type WorldGraphNode = {
  id: string;
  kind: "space" | "agent";
  parentId: string | null;
  hostKey: string;
  label: string;
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  focused: boolean;
  stale: boolean;
  actionable: boolean;
};

type WorldGraphEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains" | "reports-to";
};
```

Optional bounded display metadata may be added without changing the node
identity contract. Source paths, raw terminal output, prompts, credentials,
and arbitrary provider fields are excluded.

### 6.3 Persistence

Office keeps its existing versioned preference key. Graph preferences, if
persisted, SHALL use a separate versioned key, validate every decoded field,
bound stored node IDs and numeric geometry, and fail to defaults on malformed
or unavailable storage. Theme identity comes from the URL, not persisted
preferences.

### 6.4 Bridge and protocol

This delivery requires no new bridge API, Herdr method, WebSocket message, or
observability-provider field. If implementation discovers that a required
Graph fact is absent, the graph SHALL represent it as unavailable or omit the
optional decoration; expanding the bridge contract requires an explicit spec
update while this document is still reviewable, or a later specification after
approval.

## 7. Privacy and security

- Graph receives only the bounded browser data already admitted for the
  current host profiles and World/Spaces behavior.
- The `ai-observability` collectors are not a permitted data source for this
  implementation. The bridge MUST NOT begin reading home-directory session
  logs, process ancestry, repository state, GitHub credentials, or terminal
  content for Graph.
- Qualified runtime IDs remain application-internal. Display labels are
  bounded and escaped in semantic HTML and tooltips.
- Theme code is trusted compile-time application code and follows the same
  Content Security Policy. No remote scripts, remote theme manifests, or
  runtime code loading are introduced.
- Open-in-Spaces and future explicit actions reuse existing capability,
  target-generation, and command validation. Graph does not widen the browser
  command allow-list.
- A remote host remains subject to the current Host, Origin, CSP, and operator
  network controls. Theme selection is not an authentication boundary.
- Graph errors and diagnostics MUST NOT include terminal output, prompts,
  credentials, or unbounded source paths.

## 8. Acceptance evidence

Acceptance requires all of the following:

### Navigation and registry

- unit tests for every route/alias/theme row, canonical replacement, unknown
  values, no-op navigation, and Back/Forward restoration;
- component tests for selector pointer, keyboard, Escape, focus restoration,
  selected state, accessible names, and available-theme filtering;
- a fresh `/` browser test proving Office is the default;
- `/spaces`, `/?theme=graph`, `/world`, compact/mobile, and reload smoke tests;
  and
- a lazy-theme failure test proving Spaces and runtime observation survive.

### Graph model and behavior

- pure projection fixtures covering empty spaces, ordinary panes, agents,
  duplicate labels across hosts, worktree decoration, focus/status changes,
  stale/disconnected hosts, stable IDs, and exact overflow counts;
- tests proving status-only updates preserve node object identity and layout
  state while topology changes add/remove only affected entities;
- interaction tests for fit, search, collapse/expand, selection, semantic-list
  synchronization, and explicit Open in Spaces;
- tests proving pointer selection/drag/collapse cannot trigger an action;
- deterministic visual review at desktop and compact viewport sizes; and
- status/selection review in grayscale or an equivalent check proving meaning
  is not carried by color alone.

### Ownership, lifecycle, and performance

- instrumentation proving Office ↔ Graph switching does not increase bridge
  connections, runtime/event subscriptions, provider polling, or terminal
  owners;
- a repeated mount/unmount test proving renderer, observer, listener, timer,
  animation-frame, canvas, and simulation ownership returns to baseline;
- a resize storm test with at least 300 raw observations proving work is
  frame-coalesced, the latest size wins, and no terminal resize/runtime
  reconnect is caused by Graph;
- a topology soak at the presentation bounds with repeated status and
  structural revisions, with no uncaught error, frozen navigation, or
  monotonically retained detached node/link collections;
- a long-session browser soak showing stable ownership counts after warm-up
  and no renderer crash; and
- theme-hidden/page-hidden verification showing animation work pauses and
  resumes without duplicate loops.

### Repository gates

- dependency and asset licenses are reviewed before copied code or a graph
  engine is added;
- production dependency changes regenerate byte-clean notices with pinned
  `cargo-about` 0.9.2 where applicable;
- `npm run check` passes;
- the browser smoke checklist passes for Spaces, Office, and Graph; and
- the pull request receives independent review before merge.

Spec 018 is complete when the route migration, Office/Graph selector, Graph
delivery, compatibility, and acceptance evidence above are delivered. It does
not wait for Mindcraft.

## 9. Deferred decisions

- Mindcraft implementation, art direction, interaction model, asset set,
  performance bounds, and acceptance evidence require a separate approved
  specification. Its product ID and label remain `mindcraft` / Mindcraft.
- Whether Mindcraft retains any Kenney Voxel assets is deferred to its asset
  and visual-quality audit.
- Token economy, CI/GitHub topology, delivery flow, model dashboards, and
  observability overlays in Graph require separate product direction; they are
  not inherited merely because the prototype displayed them.
- Authoritative agent-to-subagent relationships remain deferred until an
  admitted Herdr or provider contract exposes them. Guessed relationships are
  prohibited.
- Cross-host merging of workspaces into one project node is deferred until an
  exact stable project identity and conflict behavior are specified.
- A 3D Graph, user-authored themes, downloadable themes, and third-party theme
  APIs are deferred with no compatibility promise.
