## Context

See [proposal.md](proposal.md) for motivation. `App.tsx` currently computes Office and Graph
projections independently from the same runtime-source array. Both projections repeat host, workspace,
pane, freshness, status, and action-admission interpretation. The Graph projection creates only
space and terminal nodes, while the Office projection already retains configured hosts without
snapshots and maps workspaces, tabs, and agent panes into scene-specific rooms, desks, and people.

Herdr remains the runtime authority. The browser has stable host profile IDs and host-qualified
workspace, tab, pane, and terminal identities. Pane records expose whether the pane currently looks
like an agent, but no authoritative agent-to-agent parent relationship exists.

## Goals / Non-Goals

**Goals:**

- Build the World hierarchy once per admitted runtime revision and make current themes consume it.
- Preserve exact host ownership, qualified actions, stale-state behavior, and stable layout IDs.
- Represent detected agents and empty terminals as sibling space children.
- Allow a later authoritative parent relation without changing every theme's source contract.

**Non-Goals:**

- Add agent-parent inference, cross-host project merging, a new bridge route, or a new Herdr field.
- Make presentation bounds or theme-specific placement part of runtime authority.
- Turn tabs into World hierarchy nodes in this change; Office may continue using admitted tab data
  as desk/layout metadata associated with a space.

## Decisions

### Build a normalized shared model with a nested traversal

Add a pure `WorldModel` builder between runtime sources and theme projections. The model exposes
ordered host roots, ordered spaces per host, ordered agent/terminal children per space, a flat node
index, and containment edges. Nodes use a generic `parentId`; current parents are host → space and
space → agent or terminal.

Each model host retains its profile, location, connection state, generation, features, and optional
snapshot state. Each space retains its qualified workspace reference and admitted workspace/tab
data. Each leaf retains qualified pane and terminal references and the admitted pane data.

A nested-only structure would make selection and future graph reconciliation repeatedly scan the
tree. A flat-only graph would make Office grouping and bounded traversal cumbersome. Providing both
views over the same node objects keeps identity and ancestry singular without forcing themes into
one rendering data shape.

### Treat agent and terminal as classifications of one stable terminal-backed entity

The leaf node ID derives from the qualified terminal identity. Its kind is `agent` when the existing
agent detector recognizes the pane and `terminal` otherwise. The terminal reference remains
available for both kinds. If classification changes, the ID and parent stay stable.

Creating a second inferred agent object would duplicate the pane, complicate terminal ownership,
and cause identity churn when an agent starts or exits. A future admitted agent ID and parent ID can
extend the discriminated node type and `parentId` relation without being guessed now.

### Keep tabs as admitted space metadata

The World hierarchy reflects the product entities discussed by the owner: hosts, spaces, agents,
and empty terminals. Tabs remain qualified runtime entities and are retained with each space so
Office can continue mapping them to desks and actions can target them. Graph does not introduce tab
nodes. A later product request can promote tabs without changing host, space, or terminal identity.

### Make Graph a bounded host-first projection

Graph consumes `WorldModel`, presents configured hosts as root nodes, and connects presented spaces
to their owning host. Agents and terminals connect directly to their space. Equal labels and native
IDs on different hosts remain separate.

The explicit bounds become 128 hosts, 128 spaces globally, and 16 agent/terminal children per
presented space. This gives a worst-case 2,304 saved node positions, matching the current preference
parser limit. Exact omitted-host, omitted-space, and omitted-child counts remain visible.

Host connection state is the host node's primary state. Activity status aggregates from descendant
agents and terminals for secondary status cues. A host remains visible without a snapshot; stale
cached descendants remain beneath it and are non-actionable.

Collapse and search traverse ancestry. Collapsing a host hides its spaces and all descendants;
collapsing a space hides its agents and terminals. A search match retains the ancestor chain needed
to understand ownership. Open-terminal and Open-in-Spaces actions remain available only on current
space, agent, or terminal targets after existing admission checks.

The force layout seeds hosts as roots, spaces around hosts, and leaves around spaces. Existing
space and terminal IDs stay stable, but the preference key advances so the first host-first view fits
the new topology instead of restoring a camera and pinned root layout created for the earlier
space-first graph.

### Keep presentation semantics in projections

Office continues to derive rooms, desks, reception, bar placement, characters, and presentation
bounds. Graph continues to derive canvas geometry, colors, labels, collapse state, and semantic
navigation. Moving an Office agent to reception or the bar never changes the model parent.

The model contains complete admitted topology within the existing snapshot parser limits.
Projection-specific bounds are applied afterward so future tree or city themes can choose their
own presentation without changing the shared source.

### Preserve optional worktree metadata at admission

The bridge already emits optional workspace worktree metadata, but the browser snapshot parser
currently omits it. The parser will validate and retain the bounded worktree object so shared space
nodes can expose the existing repository-name decoration. Repository paths and keys remain
internal and are not added to Graph labels, search text, diagnostics, or cross-host identity.

## Risks / Trade-offs

- [Shared-model refactoring changes both current themes] → Preserve Office projection outputs with
  focused regression tests before relying on the new Graph behavior.
- [A third Graph level can create overlapping force clusters] → Use level-specific spring and
  repulsion distances, deterministic seeds, and browser checks at presentation bounds.
- [Configured but unavailable hosts have no activity status] → Render connection state explicitly
  and leave descendants empty rather than inventing topology.
- [Old manual layouts do not include host anchors] → Advance the bounded preference key and fit the
  first host-first view once.
- [Future subagent data may use a different identity contract] → Keep generic parent IDs while
  requiring a separate admitted-source contract before creating those relationships.

## Migration Plan

Introduce the model and adapt Office first under unit tests, then adapt Graph and its saved-view
schema. No persisted runtime data or bridge migration is required. Rolling back the browser change
restores the prior projections; the new local preference key is harmless to older builds.
