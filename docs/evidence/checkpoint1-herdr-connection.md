# Checkpoint 1 Herdr connection proof

Status: **blocked**. This evidence does not mark checkpoint 1 complete.

The reproducible harness is [`scripts/checkpoint1-live.mjs`](../../scripts/checkpoint1-live.mjs).
It uses only the public Herdr CLI (`machine list`, `api schema`, and the non-mutating selector
probe) and exits `2` when the supported surface or live prerequisites are missing. It has no
stream driver to claim a live result, so it remains blocked until that supported capability and
the end-to-end driver exist. The focused contract tests are
[`scripts/checkpoint1-live.test.mjs`](../../scripts/checkpoint1-live.test.mjs).

## Pinned release runtime

Command:

```text
node scripts/checkpoint1-live.mjs
```

Result from the installed Herdr `0.9.0` binary:

| Check | Result |
| --- | --- |
| Herdr version | `0.9.0` |
| Observed Herdr revision | not reported by the installed binary |
| Compatibility source revision | `b99002ac99b09e00b4ca692436cb15a6b0d676f1` |
| API protocol / schema | `22` / `1` |
| Required snapshot, event, layout, pane, and agent methods in schema | present |
| Machine-qualified raw socket request | absent |
| Saved machine catalogue | available, `0` enabled profiles in this environment |
| Managed plugin/service environment markers | absent for this invocation; markers alone do not prove supervisor execution |
| `SSH_AUTH_SOCK` | present and is a Unix socket; its path is intentionally omitted |
| Live snapshot, subscription, concurrent control, launcher | blocked |

The public schema contains `session.snapshot` and `events.subscribe`, but neither request accepts
an admitted machine/profile/endpoint ID. `api snapshot` therefore addresses the connected socket
only. This pinned-release invocation also has no `--machine` selector. The harness did not attempt
a remote command because this invocation had no enabled saved profile; the separate live attempt
below exercised a disposable saved machine.

## Executed current-master saved-machine proof

An independent live run used Herdr master commit
`18061191fdc019498610aee81f0df93f6c2ebd31` (2026-09-16), built as a `0.9.0` binary with API
protocol `22` and schema `1`. It used an isolated Ubuntu 24.04 Docker SSH server and an ephemeral
SSH-agent key supplied only through `SSH_AUTH_SOCK`; no `IdentityAgent` override was used. SSH
authentication succeeded with the agent socket and returned exit `255` when the socket was absent.

Against the same disposable saved Herdr machine, the run completed these operations sequentially:

1. added the saved machine;
2. created a remote workspace;
3. requested `api snapshot` through `--machine <id>`.

The resulting snapshot was a real protocol-22 response containing two workspaces and two panes.
This proves the current master's one-shot saved-machine SSH path and agent inheritance. It does
not prove a reusable API stream: `--machine <id> api connect` was rejected with exit `2` and
`not an API-backed machine command`, and the raw socket schema still leaves `session.snapshot`,
`events.subscribe`, layout, pane, and agent requests bound to the connected socket.

## Current Herdr source evidence

The separate Herdr checkout at commit
`18061191fdc019498610aee81f0df93f6c2ebd31` (2026-09-16 `master`) was inspected without changing
or contributing to that repository.

- `src/cli/target.rs:27-54` adds the public `--machine <label-or-id>` prefix and resolves an
  enabled saved profile by opaque ID or unique label.
- `src/cli/target.rs:76-98` lazily starts `SavedSshApiBridge` and returns an `ApiClient` for that
  command's local socket. The target is held in a thread-local command scope (`:7-24`), so this is
  a per-command bridge lifetime.
- `src/cli/target.rs:241-269` allows `--machine` to route API-backed commands, but the `api`
  branch admits only `snapshot` (`:253`).
- `src/remote/saved.rs:38-73` declares `SavedSshApiBridge` and its methods `pub(crate)`. The
  bridge starts the private `remote-api-bridge` command and exposes only its local socket path to
  Herdr's own CLI code.
- `src/cli/api.rs:5-66` exposes only `api snapshot` and `api schema`; there is no `api connect` or
  public long-lived stream entry point.
- The upstream socket API documentation says `session.snapshot` is one-time and requires opening
  `events.subscribe` on another connection first (`docs/next/website/src/content/docs/socket-api.mdx:118-127`).
  That procedure applies to a connected local socket and provides no machine selector.

Current Herdr master consequently improves and has now been exercised for one-shot machine command
routing, but it still does not provide the reusable machine-qualified stream required by checkpoint
1. A World implementation would have to invoke Herdr's private bridge or construct SSH/bootstrap
itself, which reaches the checkpoint stop condition. The smallest upstream capability still needed
is a supported machine-qualified long-lived API stream (for example, a versioned `api connect` entry
point) that can remain open for the subscription while separate command/launcher calls progress.

## Managed service prerequisite

The World plugin service environment now carries `SSH_AUTH_SOCK` alongside the existing Herdr and
plugin state variables. The plugin regression tests cover the variable in both generated systemd
user unit and launchd plist definitions. Those definitions and environment markers do not prove
that a supervisor actually executed the service or that the child inherited a usable agent
socket. The independent run above used the agent socket successfully outside the managed World
service; a future live proof must run the bridge through that service with the same
disposable-machine discipline and a reusable stream driver. Until the reusable stream exists, all
live actions remain blocked and PR #92 stays draft.
