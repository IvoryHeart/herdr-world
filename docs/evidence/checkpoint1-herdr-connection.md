# Herdr remote connection investigation

Status: **transport model established; World connector proof pending**.

This record captures the investigation that changed PR #92's architecture. It does not prove the
new World SSH connector or complete any implementation checkpoint beyond the recorded prerequisite
work.

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

## Remaining proof

This investigation did not prove a World-owned connector. Checkpoint 1 still requires a live run
through the shipped managed service that demonstrates all of the following at once:

- a complete remote snapshot;
- an acknowledged structural subscription kept open while commands and a launcher complete;
- independent connection progress rather than a serialized relay;
- exact Herdr and World revisions and protocol versions;
- real `SSH_AUTH_SOCK` availability through the supervisor;
- bounded failure and process cleanup.

Terminal-ID streams, reconnect generations, uploads, browser integration, and product acceptance
remain later checkpoints.

## Managed service prerequisite

The World plugin service environment now carries `SSH_AUTH_SOCK` alongside the existing Herdr and
plugin state variables. Focused tests cover the variable in generated systemd-user and launchd
definitions. Those definitions do not prove that a real supervisor executed the service or that
the child inherited a live agent socket; the checkpoint fixture must prove that behavior.
