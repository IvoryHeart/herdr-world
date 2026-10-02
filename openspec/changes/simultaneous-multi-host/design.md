## Context

See [proposal.md](proposal.md) for the product outcome. The service already isolates
local and SSH runtimes and routes explicit connection IDs and runtime generations.
The foundation migration deliberately retained one operational browser host.

Relevant owners, relative to the repository root:

| Owner | Current constraint | Planned responsibility |
| --- | --- | --- |
| `server/src/connections/{manager,rpc-routing,http-routing}.ts` | Qualified runtime routing already exists | Preserve dispatch-time leases and reject unavailable targets without fallback |
| `web/src/api.ts` | One active connection and browser generation invalidate all scoped clients | Concurrent clients over one transport, invalidated by their own runtime or browser transport |
| `web/src/store.ts` | Cached sessions are swapped into one active operational state | Independently addressable connection sessions and explicit workspace navigation |
| `web/src/world/{runtimeStore,worldObject}.ts` | Aggregate observation with selected-host actionability | Aggregate identities, current admission state and separate view filtering |
| `web/src/world/WorldFoundationApp.tsx` | Selected-host projection and shared Spaces-owned resources | Application shell with explicit view, selection and operational contexts |
| `web/src/components/TerminalView.tsx` and Inspector resources | Read the active store | Read and act through an explicit owning context |
| `server/src/world/snapshot.ts` | One selected-host scheduling preference | Bounded priorities for open and visible contexts with background progress |

The review ran 52 focused tests across connection protocol routing, the browser API,
WorldObject and visual actions with no failures. Those tests establish the current
single-host contract, not evidence that simultaneous operation already works. Live
local/SSH and browser acceptance remain implementation tasks.

## Goals / Non-Goals

**Goals:** independently usable contexts on several managed runtimes; filters with
no connection side effects; one qualified identity from overview through dispatch;
host-local failure recovery; reuse of existing terminal and resource implementations.

**Non-Goals:** automatic scheduling, moving agents between machines, broadcasting
commands, new agent lifecycle semantics, multi-user access, a second browser
transport per host, or a replacement Herdr terminal protocol. Shared native tab
layout, pane focus and dimensions retain their existing Herdr constraints.

## Decisions

### Separate connection lifecycle, filters, selection and operation targets

The connection catalogue owns runtime lifecycle. A persisted host filter owns only
overview and navigator visibility. Visual selection owns the entity chosen for
inspection. A focused window owns keyboard input. An operation captures its own
connection ID, runtime generation and resource identity.

All hosts is the initial filter. An explicit saved filter is restored after reload;
an old selected-host preference is not interpreted as a new filter. Removed profile
IDs are pruned; if none of the saved IDs remain, restore All hosts with an explanation.
Zero managed profiles shows onboarding; an offline catalogue still opens the World
overview with health and stale labels. Filtering out an Inspector's entity preserves
the Inspector and identifies it as outside the filter. Its connector is omitted
when the exact visual anchor is absent.

A single-host filter can prefill a global creation destination, but submission still
shows and validates the destination. Creation from a room inherits that room's
target. Neither a filter nor keyboard focus supplies an implicit fallback host.

Renaming the existing selector or switching the global host around every action
would retain races between windows and pending requests. Both alternatives are
rejected.

### Keep one transport and independent runtime leases

Evolve `Bridge.connection` to require an explicit connection and runtime generation
for operational clients. Validity depends on the browser transport epoch and the
target runtime's current generation, not global selection. Pending calls, events,
HTTP resources, terminal frames and clipboard/popups must retain this qualification.

| Transition | Invalidation |
| --- | --- |
| Filter, visual selection or window focus changes | No connection lease invalidation |
| Profile disconnect, removal or runtime replacement | Retire that connection's old contexts and requests |
| World transport disconnect or authentication loss | Invalidate all operational contexts |
| Entity or agent session replacement | Retire only matching entity/session work |
| Close a window | Release that window's presentation and requests without closing Herdr work |

Server dispatch remains authoritative and checks current leases and capabilities.
Retain legacy omitted-ID compatibility only for existing legacy clients; new World
operations must explicitly qualify both connection and generation. Do not replay
terminal input or automatically retry ambiguous mutations after a disconnect. Report
an uncertain outcome and refresh the exact target before the user retries.

### Promote session partitions into operational contexts

Use the existing per-connection session partitioning rather than a second application
store. Separate application preferences/catalogue, connection-owned runtime state,
workspace navigation, and Inspector-owned resource state. Introduce context-bound
selectors and actions, using a scoped provider where it lets existing components
retain their resource implementation without ambient global state.

Capture finer identities where needed: Files belongs to its workspace/checkout;
History and agent checkout Changes also belong to an agent session. A reply can
update only the owning resource request. Focusing a sibling pane must preserve valid
workspace resources while rejecting old agent-session content.

Audit Files, Changes, annotations, uploads, history, launchers, worktree actions,
popups, clipboard, notifications and all shortcuts. Hidden Spaces cannot supply a
target to a visible visual action. Retaining a singleton behind a context-shaped
wrapper is insufficient if effects or event consumers still use active-host state.

### Share terminal ownership across presentations and hosts

