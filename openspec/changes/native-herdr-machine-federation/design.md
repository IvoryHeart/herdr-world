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
connector around the same pinned socket transport. This revision chooses the latter and isolates it
so an equivalent upstream implementation can replace it later.

## Goals / Non-Goals

**Goals:**

- Give the normal desktop product one World gateway and browser origin for Local plus explicitly
  configured remote Herdr runtimes.
- Give the bridge one Herdr connection contract implemented by the existing local socket connector
  and a new SSH-backed connector.
- Use ordinary OpenSSH configuration and agent state without storing credentials or private keys.
- Preserve complete Herdr topology, structural commands, launchers, terminal-ID streams, and the
  browser terminal behavior World already supports.
- Preserve one qualified `WorldModel`, independent runtime failures, and stale-generation fencing.
- Keep the connector in upstream-aligned bridge code so it can be proposed to or replaced from
  Herdr Web without rewriting World projections.
- Keep direct World bridge profiles usable throughout migration.

**Non-Goals:**

- Build a generic provider framework or integrate VS Code or another non-Herdr server.
- Change Herdr's server protocol or make a Herdr server aware of World.
- Install, replace, or upgrade Herdr automatically on a remote machine.
- Store passwords or private keys, implement an SSH agent, answer interactive SSH prompts, or edit
  the user's OpenSSH configuration.
- Expose a general SSH proxy, remote shell, arbitrary Herdr method, or transport control to the
  browser.
- Infer authoritative topology from a TUI-selected surface.
- Remove explicit direct World bridge profiles in this change.

## Decisions

### Add a Herdr-specific connector seam

The bridge will consume Herdr runtimes through one internal connector contract. A connector is
responsible for producing independent compatible connections to one Herdr server and reporting its
lifecycle. It does not translate Herdr state into World presentation objects.

The first implementations are:

| Connector | Target | Transport ownership |
| --- | --- | --- |
| Local | Existing selected Herdr session/socket | Existing World bridge session resolution |
| SSH | Compatible Herdr session on an OpenSSH target | World supervises the relay; OpenSSH owns SSH policy |

The contract must support at least:

- an API connection factory so the event subscription and request clients can progress
  independently;
- terminal connections opened for explicit terminal IDs;
- connector generation, readiness, closure, and bounded diagnostic state;
- bounded byte delivery for uploads before the feature reaches final acceptance.

An implementation may pool or multiplex transport only when it preserves independent progress and
failure isolation. A single synchronous relay that lets an event subscription block later command
or terminal connections does not satisfy the contract.

The seam remains Herdr-specific. A future non-Herdr source would provide its own adapter from that
server's concepts into the World runtime contract. SSH may be reused as a connector underneath such
an adapter, but this change does not speculate about that interface.

### Let World own remote profiles and connector lifecycle

World stores remote Herdr profiles in its trusted bridge configuration. Each profile contains:

- an opaque stable profile ID;
- a user-facing label;
- one OpenSSH target or SSH-config alias;
- an optional Herdr session name;
- enabled state.

The SSH target and session are transport configuration, not runtime entity identity. World does
not derive the stable profile ID from either field. Editing transport fields retires the current
generation before reconnecting.

Profiles contain no passwords, private keys, agent tickets, or generated shell text. OpenSSH
remains authoritative for hostname resolution, users, ports, key selection, agents, host keys,
proxy jumps, control sockets, and related policy. A user chooses a key through normal OpenSSH
configuration or `ssh-agent`, not by uploading key material into World.

The bridge invokes fixed executable arguments without a shell. The configured target and session
occupy validated argument positions and cannot supply extra flags, remote commands, destinations,
or shell fragments. The reviewed remote relay command is a pinned compatibility dependency just
like the currently vendored API and terminal protocol. Adopting a different Herdr release requires
rerunning connector conformance and updating provenance.

Remote Herdr must already be compatible and reachable. When host trust, authentication, remote
installation, update, or server replacement requires interaction, the connector reports bounded
Attention guidance and leaves that action to the user in a normal terminal. Background World
services do not answer prompts.

