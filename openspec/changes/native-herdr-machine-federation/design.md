## Context

Herdr World currently assigns one Herdr runtime to each World bridge and aggregates those bridges
in the browser. Remote use consequently requires a World installation and browser-reachable HTTP
service on every machine, plus reciprocal Origin/CSP configuration and separate connection
profiles.

The World bridge is already a Herdr client. It uses a reviewed copy of Herdr's API and terminal
protocol types to connect to one local Unix socket, take an authoritative snapshot, subscribe to
events, dispatch allow-listed commands, and open terminal streams by terminal ID. Herdr's server
does not require that client to be the native TUI.

Herdr's native remote path confirms the relevant transport model. It presents a local socket to
ordinary client code and relays that socket through OpenSSH to a helper connected to the remote
Herdr socket. A live investigation recorded in this change proved real SSH-agent authentication,
remote workspace control, and a protocol-22 snapshot on Herdr master. It also proved that the
public `--machine` CLI exposes only command-scoped operations, not a reusable long-lived stream.

The absence of a public stream does not prevent a compatible client from connecting to the remote
server. It means World must either wait for Herdr or Herdr Web to publish the relay, or own a small
Herdr adapter around the same pinned socket transport. This revision chooses the latter and keeps
the Herdr semantics separate from connection mechanics so equivalent upstream work can replace the
relevant layer later.

## Goals / Non-Goals

**Goals:**

- Give the normal desktop product one World-owned connection list and browser origin for Local plus
  explicitly configured remote Herdr runtimes.
- Give the bridge one Herdr-specific adapter that consumes the existing local socket or a new
  SSH-backed connection mechanism.
- Use ordinary OpenSSH configuration and agent state without storing credentials or private keys.
- Preserve complete Herdr topology, structural commands, launchers, terminal-ID streams, and the
  browser terminal behavior World already supports.
- Preserve one qualified `WorldModel`, independent runtime failures, and stale-generation fencing.
- Keep Herdr adaptation and connection mechanics in upstream-aligned bridge code so they can be
  proposed to or replaced from Herdr Web without rewriting World projections.
- Keep the Herdr plugin limited to installing, starting, and opening World; it does not own or limit
  the connection list.
- Keep direct World bridge profiles usable throughout migration.

**Non-Goals:**

- Build a generic backend/provider framework, public provider SDK, dynamic provider loading, or VS
  Code or another non-Herdr integration.
- Change Herdr's server protocol or make a Herdr server aware of World.
- Install, replace, or upgrade Herdr automatically on a remote machine.
- Store passwords or private keys, implement an SSH agent, answer interactive SSH prompts, or edit
  the user's OpenSSH configuration.
- Expose a general SSH proxy, remote shell, arbitrary Herdr method, or transport control to the
  browser.
- Infer authoritative topology from a TUI-selected surface.
- Remove explicit direct World bridge profiles in this change.

## Decisions

### Separate World, Herdr-adapter, and connection-mechanism responsibilities

The bridge keeps three internal responsibilities distinct without requiring separate packages,
services, a public provider API, or dynamic loading:

| Boundary | Responsibility |
| --- | --- |
| World runtime registry | Connection list, access policy, routing, runtime identity, reconnect generations, and World-owned data |
| Herdr adapter | Herdr API requests, snapshot/event ordering, capabilities, native identifiers, state and command mapping, terminal semantics, compatibility checks, and the pinned remote relay command |
| Connection mechanism | Open, supervise, cancel, and bound byte streams through the selected local socket or OpenSSH path without understanding Herdr agents, panes, layouts, or World views |

The Herdr adapter must be able to obtain:

- an API connection factory so the event subscription and request clients can progress
  independently;
- terminal connections opened for explicit terminal IDs;
- bounded byte delivery for uploads before the feature reaches final acceptance.

The World registry assigns connection identity and generations. Each connection mechanism reports
readiness, closure, and bounded transport diagnostics without interpreting Herdr protocol state.

