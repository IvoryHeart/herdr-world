# Herdr remote connection investigation

Status: **bounded World connector and managed-service live proof passed; product integration
pending**.

This record captures the investigation that changed PR #92's architecture and the first bounded
connector proof. It does not establish settings/import, runtime-registry, browser, upload, recovery,
or final product acceptance.

## Pinned release surface

The installed Herdr `0.9.0` baseline and compatibility source revision
`b99002ac99b09e00b4ca692436cb15a6b0d676f1` report API protocol `22` and schema `1`. The socket API
contains the snapshot, event, layout, pane, and agent operations used by the existing local World
bridge. Those operations address the Herdr server reached by the connected socket; they do not take
a machine/profile selector.

This is expected for a client/server socket protocol. A client selects the target by choosing which
local or relayed socket it connects to.

## Executed current-master saved-machine proof

An independent live run used Herdr master commit
`18061191fdc019498610aee81f0df93f6c2ebd31` (2026-09-16), built as a `0.9.0` binary with API
protocol `22` and schema `1`. It used an isolated Ubuntu 24.04 SSH fixture and an ephemeral key held
only by a real `ssh-agent`; no tracked file contains fixture addresses, usernames, paths, or key
material.

Against the disposable saved machine, the run:

1. authenticated successfully through `SSH_AUTH_SOCK` and failed with SSH exit `255` when that
   socket was removed;
2. added the saved machine;
3. created a remote workspace;
4. requested a real protocol-22 snapshot through `herdr --machine <id> api snapshot`.

The snapshot contained two workspaces and two panes. This proves that an ordinary Herdr API client
can reach a remote Herdr server through Herdr's SSH-backed relay model and that agent inheritance is
material to the managed World service.

## Source findings

The same Herdr revision was inspected without modifying or contributing to that repository.

- `src/cli/target.rs` resolves an enabled saved profile and lazily creates a `SavedSshApiBridge`.
- `src/remote/saved.rs` starts Herdr's private remote relay and exposes a local socket path to
  Herdr's ordinary `ApiClient`.
- `src/remote.rs` gives that relay a separate `remote-api-bridge --check` capability marker
  (`herdr-api-bridge-v1`). The inspected master has this command; World's pinned `v0.9.0`
  compatibility source does not. API protocol `22` therefore cannot stand in for relay capability.
- `src/cli/api.rs` publicly exposes one-shot `api snapshot` and schema operations; it does not expose
  a long-lived `api connect` command.
- Herdr's socket API documentation requires a separate acknowledged `events.subscribe` connection
  before taking a snapshot so a client can buffer events and close the snapshot/subscription gap.

`herdr --machine <id> api connect` was rejected with exit `2`. The earlier PR #92 design treated
that missing public stream as a hard blocker and required Herdr to own the complete external
multihost interface.

The revised interpretation is narrower: the server protocol is already usable and the World bridge
is already a compatible Herdr client. World can provide a small connector that creates local
sockets backed by independently supervised SSH relay connections. The missing public stream is an
upstream reuse opportunity, not a server-side prerequisite. The relay command and behavior become
part of World's pinned, reviewed Herdr compatibility surface until Herdr Web provides an equivalent
connector.

A later review inspected Herdr commit `0d14759cb6381b2cfc3fb33ff02761668c8c6405` and found an
important asymmetry: the API relay command always supplies `--session`, while the native terminal
relay builder omits it for the literal `default`. World commit
`667b45649d60d35febe1a7464ea2664ec25a450b` therefore resolves a target/session assignment once per
generation and explicitly supplies the resolved session to every API and terminal relay, including
`default`. It also refuses to use invocation-derived status alone as proof of a default assignment
when an explicit-session status probe resolves to another API socket.

## Executed World connector proof

World connector commit `667b45649d60d35febe1a7464ea2664ec25a450b` added the isolated
Herdr adapter/connection seam and a bounded SSH socket relay. Each accepted local stream gets an
independent noninteractive OpenSSH child, so a subscription cannot serialize later requests or
terminal attachments. The connector validates target/session input, discovers a fixed remote Herdr
executable from bounded candidates, checks `herdr-api-bridge-v1`, pins one immutable assignment,
limits concurrent relays, bounds captured output, reports redacted failure categories, cancels
children, and removes only sockets it created.

The isolated Ubuntu fixture continued to run Herdr
`18061191fdc019498610aee81f0df93f6c2ebd31`, reported version `0.9.0` and protocol `22`, and used the
same ephemeral key held only by its live `ssh-agent`. A fixture-gated Rust test was launched as a
transient systemd user service with the same explicit `SSH_AUTH_SOCK` environment shape emitted by
the World plugin. In one admitted connector generation it:

1. resolved the pre-provisioned named session and passed the separate relay-capability probe;
2. acknowledged and retained a structural subscription;
3. requested a complete session snapshot through a second API relay;
4. created a workspace and observed its event while the subscription remained open;
5. completed the tab-create primitive used by the built-in shell launcher and observed its event;
6. opened two independent terminal relay streams for two explicit terminal IDs, completed both
   protocol handshakes, and routed distinct input/output without crossover;
7. cleaned up the created workspace and terminated the transient service successfully.

Focused synthetic tests separately changed the inherited remote `HERDR_SESSION` after admission
and proved that subscription, request, and terminal streams remained on the explicitly pinned
`default` session. Other focused tests cover mismatched default socket evidence, hostile target and
session values, concurrent relay progress, bounded/redacted authentication failure, active-child
cancellation, and the shared Local/SSH adapter entry points.

The managed-service live command passed in 2.95 seconds. The regular connector suite passed eight
tests with the external live test ignored by default. Strict OpenSpec validation passed.

## Remaining proof

The connector remains intentionally unregistered in the serving bridge until the next checkpoint.
The live test used the real systemd user manager and the plugin's generated environment shape, but
did not replace or mutate the operator's installed World service. The task checkboxes remain open
until their complete evidence sets are present, including actual-loopback connection administration,
runtime-binding rotation, broader failure cases, and full terminal semantics.

The next implementation step is the bounded World integration: persist and import connections,
admit Local plus this SSH connection into the runtime registry, route both through the unified
`WorldModel`, and prove same-origin browser behavior. Reconnect generation fencing, complete
terminal focus/resize/scroll/graphics/bell behavior, uploads, stress limits, supported-platform
recovery, and final security/product acceptance also remain required.

## Managed service prerequisite

The World plugin service environment carries `SSH_AUTH_SOCK` alongside the existing Herdr and
plugin state variables. Focused tests cover the variable in generated systemd-user and launchd
definitions. The bridge's Settings controller handoff also preserves it through systemd-user,
launchd, and cleared-environment fallback restarts. The connector proof additionally executed under
the real systemd user manager with the live fixture agent socket. Platform-specific launchd and an
installed generated World unit remain part of final managed-service acceptance.
