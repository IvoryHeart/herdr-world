# Native federation transport spike: fresh foundation evidence

This pass replaced the discarded exploratory harness with a committed, isolated transport module:
`bridge/src/native_federation.rs`. It intentionally remains disconnected from the bridge runtime
registry and browser. Task 1.2 is complete; the remaining OpenSpec task boxes stay unchecked.

## Proven in committed fixtures

### Herdr-derived command boundaries

- `MachineProfile` accepts the exact Herdr v0.9.0 `machine list --json` row shape and rejects
  unknown fields, duplicate IDs, malformed fields, invalid targets or sessions, excess rows, and
  output over 64 KiB.
- `MachineListPlan` invokes only an explicitly resolved executable with the fixed
  `machine list --json` arguments. The adapter drains stdout and stderr with independent bounds and
  maps command failure to a bounded diagnostic. Browser descriptors contain only ID, label, and
  enabled state.
- `RemoteSessionPlan` constructs Herdr's fixed `session list --json` discovery command (without a
  profile-only flag) and `exec ... remote-client-bridge` bootstrap command. The session parser
  selects the explicit profile session and its authoritative socket path. Remote executable paths,
  session names, and targets are bounded and validated before they can reach SSH.

The row shape, command spellings, and non-interactive SSH option values are Herdr v0.9.0-derived.
The pinned Herdr v0.9.0 commit (`b99002ac99b09e00b4ca692436cb15a6b0d676f1`) was checked directly:
`src/cli/machine.rs` emits the six machine fields, `src/cli.rs` wraps session JSON in a
`{"sessions": [...]}` object, `src/session.rs` defines the session socket fields and name rules,
and `src/remote/attach.rs` supplies the non-interactive options plus the `--session` and
`remote-client-bridge` command shapes.
The parser, process boundaries, socket lease, forward verifier, and failure classification are
World-owned adaptations. No vendored source was changed in this foundation pass, so the vendor
manifest and full provenance refresh required by task 1.1 remain outstanding.

### OpenSSH effective configuration

`OpenSshForwardPlan` uses one argument per value, Herdr's non-interactive options, `-T`, `-N`,
`ExitOnForwardFailure=yes`, `StreamLocalBindUnlink=yes`, and the required
`-L local_socket:remote_socket`. It deliberately does not add `ClearAllForwardings`.

Three tests invoke the installed `ssh` binary in effective-config mode by prepending `-G` to the
unchanged production forwarding argv:

- a synthetic saved-target config with an operator `LocalForward` preserves both the configured
  forward and World's required `localforward` entry;
- a synthetic saved-target config with `ClearAllForwardings yes` removes the required entry, and
  the verifier maps that result to `Incompatible` for the affected machine ID. It does not produce
  a gateway-wide failure.

The failure fixture proves the effective-config boundary only. It does not prove a live configured
forward or remote API connection.

### World-owned process and socket seams

- Each lease uses a private, owned `0700` root and unique generation directory, rejects relative
  traversal and symlinked ancestors, validates platform Unix-socket path limits, and removes only
  its exact socket path and empty directory on drop.
- `SshForwarder` runs with stdin/stdout detached, captures bounded stderr, exposes exit status and
  diagnostics, supports cancellation and reaping, and separates process polling from an injected
  socket-readiness probe. A forwarding lease rejects a pre-created regular file or Unix socket,
  while the concrete Unix readiness probe requires a live listener rather than stale filesystem
  metadata. Process and readiness failures classify as machine-scoped `Attention`; effective-forward
  incompatibility classifies as machine-scoped `Incompatible`.
- Synthetic child processes cover clean readiness, timeout, stderr truncation, early exit,
  cancellation, lease cleanup, and a hung `machine list` command. The catalogue helper drains both
  bounded output pipes concurrently, kills and reaps a timed-out child, and returns a bounded
  diagnostic. The fixture asserts the exact production forwarding argv before using the local child.
  They do not stand in for an SSH server.

## TDD and checks

The focused RED was the honest compiler failure after declaring the new module:

```text
cargo test --manifest-path bridge/Cargo.toml --bin herdr-web-bridge native_federation
error[E0583]: file not found for module `native_federation`
```

After the foundation was implemented, the same focused command passed with 29 transport tests,
including the installed `ssh -G` checks. This pass also recorded RED/GREEN regressions for the
Herdr session-list argv, plain-target password validation, `$HOME` executable shell metacharacters,
machine-scoped effective-config error classification, exact production argv delivery, and
generation cleanup after a socket-path-length rejection, plus pre-created socket rejection and
machine-command timeout/reaping. `cargo fmt --manifest-path bridge/Cargo.toml` and the focused
test command pass after formatting. The existing unrelated `web_bridge.rs` `UploadError::Forbidden`
dead-code warning remains.

## Remaining gaps

- No vendor/herdr-compat helper extension, source-hash/provenance manifest update, clean external
  Herdr checkout audit, or live saved-machine setup was performed.
- No live SSH authentication, host-key, disabled stream-forwarding, remote executable discovery,
  remote server bootstrap, remote session command execution, API socket connection,
  API/subscription health generation, or independent API-versus-SSH lifetime behavior is
  implemented or proven. The committed session parser only validates and selects captured JSON.
- The process readiness seam has a Unix socket-connect probe but no production API client probe or
  reconnecting supervisor yet. Catalogue refresh/last-valid retention and runtime-registry
  integration are also absent.
- `remote-client-bridge` stdio terminal attach, terminal IDs, `takeover=false`, conflict retries,
  direct terminal streams, World terminal translation, browser integration, storage qualification,
  uploads, security acceptance, and live end-to-end checks remain future work.

No real machine targets, credentials, paths, or user data were copied into tracked files. Fixtures
use synthetic names and the documentation-only address `192.0.2.1`.