### Keep Herdr authoritative above the transport

Once the relay reaches the remote socket, World uses the same reviewed API and terminal protocols
as it uses locally. Herdr remains authoritative for workspaces, tabs, panes, terminal IDs, layout,
agents, commands, launchers, and terminal message semantics. The remote server need not distinguish
the native TUI from the World bridge.

World remains authoritative for connector profiles, process supervision, browser adaptation,
runtime qualification, generation fencing, bounded command admission, notes, pins, observed
activity, uploads, and browser viewer lifecycle.

The snapshot/event ordering remains the documented Herdr client sequence: establish and
acknowledge the structural subscription, buffer events, request the snapshot on an independent API
connection, then apply the snapshot and buffered events without a gap.

### Qualify every runtime and connection generation

The stable identity of an entity is:

```text
(gateway_id, runtime_id, native_entity_id)
```

`gateway_id` distinguishes direct World gateways. Within a gateway, `runtime_id` is Local or the
opaque World remote-profile ID. `native_entity_id` remains the authoritative Herdr workspace, tab,
pane, terminal, or agent ID.

Every asynchronous value is also fenced by the connector generation:

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

The SSH connector opens the same terminal protocol by explicit terminal ID that the local bridge
uses. It does not consume a TUI-selected surface. Native focus and zoom changes therefore cannot
retarget a browser viewer.

World owns viewer fan-out, focus state, scroll state, dimensions, detach, idle reaping,
backpressure, limits, and reconnect reattachment. Input and control are qualified by runtime,
terminal ID, viewer connection, and generation. Existing output, input, resize, scroll, graphics,
bell, clipboard, IME, and refit behavior must remain compatible.

Any terminal attachment ownership or conflict semantics exposed by the pinned Herdr server are
recorded by the live proof and preserved. World does not silently take over a terminal or redirect
input to another pane.

### Keep profiles and remote transport behind one browser origin

The browser talks only to the serving World bridge. A remote Herdr machine needs no World HTTP
listener, Host/Origin policy, browser password, or CSP destination. Direct bridge profiles retain
their existing cross-origin behavior.

Profile mutation is a narrow authenticated configuration operation. The bridge validates profile
IDs, labels, targets, sessions, bounds, and allowed state transitions. A browser can manage a
profile only through those explicit operations; it cannot select an executable, add SSH options,
provide a remote command, obtain credentials, or invoke the connector as a general proxy.

Runtime descriptors expose only the opaque runtime ID, label, state, generation, capabilities, and
World runtime data. Settings may show the configured target and session to an authorized user who
is editing that profile, but snapshots, model payloads, routine logs, and unrelated browser clients
do not contain those fields.

Exposing the serving bridge beyond loopback grants an admitted browser terminal-equivalent access
to every enabled runtime that gateway exposes. Settings must state that scope. Password
authentication does not replace TLS or a trusted network for non-loopback access.

### Preserve World-owned data and uploads

Notes, pins, observed activity, and cached references add the stable runtime ID beside the native
entity ID. Existing unqualified records migrate to Local. Snapshot pruning and event-derived state
operate within one runtime and generation.

World continues to own upload admission, size limits, basename sanitization, overwrite choice,
cancellation, runtime and pane validation, and terminal insertion. The SSH connector will provide
a bounded delivery operation that creates a private remote path without accepting browser-supplied
destinations or shell text. World inserts that path only after delivery succeeds in the current
generation. The exact transfer mechanism is selected and proven before final acceptance rather
than prescribed by this proposal.

### Start the gateway independently of each runtime

The bridge binds its HTTP service and starts its runtime registry before any one runtime becomes
ready. Healthy Local remains usable when every remote profile or SSH dependency fails. Healthy
remote runtimes remain usable while Local is missing or restarting. One remote failure does not
block another profile's connection or reconnect schedule.

