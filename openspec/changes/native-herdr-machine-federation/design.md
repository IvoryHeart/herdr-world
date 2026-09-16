## Context

See [proposal.md](proposal.md) for the product motivation and the delta specifications for required
behavior. The maintained federation contract currently assigns one Herdr runtime to each World
bridge and aggregates those bridges in the browser. Browser security consequently requires a
reachable World bridge on every host, reciprocal destination CSP and target Origin admission, and a
second set of browser connection profiles.

Herdr already owns the operator's machine catalogue and native connectivity model. It knows the
saved profile, SSH semantics, remote Herdr executable, selected session, server bootstrap sequence,
authentication and host-key failures, and reconnect behavior. The complete Herdr session API also
contains the state World needs: workspaces, tabs, panes, terminal IDs, pane revisions, layouts,
events, structural commands, and launchers.

The narrower client-selected surface is insufficient for World. It follows one client's selected
tab and shared focus or zoom state, omits terminal IDs and other authoritative topology fields, and
cannot dispatch every operation World already exposes. Browser sessions also need terminal streams
bound to explicit terminal IDs so two viewers can remain on different panes while a native client
changes focus.

The implementation spike preserved in closed
[PR #91](https://github.com/IvoryHeart/herdr-world/pull/91) tried to bridge that gap with a
World-owned OpenSSH Unix-socket forwarding supervisor and private Herdr bootstrap helpers. It
produced dormant transport code before proving the real saved-machine path, and its synthetic tests
missed installed-OpenSSH behavior that removed the required forward. Fixing that individual option
would still leave World responsible for a second implementation of Herdr's transport policy,
failure model, and private bootstrap details.

That evidence changes the implementation boundary, not the product contract. World will consume a
supported Herdr multihost interface and will not construct the remote connection. Herdr's current
reviewed release does not yet provide the complete reusable, machine-qualified stream. This change
therefore starts with an upstream Herdr contract and end-to-end proof before any World integration.

## Goals / Non-Goals

**Goals:**

- Give the normal desktop product one World gateway and one browser origin for Local plus Herdr
  saved machines.
- Use one supported Herdr-owned multihost integration boundary for machine discovery and remote
  connectivity.
- Preserve complete World topology and layout fidelity, structural commands and launchers,
  terminal-ID isolation, runtime qualification, failure isolation, and stale-generation fencing.
- Keep notes, pins, observed activity, browser authorization, upload policy, and browser protocol
  adaptation in World.
- Prove the Herdr contract against a real saved machine before World depends on it.
- Keep direct World bridge profiles usable as the compatibility path during migration.

**Non-Goals:**

- Implement or supervise SSH, remote shell commands, Herdr executable discovery, or server bootstrap
  in World.
- Copy Herdr's private remote implementation into `vendor/herdr-compat`.
- Define Herdr's internal process topology or SSH implementation.
- Add a browser-reachable listener or World installation to a saved remote machine.
- Store credentials, answer interactive prompts, edit profiles, or expose machine targets to the
  browser.
- Reconstruct authoritative state from a TUI-selected client surface.
- Remove direct bridge profiles in this change.
- Aggregate arbitrary sessions outside the saved profile and session choices admitted by Herdr.

## Decisions

### Require one supported Herdr multihost integration boundary

World depends on one versioned Herdr integration boundary for native multihost behavior. That
boundary may consist of separate supported catalogue, API, terminal, and delivery entry points; it
does not require Herdr to add an aggregate daemon or shared socket. Herdr may implement those
surfaces with processes, commands, libraries, or another internal arrangement. The supported
interface must provide these observable semantics:

| Concern | Required Herdr surface |
| --- | --- |
| Machine discovery | Opaque stable machine ID, display label, enabled and availability state, capabilities, and connection generation |
| Topology | Authoritative full session snapshot with workspaces, tabs, panes, terminal IDs, revisions, layouts, agents, and optional worktree data |
| Change stream | Structural subscription with an ordering rule that prevents a snapshot/subscription gap |
| Control | Machine-qualified structural commands and launcher operations with bounded typed results |
| Terminals | Streams opened by terminal ID with output, input, focus, resize, scroll, graphics, bell, and explicit non-takeover ownership behavior |
| Upload transport | Bounded byte delivery to a private path on the selected machine without browser-supplied shell text or destination |
| Lifecycle | Connection generation, closure, reconnect, capability, and incompatibility events |
| Recovery | Structured machine-local authentication, host-key, bootstrap, version, and transport errors with Herdr-owned operator guidance |

Supported catalogue output may include connection metadata such as target or session fields. The
trusted local bridge treats those fields as sensitive, does not persist or log them, and discards
them before constructing browser-facing descriptors. It uses only Herdr's opaque saved-machine ID
to request native connectivity and does not use catalogue metadata to construct SSH, choose remote
bootstrap behavior, or make transport decisions. Credentials and shell construction remain outside
World, and none of these transport details reach the browser. Interface versions and capabilities
are checked before World admits state or control.

Herdr remains responsible for saved-profile selection, SSH configuration and execution,
authentication and host-key interaction, remote executable discovery, server bootstrap, session
selection, connection retry, and transport-level error classification. World does not parse SSH
stderr or reproduce those decisions.

### Prove the Herdr interface before building the World adapter

The first bounded live experiment uses only Herdr's supported public surface for Local and a real
saved machine. It keeps one structural event subscription open while it issues commands and
launcher operations and holds two terminal attachments concurrently. It runs through the same
managed plugin or service environment World ships, including its real SSH-agent availability,
rather than relying only on an interactive shell. This specifically rejects a transport that
serializes one long-lived subscription, command, or terminal connection behind another.

That first experiment may defer complete upload and failure-path coverage. The upstream interface is
accepted, and World integration starts, only after the full end-to-end conformance fixture proves:

- the complete snapshot fields required by World;
- subscription establishment and snapshot ordering without an event gap, with the subscription
  remaining live while commands, launcher operations, and both terminal attachments are active;
- connection generation change and stale-stream retirement after restart;
- layout apply and export, pane movement, managed agent launch, and an overview action when no
  terminal viewer exists;
- two terminal-ID streams on different panes of one split or zoomed tab while a native Herdr client
  changes focus and zoom, including compatible output, input, focus, resize, scroll, graphics, and
  bell behavior;
- non-takeover attachment conflict behavior with an existing owner;
- authentication, host-key, bootstrap, version, and server-restart failures as structured
  machine-local states; and
- bounded remote byte delivery and cleanup for the upload lane.

The proof records the exact Herdr release or commit, protocol version, advertised capabilities,
managed execution environment, and fixture result. A source-only adapter test, mocked SSH process,
interactive-shell-only run, or private command invocation does not satisfy this gate. If the actual
supported interface differs from this design, this same change is updated before World
implementation rather than hiding the difference in adapter code.

### Adapt Herdr into a World runtime registry

After the conformance gate passes, the serving bridge consumes Herdr's machine catalogue and
represents Local and each enabled saved profile as a logical runtime. It exposes sanitized
descriptors and qualified World state through one same-origin browser gateway.

The stable identity of an entity is:

```text
(gateway_id, runtime_id, native_entity_id)
```

`gateway_id` distinguishes direct World gateways. Within a serving gateway, `runtime_id`
distinguishes Local and Herdr machine profiles. `native_entity_id` remains the authoritative
Herdr workspace, tab, pane, terminal, or agent ID.

Every admitted asynchronous value is also fenced by the current connection generation:

```text
(gateway_id, runtime_id, generation)
```

World may compose a bridge lifecycle counter with Herdr's transport generation, but it never treats
a reconnected stream as the previous generation. Snapshots, events, command results, upload results,
and terminal frames from retired generations are discarded.

The browser continues to use the existing qualified World model. One configured desktop or Android
gateway profile expands into every logical runtime advertised by that gateway. Direct World bridge
profiles remain distinct compatibility entries even if an operator points one at the same Herdr
server.

Local, saved-machine, and direct compatibility sources all enter the existing
`WorldRuntimeSource` to `WorldModel` ingestion path after qualification. Tree, graph, office, and
other projections consume that one model. Native federation does not add a parallel topology store
or presentation-specific source path.

### Preserve the full session API model

Each admitted machine stream supplies the same authoritative data required by the existing World
conversion. World does not infer complete layouts, terminal identity, pane revisions, or missing
entities from a client's selected tab.

The subscription is established according to Herdr's supported ordering contract before the
snapshot is admitted. If the API stream or structural subscription fails, World retires that
runtime generation even if Herdr's underlying carrier still exists. Control resumes only after a
fresh compatible generation, subscription, and snapshot.

Every browser operation stays on World's existing allow-list and targets an admitted runtime and
entity. The bridge maps that operation to Herdr's supported machine stream. It does not fall back to
a remote CLI or shell when a capability is missing.

### Bind browser viewers to terminal IDs

World opens terminals through Herdr's supported terminal-ID stream. It does not use a selected TUI
surface or create a separate SSH process. One terminal stream may fan output out to bounded browser
viewers while each WebSocket keeps its own focus, scroll, and dimensions.

Input and control remain qualified by runtime, terminal ID, viewer connection, and generation.
Native focus or zoom changes do not retarget the browser attachment. Viewer detach, idle reaping,
backpressure, per-session and global limits, and reconnect reattachment remain World bridge
responsibilities.

World requests non-takeover behavior. If a native client or another gateway owns the terminal,
Herdr preserves the current owner and returns a structured conflict. World performs only bounded
retries and reports "Attached elsewhere."

### Keep World data and upload policy machine-qualified

Notes, pins, and observed activity remain in the serving World bridge. Persisted references add the
stable runtime ID beside the native entity ID. Existing unqualified records migrate to Local.
Snapshot pruning and event-derived state operate within one runtime and generation so equal native
IDs on two machines cannot overwrite or prune each other.

World continues to own browser upload admission, size bounds, basename sanitization, overwrite
choice, cancellation, runtime and pane validation, and terminal insertion. For a saved machine it
passes the bounded bytes and sanitized metadata through Herdr's supported delivery capability.
Herdr owns remote transport and creates the private remote path. World inserts that path only after
delivery succeeds in the current generation.

The browser cannot supply a remote destination, profile target, or shell text. World does not invoke
SSH, stage through a remote shell, or expose a local path to a remote terminal. Failed or stale
delivery is scoped to that upload and machine.

### Start the gateway independently of Local

The bridge binds its HTTP service and starts the runtime registry before probing the selected Local
runtime. Local is one asynchronously supervised entry. If Local is missing or restarting, the
gateway remains reachable and any healthy saved-machine streams remain usable.

The inverse is also independent: the existing Local provider remains usable when the
saved-machine catalogue or every native transport entry point is unavailable. Gateway startup and
recovery tests cover both directions without requiring a duplicate direct profile for Local.

The World plugin continues to install, start, stop, restart, and open one local World bridge. It may
provide stable local lifecycle context, but it does not run remote plugins or supervise remote
transport. Herdr owns the multihost integration boundary and remote machine lifecycle. Selecting a
machine in a Herdr client does not move the World service to that machine.

### Keep native machines behind one browser origin

The browser talks only to the serving World bridge. Native machine HTTP and WebSocket operations
stay on that origin and require no remote World listener, remote Host or Origin admission, remote
password, or additional CSP destination. Direct bridge profiles retain the current cross-origin
security model.

The bridge exposes only opaque runtime identity, label, state, capabilities, and World runtime data.
Browser requests cannot choose a Herdr profile target or session, configure transport, or invoke an
arbitrary Herdr method.

Exposing the serving bridge beyond loopback grants an admitted browser terminal-equivalent access
to every enabled native runtime that gateway exposes. Settings must state that scope. Password
authentication remains a browser boundary and does not replace TLS or a trusted network for
non-loopback access.

## Risks / Trade-offs

- **The supported Herdr contract does not exist yet.** World native integration remains blocked and
  direct bridge profiles remain supported until Herdr lands and versions the complete surface.
- **The upstream contract drifts.** World pins the proven Herdr release or commit, checks protocol
  and capabilities, and reruns the conformance fixture before updating.
- **One upstream integration boundary contains shared components.** Each machine still has an
  independent logical connection and generation. World keeps Local and unaffected runtimes usable
  and reports catalogue or entry-point failure without admitting stale control.
- **Terminal ownership conflicts with native clients or direct gateways.** Non-takeover semantics
  preserve the current owner and World reports a bounded conflict.
- **A single exposed World gateway grants broad authority.** The bridge stays loopback by default,
  retains bounded authenticated sessions, discloses the complete machine scope, and never exposes
  raw transport controls.
- **Remote byte delivery expands the Herdr contract.** The primitive stays bounded and
  destination-free from the caller's perspective; World retains policy while Herdr retains remote
  transport ownership.
- **Machine removal races with browser work.** World retires the generation first and rejects later
  actions or results for that runtime.

## Migration Plan

1. Land and version the supported Herdr multihost contract and its integration surfaces.
2. Pass the Local and saved-machine conformance fixture and record the exact proven contract.
3. Update this change if the proven public surface changes any named requirement.
4. Pin that Herdr version in World and implement the runtime registry, state and command adapter,
   terminal-ID adapter, generation fencing, machine-qualified World data, and upload adapter.
5. Make one serving gateway the normal desktop and Android discovery path while retaining direct
   bridge profiles as compatibility entries.
6. Complete security, browser, failure, and local-plus-saved-machine acceptance checks before
   enabling native discovery by default.

Rollback disables native discovery and leaves the current browser-direct federation path intact.
Qualified records for Local remain readable, and rollback does not mutate Herdr profiles or remote
sessions.

## Open Questions

- Select bounded catalogue refresh or notification behavior from the proven Herdr interface.
- Select terminal viewer idle and global limits from browser stress results.
- Finalize labels for native machines, direct endpoints, and remote browser access after usability
  review.