Keep one conversation per qualified Herdr tab and one live presentation per qualified
terminal. Identity includes connection, runtime generation, workspace, tab, pane and
terminal where applicable; agent resources additionally validate session identity.
Open conversations can span hosts. The existing one-docked-Inspector rule remains:
ordinary docked selection replaces that docked conversation, while explicitly opened
floating windows retain independent contexts.

Window focus controls input and command targeting without changing other contexts.
Retain existing exclusive presentation handoffs between Spaces and visual views:
entering Spaces suspends visual presentations, preserves their resource state and
hands off the exact selected terminal after detachment. Spaces focuses one qualified
workspace at a time; changing it does not retire unrelated visual conversations.
Returning to a visual view restores still-current conversations across hosts.

Filter changes do not alter arrangements. Arrangements operate on the current view's
eligible windows across hosts, even when their targets are filtered out. Close all
in a visual view closes its open conversations, including hidden ones; it never
stops agents. Open all operates only on currently filtered, actionable tabs, with
fresh target admission, and reports unavailable or omitted targets. Spaces retains
its workspace-local arrangement scope. Generation changes remove only the affected
windows from an arrangement and its restore snapshot.

### Aggregate views share filters and honest coverage

Office groups rooms by host; Tree and Graph retain host roots. All use the same
filtered WorldObject and qualify labels, selection and persisted layout by owning
connection. Search and counts distinguish matching observed entities, rendered
entities, omissions and stale/unknown coverage; no missing observation is reported
as zero agents.

Retain Tree and Graph's 128-space total and 16-leaf-per-space presentation bounds,
applied across the filtered host set. Retain all managed host roots within the
existing catalogue limit, and report omissions at global and branch levels. Preserve
selected, focused, watched and attention-requiring entity priority, then distribute
remaining space capacity across hosts before adding more from any one host. Search
uses the full filtered admitted observation, returns bounded qualified results and
reveals a chosen result by making room in the bounded projection. Renderer bounds
must not silently make an observed entity unfindable. Office retains its existing
desk bounds and overflow semantics within explicit host groups.

Pinned only intersects the host filter; it does not silently drop a watch because
another host has keyboard focus. Notifications open an exact qualified context even
outside the filter, with a reveal action, without changing the filter or unrelated
windows. Stale notifications cannot bind to a replacement generation or session.

### Preserve bounded observation with fair priorities

Retain the 20-second aggregate response deadline, at most four concurrent host
observations, generation checks, cached partial results and coalesced invalidation.
Extend the optional scheduling input to a validated, bounded set of connection IDs
from open contexts and the view filter. IDs grant scheduling priority only. Retain
the existing single-ID hint as a compatibility shorthand.

Deduplicate priority IDs, reject malformed/unknown IDs and rotate within priority
classes. Reserve background progress when unprioritized ready hosts exist. Observe
each completed host independently; no control operation waits for an all-host
refresh. A partial aggregate response alone does not retire an admitted live
Inspector whose current owning runtime still confirms its target.

Test deadline, fairness and no redundant fetches deterministically. Measure payload,
time to current observation and input responsiveness with many hosts and at least
two live terminal contexts. Keep the existing snapshot transport initially; adopt
per-host streaming only if measured acceptance cannot be met with bounded snapshots.

## Risks / Trade-offs

- Ambient active-store reads can cross-route data or input → inventory every
  operational consumer and test duplicate native IDs across two runtimes.
- Browser and server generations can be confused → keep transport epoch, runtime
  generation and entity/session identity distinct and test each retirement boundary.
- Several terminals can compete for focus or clipboard → qualify ownership and
  test interleaved input, popups, uploads and delayed resource replies.
- Aggregate views can imply completeness → show stale health and overflow counts,
  keep search independent of renderer truncation, and test dense uneven hosts.
- Observation work or terminal output can starve another host → retain bounded
  scheduling and test a noisy host alongside interactive healthy-host operations.
- The refactor touches upstream-derived code → preserve existing components and
  identify the context boundary in the foundation guide for later upstream merges.

## Migration Plan

1. Implement concurrent API leases and connection contexts behind the current UI.
   Prove two synthetic hosts with colliding IDs can own two terminals and a Files
   Inspector concurrently before enabling aggregate presentation.
2. Migrate all operational consumers, event/resource paths and exclusive terminal
   handoffs. Preserve focused-workspace Spaces behavior through explicit context.
3. Enable aggregate views, filter persistence, connection management and fair
   observation priorities together once the operational slice is verified.
4. Complete qualified creation, notifications, watches, command menus and window
   arrangements; run local/SSH, failure, scale and compact-layout acceptance.
5. Synchronize the two current capability specs, including their single-host Purpose
   text, and update README, FEATURES, architecture, source maps and tutorial. Add the
   user-facing changelog entry in the implementation commit. Preserve historical
   foundation records as history.

Keep planning artifacts on this branch and implementation tasks unchecked until
their evidence exists. Do not expose an aggregate operational UI while any active
path still relies on the global host. Rollback deploys the prior build and restores
the old selector behavior without rewriting connection profiles; version new browser
preferences so older builds can ignore them. Open windows are browser-session state
and must be re-admitted after either upgrade or rollback.