An implementation may pool or multiplex connections only when it preserves independent progress
and failure isolation. A single synchronous relay that lets an event subscription block later
command or terminal connections does not satisfy the adapter contract.

The adapter remains deliberately Herdr-specific and preserves full Herdr behavior. World will
evolve the common model only when a second concrete backend demonstrates a real difference; this
change creates no generic backend interface.

### Let World own Herdr connections and their lifecycle

World stores Herdr connections in its trusted bridge configuration. Each remote connection
contains:

- an opaque stable connection ID;
- an opaque runtime-binding ID for the current target/session assignment;
- a user-facing label;
- one OpenSSH target or SSH-config alias;
- one explicit pre-provisioned Herdr session name;
- enabled state.

The connection identifies a particular Herdr runtime, not merely a machine. The SSH target and
session are connection configuration, not runtime entity identity. World does not derive the stable
connection ID from either field. Each target/session assignment also receives a
persistent opaque runtime-binding ID. Reconnects to the same assignment retain that binding, while
editing either transport field retires the current generation, mints a new runtime-binding ID,
detaches existing viewers, and reconnects as a distinct runtime. Notes, pins, activity, and cached
references from the old binding remain associated with it and do not attach to or get pruned by the
new server, even when native IDs collide.

Connections contain no passwords, private keys, agent tickets, or generated shell text. OpenSSH
remains authoritative for hostname resolution, users, ports, key selection, agents, host keys,
proxy jumps, control sockets, and related policy. A user chooses a key through normal OpenSSH
configuration or `ssh-agent`, not by uploading key material into World.

Herdr's saved-machine catalogue may be used later as an import convenience, but it is not
authoritative over World's connections. An import copies an explicit target and session into a
World connection; subsequent catalogue edits, deletion, or availability do not silently retarget,
disable, or remove that connection. Import is not required for this delivery.

The bridge invokes the local OpenSSH executable directly without a local shell. OpenSSH sends one
fixed, correctly encoded relay command that the SSH server executes through the remote user's login
shell. World accepts no user-selected shell program or shell text; the configured target and
session occupy validated values and cannot supply extra local flags, remote commands, or
destinations. Tests must observe what the remote process actually receives rather than proving only
the local argument vector.

The Herdr adapter owns the reviewed remote relay command as a pinned compatibility dependency
separate from API and
terminal protocol compatibility. The current `v0.9.0` compatibility source does not provide the
required `remote-api-bridge`; the inspected Herdr master revision `18061191` does. Connection
admission therefore requires an exact executable/relay revision, deterministic noninteractive
executable lookup, selected session, relay capability probe, and stream framing in addition to API
and terminal protocol checks. The API relay requires an already-running compatible session and
must support metadata access before any terminal attachment. Adopting another Herdr revision
requires rerunning adapter and connection conformance and updating provenance.

Remote Herdr must already be compatible and reachable. When host trust, authentication, remote
installation, update, or server replacement requires interaction, the connection reports bounded
Attention guidance and leaves that action to the user in a normal terminal. Background World
services do not answer prompts.

### Keep Herdr authoritative above the transport

Once the relay reaches the remote socket, World uses the same reviewed API and terminal protocols
as it uses locally. Herdr remains authoritative for workspaces, tabs, panes, terminal IDs, layout,
agents, commands, launchers, and terminal message semantics. The remote server need not distinguish
the native TUI from the World bridge.

World remains authoritative for its connection list, process supervision, browser adaptation,
runtime qualification, generation fencing, bounded command admission, notes, pins, observed
activity, uploads, and browser viewer lifecycle.

The Herdr adapter owns the documented snapshot/event sequence: establish and acknowledge the
structural subscription, buffer events, request the snapshot on an independent API connection,
then apply the snapshot and buffered events without a gap. It maps Herdr capabilities and native
entities into the qualified World runtime input without teaching World views about Herdr protocol.

### Qualify every runtime and connection generation

The stable identity of an entity is:

```text
(gateway_id, runtime_id, native_entity_id)
```

