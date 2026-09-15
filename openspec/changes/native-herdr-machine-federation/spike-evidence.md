# Native federation transport spike: rejected forward plan

This spike exercised two transport seams with deterministic synthetic fixtures. Its direct-terminal
work remains useful evidence, but its full-API forwarding plan failed an installed-OpenSSH boundary
check. The implementation is not accepted, does not complete the federation change, and does not
mark any task in `tasks.md` complete.

## Forwarded full API seam

`bridge/src/native_federation.rs` attempted a World-owned `OpenSshForwardPlan`
and `SshForwarder`:

- the plan builds one argv item per value and uses `-T`, `BatchMode=yes`,
  `NumberOfPasswordPrompts=0`, `StrictHostKeyChecking=yes`, bounded connection
  attempts, `ClearAllForwardings=yes`, `ExitOnForwardFailure=yes`, and
  `StreamLocalBindUnlink=yes`;
- the forwarding command is `-N -L local_socket:remote_socket`, with no
  remote shell command or browser-controlled text;
- each generation gets a unique mode `0700` directory and an `api.sock` lease;
  root creation rejects symlinked ancestors and lease cleanup removes only the
  exact socket path and directory;
- the process can be polled for early exit and is killed and reaped on
  cancellation or drop; and
- `RuntimeGeneration` retires on API or structural-subscription failure even
  while the SSH child remains alive. A generation is actionable only when all
  three health gates are true, and its token fences stale generations.

The plan is invalid. OpenSSH documents that `ClearAllForwardings` clears forwarding directives from
both configuration and the command line. The installed client confirms this before any network
connection is attempted:

```text
$ ssh -G -o ClearAllForwardings=yes \
    -L /tmp/world.sock:/tmp/remote.sock example.com
clearallforwardings yes
# no localforward entry

$ ssh -G -L /tmp/world.sock:/tmp/remote.sock example.com
clearallforwardings no
localforward /tmp/world.sock /tmp/remote.sock
```

Argument order does not restore the forward. The accepted design therefore follows Herdr v0.9.0's
actual non-interactive options, which do not set `ClearAllForwardings`, and preserves the saved
target's effective OpenSSH configuration. The next implementation must prove the complete command
through `ssh -G`, in addition to synthetic argv tests. If the product later requires an isolated
API-only SSH connection, that requires a supported Herdr stdio API transport rather than a
World-generated replacement SSH configuration.

The machine-list parser accepts the pinned v0.9 row shape, bounds output and
profile count, rejects duplicate or invalid profiles, and exposes only `id`,
`label`, and `enabled` through its browser descriptor.

## Direct terminal stdio seam

`remote_client_bridge_plan` creates a noninteractive SSH command whose fixed
remote command is `remote-client-bridge`; the executable and named session are
shell-quoted, while the SSH target remains a separate argv item. The
`attach_direct_terminal` adapter uses the existing vendored Herdr protocol to:

1. send `TerminalHello` with protocol 22 and the requested dimensions;
2. validate a `TerminalAnsi` `Welcome`; and
3. send `AttachTerminal { terminal_id, takeover: false }`.

The retry helper retries only recognized attachment-owner conflicts twice, then
returns the existing `Attached elsewhere` result. A post-handshake
`ServerShutdown` conflict is classified through the same helper for the later
stream reader to consume. Established streams reject a second handshake, and
their reader accepts Herdr's larger graphics frame limit.

## Evidence and limits

Focused command:

```text
cargo test --manifest-path bridge/Cargo.toml --bin herdr-web-bridge native_federation
```

Result: 25 synthetic tests passed, but the forwarding seam failed the subsequent system-boundary
check above. The initial RED was the expected compiler error for
the newly declared but missing `native_federation` module. The second-pass RED
covered the graphics frame cap, symlinked forward-root ancestor, direct target
password validation, broad attachment-conflict matching, second-handshake
state mutation, unbounded executable paths, and unknown catalogue fields; each
now passes in GREEN. The final review added direct stdio coverage for a
post-handshake Herdr owner-conflict frame and invalid forward-root forms. The
suite uses Unix socket pairs, a cursor, synthetic catalogue JSON, temporary
private directories, and short local shell children. Those fixtures asserted the presence of both
`ClearAllForwardings=yes` and `-L` but never asked OpenSSH for the resulting configuration, allowing
the invalid combination to pass. It does not prove a real SSH connection, remote session discovery,
Herdr bootstrap, API subscription
over an actual forwarded socket, terminal output forwarding, or integration
with the bridge runtime registry. The forwarding process currently exposes
exit status and cancellation, but suppresses SSH stderr and has no
socket-readiness wait; those remain implementation-pass work. The
post-handshake conflict classifier and retry budget are exercised over a real
synthetic wire frame, but no reconnecting supervisor consumes them yet;
reconnect integration remains implementation-pass work.