The World plugin continues to manage one local World bridge. Its generated service environment
must preserve a usable `SSH_AUTH_SOCK` when present. Remote connectors are child processes of that
bridge; no plugin or World service is installed remotely.

### Keep the seam ready for Herdr Web adoption

Herdr World owns and can change its packaged bridge, which is derived from Herdr Web's
`herdr-web-bridge`. Connector code will stay in the upstream-aligned bridge layer and avoid
dependencies on World themes, notes, or projections. Its contract and live fixtures will be
documented well enough to propose upstream.

Herdr Web currently supports direct browser connections to multiple Web bridges. It does not
currently ship an SSH-backed Herdr connector. If an equivalent implementation lands upstream,
World will compare it against the pinned connector contract and adopt it through the normal
upstream synchronization process when compatible. Waiting for upstream acceptance is not a gate
for this downstream delivery.

### Advance through evidence-backed checkpoints

Work proceeds through four checkpoints:

1. **Prove the connector.** Create the smallest SSH-backed Herdr connection and prove full snapshot,
   gap-free subscription, concurrent structural commands, and a launcher through the managed World
   service environment with a real SSH agent.
2. **Prove terminal compatibility.** Hold two explicit terminal-ID streams while the subscription
   and command path remain active, and verify the existing browser terminal semantics against a
   native client.
3. **Prove the thin World integration.** Add Local and one remote profile to the existing runtime
   registry and `WorldModel` through one origin, including profile lifecycle and failure isolation.
4. **Complete product acceptance.** Finish reconnect generations, transport diagnostics, uploads,
   persistence, browser security and settings, bounds, documentation, upstream comparison, and
   end-to-end acceptance.

Each proof records the exact Herdr and World revisions, protocol versions, OpenSSH environment,
observable result, and stop condition. Mocked SSH tests support implementation but cannot replace a
real connector proof.

## Risks / Trade-offs

- **World now owns SSH process lifecycle.** The connector is deliberately narrow, uses OpenSSH as
  the policy engine, avoids a shell, and keeps remote setup interactive and external.
- **The relay command is not a stable public Herdr API.** World already pins private Herdr API and
  terminal compatibility. The relay joins that reviewed compatibility surface and must pass live
  conformance for every adopted revision.
- **World and Herdr can have separate machine catalogues.** World profiles are explicit gateway
  configuration. Importing or sharing Herdr native profiles can be considered later, but implicit
  synchronization is outside this change.
- **Managed services may lose agent access.** Service generation preserves `SSH_AUTH_SOCK`; live
  acceptance must prove the actual supervisor environment and report Attention when the socket is
  absent or stale.
- **One gateway grants broad authority.** Loopback remains the default, remote exposure stays
  explicit, and admitted users are told that the gateway controls every enabled profile.
- **Connector abstraction can grow prematurely.** The first contract remains Herdr-specific and is
  judged only against Local and SSH-backed Herdr behavior.

## Migration Plan

1. Replace the obsolete public-machine-stream gate with the Herdr connector contract and preserve
   the prior investigation as rationale.
2. Implement and prove the SSH connector against one pre-provisioned remote Herdr session.
3. Add remote profile persistence and the bounded Local-plus-remote runtime registry path.
4. Complete terminal, lifecycle, upload, security, persistence, and browser acceptance.
5. Compare the proven seam with current Herdr Web, propose reusable bridge work upstream, and adopt
   an equivalent upstream implementation if and when it lands.
6. Make the single-gateway path the normal experience only after complete acceptance; keep direct
   bridge profiles available.

Rollback disables remote Herdr profiles and leaves the existing Local and direct-bridge paths
unchanged. Qualified Local records remain readable, and rollback does not mutate remote Herdr
sessions or OpenSSH configuration.

## Open Questions

- Select the bounded remote byte-delivery mechanism from the connector proof.
- Select profile retry, idle relay, and global connection limits from live stress results.
- Decide whether a later change should import Herdr native machine profiles after both catalogues
  have stable identifiers and conflict semantics.