`gateway_id` distinguishes direct World gateways. Within a gateway, `runtime_id` is Local or the
remote connection's opaque runtime-binding ID. `connection_id` identifies editable connection
configuration and is not an entity namespace. `native_entity_id` remains the authoritative Herdr
workspace, tab, pane, terminal, or agent ID.

Every asynchronous value is also fenced by the connection generation:

```text
(gateway_id, runtime_id, generation)
```

Snapshots, events, command results, upload results, and terminal frames from a retired generation
are discarded. A surviving SSH process is not proof that the API generation remains healthy. A
failed API or subscription retires the generation and requires a fresh subscription and snapshot.

Local, SSH-backed, and direct compatibility sources all enter the existing
`WorldRuntimeSource`-to-`WorldModel` path after qualification. Tree, graph, office, Spaces, and
other projections consume that one model.

### Bind browser viewers to terminal IDs

The Herdr adapter opens the same terminal protocol by explicit terminal ID over either connection
mechanism. It does not consume a TUI-selected surface. Native focus and zoom changes therefore
cannot retarget a browser viewer.

World owns viewer fan-out, focus state, scroll state, dimensions, detach, idle reaping,
backpressure, limits, and reconnect reattachment. Input and control are qualified by runtime,
terminal ID, viewer connection, and generation. Existing output, input, resize, scroll, graphics,
bell, clipboard, IME, and refit behavior must remain compatible.

Any terminal attachment ownership or conflict semantics exposed by the pinned Herdr server are
recorded by the live proof and preserved. World does not silently take over a terminal or redirect
input to another pane.

### Keep connections and remote transport behind one browser origin

The browser talks only to the serving World bridge. A remote Herdr machine needs no World HTTP
listener, Host/Origin policy, browser password, or CSP destination. Direct bridge profiles retain
their existing cross-origin behavior.

Connection mutation and target/session disclosure initially reuse the existing local-management
boundary: the TCP peer must be actual loopback in addition to passing ordinary Host and Origin
checks. A remote client is not allowed to administer connections merely because it has an admitted
runtime session or password. This adds no multi-user role system. The bridge validates connection
IDs, labels, targets, sessions, bounds, and allowed state transitions. A local browser can manage a
connection only through those explicit operations; it cannot select an executable, add SSH options,
provide a remote command, obtain credentials, or invoke the bridge as a general proxy.

Runtime descriptors expose only the opaque runtime ID, label, state, generation, capabilities, and
World runtime data. Settings may show the configured target and session only across the same
actual-loopback local-management boundary used for editing that connection; snapshots, model
payloads, routine logs, and unrelated browser clients do not contain those fields.

Exposing the serving bridge beyond loopback grants an admitted browser terminal-equivalent access
to every enabled runtime that gateway exposes. Settings must state that scope. Password
authentication does not replace TLS or a trusted network for non-loopback access.

### Preserve World-owned data and uploads

Notes, pins, observed activity, and cached references add the stable runtime ID beside the native
entity ID. Existing unqualified records migrate to Local. Snapshot pruning and event-derived state
operate within one runtime and generation.

World continues to own upload admission, size limits, basename sanitization, overwrite choice,
cancellation, runtime and pane validation, and terminal insertion. The connection mechanism will
provide bounded byte delivery while the Herdr adapter maps the resulting private remote path into
the selected pane without accepting browser-supplied destinations or shell text. World inserts that
path only after delivery succeeds in the current generation. The exact transfer mechanism is
selected and proven before final acceptance rather than prescribed by this proposal.

### Start the gateway independently of each runtime

The bridge binds its HTTP service and starts its runtime registry before any one runtime becomes
ready. Healthy Local remains usable when every remote connection or SSH dependency fails. Healthy
remote runtimes remain usable while Local is missing or restarting. One remote failure does not
block another connection or its reconnect schedule.

The Herdr plugin installs, starts, and opens one local World bridge. The existing injected socket
may bootstrap the initial Local connection, but the plugin neither owns nor limits the World
connection list, and remote connections do not pass through that Local Herdr session. Its generated
service environment must preserve a usable `SSH_AUTH_SOCK` when present. Remote SSH processes are
children of the World bridge; no plugin or World service is installed remotely.

