## Context

See [proposal.md](proposal.md) for motivation and the delta specifications for required behavior.
The maintained federation contract currently assigns one Herdr runtime to each World bridge and
aggregates those bridges in the browser. Browser security consequently requires reciprocal
destination CSP and target Origin admission, while the browser persists a second set of connection
profiles.

Herdr v0.9.0, World's current reviewed runtime baseline, added a client-owned multi-machine model:

- `herdr machine` stores opaque profile ID, label, SSH target, explicit remote session, and enabled
  state; `machine list --json` is the supported automation surface.
- Saved-machine connections use OpenSSH and the hidden `remote-client-bridge` command. That command
  starts the selected Herdr server when needed and pipes stdio to its native client socket.
- `herdr session list --json` reports each session's running state and authoritative API socket
  path, so World does not need to derive remote home or XDG paths.
- The full session JSON API supplies authoritative workspaces, tabs, panes, terminal IDs, pane
  revisions, layouts, events, commands, and launchers. The existing World bridge already speaks
  this API and terminal protocol.
- The client-shell endpoint is narrower. It carries one selected tab per client, while pane focus
  and zoom remain shared tab state. Its snapshot lacks World-required terminal IDs, pane revisions,
  and complete layout data. Its metadata connection cannot dispatch commands, and its command set
  omits operations World already exposes, including layout apply/export, pane move, and agent
  launch.
- Every Herdr server remains host- and session-local. Its ordinary JSON API socket does not expose
  the client's saved-machine aggregate.
- Plugins execute on one server with one injected local API socket. A local plugin is not copied to
  saved machines, and plugin startup hooks are one-shot rather than daemon supervisors.

OpenSSH supports forwarding a local Unix-domain socket to a remote Unix-domain socket with
`-L local_socket:remote_socket`. Combining that primitive with Herdr's supported session discovery
and bootstrap gives World a full remote Herdr API without adding a network listener or installing
World remotely.

The transport spike exposed one important boundary condition. `ClearAllForwardings=yes` clears
forwardings supplied on the command line as well as those read from configuration, so combining it
with World's required `-L` silently removes the API forward. Herdr v0.9.0 does not set that option.
The native forwarder therefore preserves the operator's effective OpenSSH configuration, applies
Herdr's pinned non-interactive options, and adds the private API forward without
`ClearAllForwardings`. This keeps aliases, proxying, authentication, and any explicitly configured
forwarding behavior consistent with Herdr instead of creating a second SSH configuration model.

