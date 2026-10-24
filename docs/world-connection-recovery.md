# Failed-host presentation and recovery

World retains failed-host topology as history, with stale/non-actionable
qualification. A connected browser is not proof that any particular SSH host
is ready. Town's building and reception and Board's host label show
**Disconnected · Reconnect** for a failed runtime. If a runtime is still ready
but its snapshot is unavailable, the label says **Stale** rather than claiming
a transport disconnect. **Reconnect** uses the existing profile recovery verb
on that exact connection ID, then refreshes its catalogue and aggregate.

Cached agents do not advertise current working/urgent activity. Town freezes
their motion and rejects live Chat/terminal opens for agent, pane and desk
targets. Board's cached panes show unknown activity and reject operations.
The underlying last-observed records remain available as historical context;
healthy siblings retain their own observations and action admission.

## Current health before a snapshot completes

World invalidation metadata carries optional `connection_state` only when the
current manager status matches the exact event's connection ID and runtime
generation. The browser accepts only known lifecycle values and safe generations,
marks that cached owner stale immediately and schedules its usual coalesced
refresh. Older lifecycle events cannot replace newer owner health. A pending
snapshot cannot overwrite a reported failed owner with an old ready observation.
A ready lifecycle signal also cannot make cached topology actionable: a matching
fresh snapshot and existing qualified lease admission are still required.

Town uses the current projection. Board may defer ordinary topology rendering,
but bypasses a deferred model if it would retain a removed or retired live target.
This changes presentation latency, not runtime authority or routing identity.
No action falls back to a healthy host when the requested owner is unavailable.

## One existing recovery scheduler

Classified retryable `SshTunnelError` / `ConnectionProbeError` failures use the
existing per-profile scheduler. Default recovery continues beyond the former six
attempts until recovery, explicit cancellation or a nonretryable failure. The
exponential jitter window is capped at 30 seconds; after reaching the cap its
scheduled delay is 15–30 seconds. The delay is separate from a connection
attempt's own timeout and cleanup. An explicit finite `maxAttempts` policy in
`ConnectionRetryOptions` remains supported; this is not a new browser setting.

Authentication, host-key, permission, unsupported and unclassified failures do
not gain indefinite recovery. Disconnect, removal, replacement and shutdown
invalidate retry intent. A fired callback waits for failed-runtime cleanup and
rechecks its existing token before starting; retired attempts cannot revive a
profile or replace a newer runtime. Siblings have independent timers and leases.

The server pings Herdr over the selected sockets. POSIX SSH forwarding only
needs the remote home and socket paths; a missing bare `herdr` in a
non-interactive PATH is not an installation failure. Separate native CLI
diagnostics should resolve the configured/standard executable. No updater,
remote shell configuration, provider framework or skill binding was added.

## Evidence and limits

Synthetic controlled-clock/process fixtures cover recovery beyond six failures,
backoff caps, finite policy, permanent/unclassified failures, cancellation,
removal and replacement/retirement. Controlled snapshot/lifecycle tests cover
immediate owner-specific stale state and refusal of late promotion. Pure model,
static-markup and injected recovery-action tests cover presentation and routing.
Existing runtime models retain authority/administration bounds; fixtures do not
prove real SSH availability, infinite progress, native account behavior or
viewport/pixel outcomes. Five-viewport Town/Board proofs, the complete normal
gate and current-head CI belong to the closing batch, not the individual item.