### Keep the Herdr boundary ready for Herdr Web adoption

Herdr World owns and can change its packaged bridge, which is derived from Herdr Web's
`herdr-web-bridge`. Herdr adapter and connection-mechanism code will stay in the upstream-aligned
bridge layer and avoid dependencies on World themes, notes, or projections. Their contract and live
fixtures will be documented well enough to propose upstream.

Herdr Web currently supports direct browser connections to multiple Web bridges. It does not
currently ship an SSH-backed Herdr connection. If an equivalent implementation lands upstream,
World will compare it against the pinned adapter/connection contract and adopt it through the normal
upstream synchronization process when compatible. Waiting for upstream acceptance is not a gate
for this downstream delivery.

### Advance through evidence-backed checkpoints

Work proceeds through four checkpoints:

1. **Prove the Herdr connection.** Create the smallest SSH-backed Herdr connection and prove a full
   snapshot,
   gap-free subscription, concurrent structural commands, and a launcher through the managed World
   service environment with a real SSH agent.
2. **Prove terminal compatibility.** Hold two explicit terminal-ID streams while the subscription
   and command path remain active, and verify the existing browser terminal semantics against a
   native client.
3. **Prove the thin World integration.** Add Local and one remote connection to the existing runtime
   registry and `WorldModel` through one origin, including connection lifecycle and failure isolation.
4. **Complete product acceptance.** Finish reconnect generations, transport diagnostics, uploads,
   persistence, browser security and settings, bounds, documentation, upstream comparison, and
   end-to-end acceptance.

Each proof records the exact Herdr and World revisions, protocol versions, OpenSSH environment,
observable result, and stop condition. Mocked SSH tests support implementation but cannot replace a
real connection proof.

## Risks / Trade-offs

- **World now owns SSH process lifecycle.** The connection mechanism is deliberately narrow, uses
  OpenSSH as the policy engine, avoids a local shell and user-supplied shell text, and keeps remote
  setup interactive and external. The fixed relay command still passes through the remote login
  shell as required by OpenSSH.
- **The relay command is not a stable public Herdr API.** World already pins private Herdr API and
  terminal compatibility. The relay joins that reviewed compatibility surface and must pass live
  conformance for every adopted revision.
- **World and Herdr have separate catalogues.** World connections are explicit gateway
  configuration. A later import convenience may copy a Herdr saved profile into a World connection,
  but Herdr catalogue synchronization and authority are outside this change.
- **Managed services may lose agent access.** Service generation preserves `SSH_AUTH_SOCK`; live
  acceptance must prove the actual supervisor environment and report Attention when the socket is
  absent or stale.
- **One gateway grants broad authority.** Loopback remains the default, remote exposure stays
  explicit, and admitted users are told that the gateway controls every enabled connection.
- **A generic backend abstraction would be premature.** This change contains Herdr-specific
  knowledge and separates connection mechanics only where Local and SSH require it. A common
  backend contract waits for a second concrete implementation.

## Migration Plan

1. Replace the obsolete public-machine-stream gate with the Herdr adapter/connection contract and
   preserve the prior investigation as rationale.
2. Implement and prove the SSH-backed connection against one pre-provisioned remote Herdr session.
3. Add remote connection persistence and the bounded Local-plus-remote runtime registry path.
4. Complete terminal, lifecycle, upload, security, persistence, and browser acceptance.
5. Compare the proven seam with current Herdr Web, propose reusable bridge work upstream, and adopt
   an equivalent upstream implementation if and when it lands.
6. Make the single-gateway path the normal experience only after complete acceptance; keep direct
   bridge profiles available.

Rollback disables remote Herdr connections and leaves the existing Local and direct-bridge paths
unchanged. Qualified Local records remain readable, and rollback does not mutate remote Herdr
sessions or OpenSSH configuration.

## Open Questions

- Select the bounded remote byte-delivery mechanism from the connection proof.
- Select connection retry, idle relay, and global connection limits from live stress results.