These points are documented in the reviewed [v0.9.0 release](https://github.com/herdrdev/herdr/releases/tag/v0.9.0),
[machine guide](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/connecting-machines.mdx),
[session implementation](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/session.rs),
[remote host implementation](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/remote/host_unix.rs),
[plugin guide](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/plugins.mdx),
and the OpenSSH [`-L` contract](https://man.openbsd.org/ssh#L).

Herdr master added one-command `--machine` API routing after v0.9.0, but it is not part of the
reviewed release and does not provide reusable event or terminal streams. The original version of
this design proposed client-shell state plus remote CLI fallbacks. Source review showed that this
could neither preserve World snapshot fidelity nor isolate two browser viewers on different panes
of one split or zoomed tab. This revision uses the full API for state and operations and direct
Herdr terminal streams for viewers.

## Goals / Non-Goals

**Goals:**

- Give the normal desktop product one World bridge and one browser origin for Local plus Herdr
  saved SSH machines.
- Reuse Herdr's machine identities, setup flow, OpenSSH semantics, remote executable discovery,
  server bootstrap, full JSON API, terminal protocol, and server authority at the pinned release.
- Preserve current World snapshot and layout fidelity, terminal identity, runtime qualification,
  failure isolation, terminal control, launchers, pins, activity, notes, and uploads across native
  machines.
- Keep copied upstream source narrow, attributable, reproducible, and replaceable by a future
  supported Herdr gateway without changing the browser-facing contract.

**Non-Goals:**

- Add a network listener or fleet state to a Herdr server.
- Copy the full Herdr TUI, configuration system, renderer, update flow, or source tree.
- Install or launch the World plugin or bridge on saved remote machines.
- Store SSH credentials, answer interactive prompts, edit SSH configuration, or modify Herdr's
  machine catalogue from a browser.
- Reconstruct authoritative API data from client-shell snapshots or treat the client-shell
  selected surface as a browser terminal attachment.
- Remove direct bridge profiles. They remain the compatibility path when SSH Unix-socket forwarding
  is disabled or for deployments outside the local Herdr machine catalogue.
- Aggregate every named Herdr session on a host. One saved profile continues to identify one
  explicit remote session.

## Decisions

### Treat Herdr as the pinned transport upstream

Extend `vendor/herdr-compat` from the same exact Herdr release commit already recorded in
`UPSTREAM.md` and `VENDOR-MANIFEST.toml`. Copy or adapt only Herdr's remote executable discovery,
non-interactive OpenSSH options, `remote-client-bridge` bootstrap, error classification, and related
protocol pieces the bridge needs. Record every upstream-derived file, helper, adaptation, and source
hash in the existing vendor manifest and refresh checks. The existing vendored API client and direct
terminal protocol remain the data-plane implementation.

The full-API Unix-socket forwarder is new World-owned integration. It uses OpenSSH's documented
`-L local_socket:remote_socket` primitive and may reuse the pinned Herdr-derived SSH option and
process-error helpers, but Herdr v0.9.0 does not supply or own this forwarding supervisor. Its
construction, lifecycle, local socket security, health checks, and tests stay in World-owned bridge
code and are identified as such in provenance records. Herdr's `SshStdioBridge` and
`remote-client-bridge` path remains the client-socket transport for bootstrap and direct terminal
attachments; it is not the API forwarder.

The forwarder uses Herdr's non-interactive SSH options as the baseline and does not add
`ClearAllForwardings`. OpenSSH configuration for the saved target remains authoritative, including
operator-configured forwarding directives. World does not generate a replacement SSH config or
partially reconstruct the resolved target because doing so would split behavior from Herdr and
break valid aliases, proxy jumps, identities, and site policy. An isolated API-only transport would
instead require a supported Herdr stdio API bridge and is outside this pinned v0.9.0 design.

The repo-owned bridge remains the product executable. It composes the vendored Herdr transport with
World's HTTP/WebSocket, authentication, notes, uploads, bounds, and browser-session behavior.

This keeps Herdr responsible for machine identity, saved-profile SSH semantics, process discovery,
server startup, and native protocols. It avoids depending on Herdr's TUI selection model or
independently designing an SSH protocol.

### Read the machine catalogue through the supported CLI

The bridge invokes the configured `HERDR_BIN_PATH` (or an explicit standalone equivalent) with
`machine list --json`. It validates and bounds the output and retains only opaque ID, label, target,
session, and enabled state internally. Browser runtime descriptors omit target and session.

The bridge refreshes after startup and on bounded catalogue-change polling. Add, setup, rename,
enable, disable, and remove remain Herdr CLI/TUI operations. A change retires only the affected
connection. A malformed catalogue refresh leaves the last valid set intact and reports a
diagnostic; an initial failure leaves direct profiles usable.

Reading Herdr's private catalogue file would couple World to storage paths, locking, migration, and
partial-write behavior. The documented JSON command is the smaller contract.

### Forward the full remote JSON API over OpenSSH

For each enabled saved machine, the bridge uses the pinned Herdr transport sequence:

1. Discover the compatible remote Herdr executable with Herdr's existing logic.
2. Run a fixed remote `session list --json` invocation and select the profile's explicit session to
   obtain its authoritative API socket path and running state.
3. When the server is absent, perform a transient `remote-client-bridge` handshake and detach after
   the command has started that server, then repeat session discovery.
4. Start the World-owned forwarding supervisor, which runs one OpenSSH process that preserves the
   saved target's effective OpenSSH configuration and adds a private bridge-owned local Unix socket
   forward to the remote API socket. Require forward setup success, non-interactive operation,
   server-alive checks, private local-directory ownership, and cleanup. The complete invocation must
   be checked through the installed OpenSSH client's effective configuration so an option cannot
   erase the required forward.
5. Connect the existing World `ApiClient` to the forwarded local socket.

The provider applies the current bridge conversion to the remote `SessionSnapshot`: remote
workspaces, tabs, panes, terminal IDs, pane revisions, layouts, agent state, and optional worktree
data become the corresponding machine-qualified World snapshot fields. No authoritative field is
inferred from client-shell state. The bridge subscribes to structural events and obtains the
initial snapshot over the same forwarded API generation before declaring the runtime online. A
reconnect retires that subscription and snapshot together, creates a new generation, and cannot
mix events or responses from the previous tunnel. API and subscription health own the generation:
loss of either retires it even when the underlying SSH forwarding process remains alive.

The forwarded API is also the sole native lane for all allow-listed structural commands and
launcher operations. World retains its parameter validation and command allow-list. A missing
required API method makes that operation or runtime incompatible; there is no remote CLI command
fallback.

OpenSSH servers can disable Unix-socket forwarding. Native World federation therefore requires
that feature. If forwarding is prohibited, World keeps the machine independently visible with
bounded incompatibility guidance and offers the existing direct World bridge path. It does not
weaken SSH policy or install a relay.

### Use one explicit transport for every operation

| Responsibility | Authoritative transport |
| --- | --- |
| Machine discovery and identity | Local `herdr machine list --json` |
| Remote session and API socket discovery | Fixed remote `herdr session list --json` over OpenSSH |
| Remote server bootstrap | Herdr `remote-client-bridge` handshake |
| Snapshots, events, layouts, IDs, and revisions | Full Herdr JSON API through World's OpenSSH socket forward |
| Structural commands and launcher operations | Full Herdr JSON API through World's OpenSSH socket forward |
| Terminal output, input, resize, focus, and scroll | Dedicated direct terminal stream through `remote-client-bridge` |
| Notes, pins, and observed activity | Runtime-qualified World state in the serving bridge |
| Generic named-file upload | Fixed bounded SSH staging to the selected machine |

This table is the compatibility contract for the pinned baseline. Capability rejection remains
valid when a runtime truly lacks an optional feature, but it cannot substitute for a transport for
an operation the existing World product promises.

### Add a bridge-owned logical runtime registry

The serving bridge exposes a bounded registry containing its selected local runtime and admitted
saved machines. Each entry has a stable runtime key, Herdr machine ID where applicable, label,
state, generation, capabilities, and sanitized diagnostic. The browser receives no SSH target or
command-construction fields.

Machine-qualified snapshot, event, command, terminal, note, pin, activity, and upload routes use
the opaque runtime key. Existing unqualified routes remain aliases for the bridge's local runtime
during migration. One directly configured gateway may advertise multiple logical runtimes. The
browser qualifies each one by gateway profile identity plus advertised runtime ID, so equal native
IDs from different gateways cannot collide.

The browser retains presentation-only preferences such as colors or collapsed state. It does not
persist a second native connectivity catalogue. A single aggregate snapshot was rejected because
it would obscure per-machine generations, capabilities, and failure handling.

### Give each active terminal ID a direct attachment

The bridge maintains a dedicated, bounded direct Herdr terminal connection for each active
qualified `terminal_id` obtained from that runtime's full API snapshot. Browser viewers of the same
terminal share that connection through World's existing terminal-session manager; different
terminal IDs never share one. The bridge invokes Herdr's `remote-client-bridge` for the saved
profile and carries the existing direct terminal attach protocol over its stdio. Browser viewers
therefore do not participate in a Herdr client's selected tab, focused pane, or zoom state.

This must remain correct when two viewers select different panes of the same split or zoomed tab
and while an existing native Herdr client changes focus or zoom in that tab. Connections open on
demand, become controllable only after the runtime generation and terminal ID are current, reattach
after a fresh generation, and close after viewer detach or an idle bound. Hard viewer and machine
limits, backpressure, and resize arbitration preserve the current World terminal contract. SSH
connection sharing is an optional implementation optimization and cannot change viewer isolation.

Every automatic attachment uses the existing `takeover=false` behavior. A terminal already owned
through another native or direct World gateway remains with that owner; the new path performs only
the existing bounded conflict retries and then reports "Attached elsewhere". World does not
deduplicate gateways, share terminal ownership across gateway processes, or add an ownership
service.

The local runtime keeps the same API and direct terminal implementation. Both local and
saved-machine providers implement one bridge-internal runtime interface so the browser does not
depend on their transport difference.

### Start the gateway independently of Local availability

The managed bridge binds its HTTP service and starts the logical runtime registry before probing
the selected local Herdr socket. Local becomes one asynchronously supervised entry. A missing or
restarting local server therefore reports Local unavailable while healthy saved machines remain
discoverable and usable.

The plugin still needs a local Herdr invocation for initial installation and start. Once an OS
service or existing plugin-managed bridge restarts, it derives stable configuration identity from
the selected path and can serve without a live local daemon. Recovery of Local uses the same
generation rules as any other runtime.

### Keep remote uploads explicit and machine-local

The Herdr blob lane may carry bounded clipboard images when its observable behavior matches the
request. Generic uploads use a fixed, audited OpenSSH command that streams bytes to a private World
upload directory on the selected machine and returns only the final remote path. The browser
controls the bounded body, sanitized basename, overwrite choice, admitted runtime ID, and current
pane; it never supplies remote script text or an arbitrary destination.

The adapter applies a per-transport advertised size limit, discards results from retired
generations, and inserts a path only after remote staging succeeds. Local temporary files are
removed after transfer. Remote filesystem errors remain scoped to the upload and machine.

### Qualify all World-owned data by runtime

Native-machine notes and pins remain World-owned data in the serving bridge. Persisted attachments
add the stable runtime ID alongside the native entity ID. Existing unqualified records migrate to
the local runtime identity. Direct compatibility bridges retain their separate stores.

Observed activity caches, pruning passes, and event-derived state also partition by runtime and
generation. A snapshot for one runtime can remove only stale entries in that partition. Equal pane,
terminal, or agent IDs on two machines cannot overwrite, prune, or attach to each other.

### Separate machine federation from browser exposure

Native SSH connections originate in the serving bridge process. Browser HTTP and WebSocket traffic
therefore stays same-origin and needs no remote Host, Origin, CSP, password, or TLS configuration.
Direct bridge profiles retain the current cross-origin security model.

One configured desktop or Android gateway profile discovers every qualified logical runtime that
gateway advertises, including its saved Herdr machines. The Android client does not run a Herdr
machine catalogue; it consumes the gateway registry. A legacy bridge that advertises only Local
continues to appear as one runtime.

Exposing the serving bridge beyond loopback grants an admitted browser terminal-equivalent access
to every enabled native runtime. The remote-access settings must state that scope. Password
authentication remains one browser boundary and does not replace TLS, SSH, or VPN protection for
an untrusted network. The browser can target only opaque runtime IDs admitted from Herdr's
catalogue, so the gateway cannot become a general SSH proxy.

### Keep the World plugin as lifecycle integration

The plugin controller continues to install, start, stop, restart, and open one local World bridge.
It passes the resolved Herdr executable and stable local session context. The bridge owns native
machine supervision because Herdr plugin startup hooks are one-shot and remote servers do not
receive local plugins.

No remote plugin action is required. Selecting a machine in Herdr's TUI does not move the World
service to that machine.

## Risks / Trade-offs

- [Private Herdr remote code changes] -> Pin the exact release, keep the copied surface minimal,
  record source hashes and adaptations, and refresh transport plus protocol in one reviewed update.
- [SSH Unix-socket forwarding is disabled] -> Mark native World access incompatible with precise
  guidance and retain the direct bridge fallback.
- [The saved target configures additional SSH forwards] -> Preserve those operator-owned OpenSSH
  semantics as Herdr does, document that they apply to native World connections, and report a
  bounded machine-specific failure if a configured or World API forward cannot be established.
  Do not synthesize a replacement SSH configuration to isolate World from the saved profile.
- [API tunnel and terminal processes fail separately] -> Let API and subscription health own
  runtime generation independently of SSH process lifetime, retire terminal attachments on failure,
  and reattach only after a same-generation snapshot.
- [One terminal stream per active terminal creates SSH processes] -> Share the stream among viewers
  of that terminal, enforce per-session and global limits, idle-reap unused streams, and measure
  before adding SSH connection multiplexing.
- [A single exposed bridge increases browser-session authority] -> Keep loopback default, retain
  bounded authentication sessions, disclose the complete machine scope, and never expose raw SSH.
- [Remote command quoting or upload paths create injection risk] -> Use fixed command templates,
  validated profiles, reviewed Herdr quoting, random private paths, byte/output bounds, and hostile
  input tests.
- [Remote socket discovery races with server restart] -> Bootstrap, rediscover, forward, subscribe,
  and snapshot as one supervised generation; discard every older result.
- [Saved machine requires an interactive prompt] -> Surface bounded Attention guidance keyed by
  profile ID and label, direct the operator to Herdr's foreground setup flow, and never answer
  prompts or retry them interactively in a background bridge.
- [Machine removal races with browser actions] -> Retire the generation before closing transport
  and reject all later actions and results for that runtime.
- [Direct and native entries refer to the same server] -> Keep their distinct explicit runtime
  identities, retain non-takeover attachment and bounded "Attached elsewhere" behavior, and do not
  deduplicate from hostnames, paths, labels, or topology.

## Migration Plan

1. Add the pinned Herdr-derived remote discovery and bootstrap helpers plus the World-owned API
   forwarding supervisor and bridge-internal runtime provider behind disabled native discovery;
   verify against a clean v0.9.0 checkout, synthetic process fixtures, and the installed OpenSSH
   client's effective configuration, including proof that the required `-L` survives the complete
   option set.
2. Start the bridge independently of Local, then add the logical runtime registry and
   machine-qualified routes while preserving local aliases and direct-profile behavior.
3. Add catalogue discovery, full remote API supervision, direct terminal attachments, qualified
   World data, and uploads with focused failure and security tests.
4. Make native Herdr machines the normal desktop connection surface and let one direct desktop or
   Android gateway profile expand into its advertised runtime registry.
5. Update federation, development, security, vendoring, and plugin guidance and complete live
   local-plus-SSH acceptance checks before enabling by default.

Rollback disables native discovery and restores the current browser-direct federation path. The
new qualified World records remain readable for the local runtime, and no Herdr machine profile or
remote session is mutated by rollback.

## Open Questions

- Select the bounded catalogue refresh interval after measuring CLI startup cost; this does not
  alter catalogue authority or behavior.
- Select terminal viewer idle and global connection limits from browser and SSH stress results.
- Finalize labels for the native machine, direct endpoint, and remote browser access settings after
  usability review.
