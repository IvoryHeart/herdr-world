## Context

See [proposal.md](proposal.md) for motivation and the delta specifications for required behavior.
The maintained federation contract currently assigns one Herdr runtime to each World bridge and
aggregates those bridges in the browser. Browser security consequently requires reciprocal
destination CSP and target Origin admission, while the browser persists a second set of connection
profiles.

Herdr v0.9.0, World’s current reviewed runtime baseline, added a client-owned multi-machine model:

- `herdr machine` stores opaque profile ID, label, SSH target, explicit remote session, and enabled
  state; `machine list --json` is the supported automation surface.
- The local TUI supervises Local and saved SSH endpoints independently. Only the selected endpoint
  streams a pane surface, while every connected endpoint continues to publish topology, agents, and
  notifications.
- Saved-machine connections use OpenSSH command stdio, a private local socket, the stable endpoint
  generation-1 handshake, and the client-shell protocol. Credentials and host trust remain with
  OpenSSH.
- Every Herdr server remains host- and session-local. Its ordinary JSON API socket does not expose
  the client’s saved-machine aggregate.
- Plugins execute on one server with one injected local API socket. A local plugin is not copied to
  saved machines, and plugin startup hooks are one-shot rather than daemon supervisors.

These points are documented in the reviewed [v0.9.0 release](https://github.com/herdrdev/herdr/releases/tag/v0.9.0),
[machine guide](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/connecting-machines.mdx),
[endpoint contract](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/protocol/endpoint.rs),
and [plugin guide](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/plugins.mdx).
The connection implementation exists in Herdr's private
[`remote/saved.rs`](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/remote/saved.rs)
and
[`endpoint/supervisor.rs`](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/client/endpoint/supervisor.rs).

Herdr master added one-command `--machine` API routing after v0.9.0, but it is not part of the
reviewed release and does not provide reusable event or terminal streams. This design therefore
uses v0.9.0 behavior and does not depend on that unreleased command.

## Goals / Non-Goals

**Goals:**

- Give the normal desktop product one World bridge and one browser origin for Local plus Herdr
  saved SSH machines.
- Reuse Herdr's machine identities, setup flow, OpenSSH semantics, endpoint negotiation, server
  authority, and client-shell protocol at the pinned release commit.
- Preserve current World runtime qualification, failure isolation, terminal control, launcher,
  notes, and upload behavior across native machines.
- Keep copied upstream source narrow, attributable, reproducible, and replaceable by a future
  supported Herdr gateway without changing the browser-facing contract.

**Non-Goals:**

- Add a network listener or fleet state to a Herdr server.
- Copy the full Herdr TUI, configuration system, renderer, update flow, or source tree.
- Install or launch the World plugin or bridge on saved remote machines.
- Store SSH credentials, answer interactive prompts, edit SSH configuration, or modify Herdr's
  machine catalogue from a browser.
- Remove direct bridge profiles in the first delivery; they remain for Android, separately hosted
  pages, and deployments outside the local Herdr machine catalogue.
- Aggregate every named Herdr session on a host. One saved profile continues to identify one
  explicit remote session.

## Decisions

### Treat Herdr as the pinned transport upstream

Extend `vendor/herdr-compat` from the same exact Herdr release commit already recorded in
`UPSTREAM.md` and `VENDOR-MANIFEST.toml`. Copy only the endpoint protocol, handshake, SSH stdio
bridge, remote executable discovery, error classification, and connection-supervision logic that
the bridge actually needs. Record every copied or adapted file and source hash in the existing
vendor manifest and refresh checks.

The repo-owned bridge remains the product executable. It composes the vendored transport with
World's HTTP/WebSocket, authentication, notes, uploads, bounds, and browser-session behavior.

This is preferable to independently designing an SSH protocol because World already accepts exact
Herdr API and wire coupling. It is preferable to importing the full Herdr client because the TUI
shell, rendering, keybindings, update UI, and client settings are outside World’s responsibility.

### Read the machine catalogue through the supported CLI

The bridge invokes the configured `HERDR_BIN_PATH` (or an explicit standalone equivalent) with
`machine list --json`. It validates and bounds the output and retains only opaque ID, label, target,
session, and enabled state internally. Browser runtime descriptors omit target and session.

The bridge refreshes after startup and on bounded catalogue-change polling. Add, setup, rename,
enable, disable, and remove remain Herdr CLI/TUI operations. A change retires only the affected
connection. A malformed catalogue refresh leaves the last valid set intact and reports a
diagnostic; initial failure leaves Local and direct profiles usable.

Reading Herdr's private catalogue file would save a subprocess but would couple World to storage
paths, locking, migration, and partial-write behavior. The documented JSON command is the smaller
and safer contract.

### Add a bridge-owned logical runtime registry

The serving bridge exposes a bounded registry containing its local runtime and admitted saved
machines. Each entry has a stable runtime key, Herdr machine ID where applicable, label, state,
generation, capabilities, and sanitized diagnostic. The browser receives no SSH target or command
construction fields.

Machine-qualified snapshot, event, command, terminal, note, and upload routes use the opaque
runtime key. Existing unqualified routes remain aliases for the bridge's local runtime during
migration. Direct bridge profiles continue to use their own origins and current API.

The browser retains its logical multi-runtime and qualified World model, but native entries are
discovered from the serving bridge rather than browser storage. Browser preferences may keep
presentation-only values such as colors or collapsed state keyed by runtime ID; they do not become
a second connectivity catalogue.

An alternative single aggregate snapshot would reduce browser connections but would replace more
of the existing runtime abstraction and complicate per-machine capability and failure handling.

### Split metadata supervision from interactive surface ownership

The bridge maintains one long-lived supervisor connection per enabled saved machine for client-shell
snapshots, patches, agent state, notifications, health, and command capability negotiation. It
increments that runtime's generation after each successful replacement connection and fences every
message and response with the connection identity that produced it.

Each active browser terminal viewer receives a dedicated, bounded Herdr client endpoint connection
for its selected remote pane. That connection owns surface interest, geometry, terminal input,
scroll, and focus for the viewer. Herdr v0.9.0 already supports multiple clients selecting different
tabs independently. Connections are opened on demand, reattached after a fresh generation, and
closed after viewer detach or an idle bound.

Using one selected surface connection per machine would let browser tabs steal each other's target.
Sharing connections by pane could be added later, but it would need resize arbitration and consumer
backpressure; the per-viewer mapping is the simpler correctness boundary. Hard viewer and machine
limits prevent an admitted browser from creating unbounded SSH processes.

The local runtime keeps the current API and terminal-attach implementation initially. Both local
and saved-machine providers implement one bridge-internal runtime interface so the browser does not
depend on their transport difference.

### Route operations through the narrowest Herdr-owned lane

Snapshot, patch, surface, input, resize, scroll, focus, and methods advertised by the client-shell
endpoint use the long-lived endpoint protocol. World preserves its existing command allow-list and
validates typed parameters before selecting a transport.

Some current World operations, including managed agent launch and pane moves, are not exposed by
the v0.9.0 client-shell request allow-list. For those bounded operations, the adapter invokes the
reviewed remote Herdr executable through OpenSSH against the saved profile's explicit session,
using fixed argv construction and the same strict response schema as the local API. It never
accepts a browser shell fragment or arbitrary method. Structural commands are low-frequency, so a
one-command SSH process is acceptable; the long-lived endpoint still supplies resulting state.

This preserves feature parity without copying server logic or depending on post-v0.9 unreleased
API forwarding. If a reviewed future Herdr release advertises the operation over the endpoint, the
adapter switches that method to the long-lived lane during the normal pinned-version refresh.

### Keep remote uploads explicit and machine-local

The v0.9.0 endpoint blob lane supports bounded clipboard images but does not provide World’s generic
named-file, conflict, and overwrite contract. Image paste may use the endpoint blob message when its
observable behavior matches the request. Generic uploads use a fixed, audited OpenSSH command that
streams bytes to a private World upload directory on the saved machine and returns only the final
remote path. The browser controls the bounded body, sanitized basename, overwrite choice, admitted
runtime ID, and current pane; it never supplies remote script text or an arbitrary destination.

The adapter applies a per-transport advertised size limit, discards results from retired
generations, and inserts a path only after remote staging succeeds. Local temporary files are
removed after transfer. Remote filesystem errors remain scoped to the upload and machine.

This is preferable to returning a local bridge path that the remote terminal cannot access, and it
preserves generic file uploads rather than silently narrowing the feature to images.

### Store World notes centrally with qualified attachments

Native-machine notes remain World-owned data in the serving bridge. Persisted pane attachments add
the stable runtime ID alongside the native pane ID. Existing unqualified notes migrate to the local
runtime identity. Direct compatibility bridges retain their existing separate note stores.

Central storage keeps notes available while a saved machine is offline and avoids installing World
storage on remote hosts. The bridge never infers that equal pane IDs on different machines refer to
the same entity.

### Separate machine federation from browser exposure

Native SSH connections originate in the serving bridge process. Browser HTTP and WebSocket traffic
therefore stays same-origin and needs no remote Host, Origin, CSP, password, or TLS configuration.
Direct bridge profiles retain the current cross-origin security model.

Exposing the serving bridge beyond loopback now grants an admitted browser terminal-equivalent
access to every enabled native runtime, rather than one Herdr runtime. The remote-access settings
must state that scope. Password authentication remains one browser boundary and does not replace
TLS, SSH, or VPN protection for an untrusted network.

The bridge accepts only Herdr catalogue IDs for native targets. This prevents its browser API from
becoming a general SSH proxy even when a browser session is authenticated.

### Keep the World plugin as lifecycle integration

The plugin controller continues to install, start, stop, restart, and open one local World bridge.
It passes the resolved Herdr executable and local session/socket context. The bridge owns native
machine supervision because Herdr plugin startup hooks are one-shot and remote servers do not
receive local plugins.

No remote plugin action is required. Selecting a machine in Herdr's TUI does not move the World
service to that machine.

## Risks / Trade-offs

- [Private Herdr client code changes] → Pin the exact release, keep the copied surface minimal,
  record source hashes and adaptations, and refresh transport plus protocol in one reviewed update.
- [Endpoint and remote CLI lanes could disagree during reconnect] → Fence both with runtime
  generation and require the resulting endpoint snapshot before reporting a mutation complete.
- [One endpoint per active viewer can create many SSH processes] → Enforce per-session and global
  limits, idle reap detached viewers, and measure before considering safe surface sharing.
- [A single exposed bridge increases browser-session authority] → Keep loopback default, retain
  bounded authentication sessions, disclose the complete machine scope, and never expose raw SSH.
- [Remote command quoting or upload paths create injection risk] → Use fixed command templates,
  validated machine profiles, strict shell quoting copied from the reviewed Herdr transport, random
  private temporary paths, byte and output bounds, and hostile-input security tests.
- [Herdr's endpoint snapshot differs from the JSON session snapshot] → Normalize both into one
  bridge-owned runtime model and reject missing required fields or capabilities rather than
  inventing data.
- [Saved machine requires an interactive prompt] → Surface bounded Attention guidance keyed by the
  profile ID and label, direct the operator to Herdr's foreground setup flow, and never answer
  prompts or retry them interactively in a background bridge.
- [Machine removal races with browser actions] → Retire the generation before closing transport and
  reject all later actions and results for that runtime.
- [Direct and native entries could refer to the same server] → Keep their explicitly different
  runtime identities and do not deduplicate from hostnames, paths, labels, or topology.

## Migration Plan

1. Add the vendored endpoint transport and bridge-internal runtime provider behind disabled native
   discovery; verify it against a clean pinned Herdr v0.9.0 checkout and synthetic SSH fixtures.
2. Add the logical runtime registry and machine-qualified routes while preserving local aliases and
   direct-profile behavior.
3. Add catalogue discovery, native metadata supervision, terminal viewer connections, commands,
   notes, and uploads with focused failure and security tests.
4. Make native Herdr machines the normal desktop connection surface. Move direct URL profiles and
   reciprocal policy controls under an explicit compatibility/advanced section.
5. Update federation, development, security, vendoring, and plugin guidance and complete live
   local-plus-SSH acceptance checks before enabling by default.

Rollback disables native discovery and restores the current browser-direct federation path. The
new qualified note records remain readable for the local runtime, and no Herdr machine profile or
remote session is mutated by rollback.

## Open Questions

- Select the bounded catalogue refresh interval after measuring CLI startup cost; this does not
  alter catalogue authority or behavior.
- Select terminal viewer idle and global connection limits from browser and SSH stress results.
- Finalize labels for the native machine, direct endpoint, and remote browser access settings after
  usability review.
