# Failed-host presentation and recovery

World retains failed-host topology as history, with stale/non-actionable
qualification. A connected browser is not proof that any particular SSH host
is ready. Town's building and reception and Board's host label show
**Disconnected · Reconnect** for a failed runtime. If a runtime is still ready
but its snapshot is unavailable, the label says **Stale** rather than claiming
a transport disconnect. **Reconnect** uses the existing profile recovery verb
on that exact connection ID, then refreshes its catalogue and aggregate.

Building signs follow the normal roof fade: they show at roof level and hide
when zoomed into the building. Committed sign nodes register for the next renderer
frame on first mount and after camera culling; status-only renders do not detach
them. Reception recovery remains available when the roof sign is hidden.

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

Classified retryable `SshTunnelError` / `ConnectionProbeError` failures and local
socket unavailability use the existing per-profile scheduler port. Default recovery continues beyond the former six
attempts until recovery, explicit cancellation or a nonretryable failure. The
exponential jitter window is capped at 30 seconds; after reaching the cap its
scheduled delay is 15–30 seconds. The delay is separate from a connection
attempt's own timeout and cleanup. An explicit finite `maxAttempts` policy in
`ConnectionRetryOptions` remains supported; this is not a new browser setting.

Local connections, including the startup default and saved custom sockets, retry
missing/refused sockets, reset/broken connections and transport or handshake
timeouts. If Herdr starts after World, recovery needs no manual action. World does
not install or start Herdr during recovery. Permission, malformed-response,
incompatible-protocol and arbitrary errors remain failures with explicit Reconnect.
The composition root supplies the scheduler; no second recovery loop is created.

Initial SSH HOME discovery uses the same classifier before a forwarding process
exists. A structured subprocess exit 255 is classified from its captured stderr;
transient failures enter that existing scheduler, while authentication and
host-key failures remain permanent. Other exit codes, invalid HOME output and
arbitrary errors remain unclassified, even if their text resembles a timeout.

Authentication, host-key, permission, unsupported and unclassified failures do
not gain indefinite recovery. Disconnect, removal, replacement and shutdown
invalidate retry intent. A fired callback waits for failed-runtime cleanup and
rechecks its existing token and manager generation before starting; retired attempts cannot revive a
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

The HOME preflight regression runs the real tunnel, subprocess and profile
recovery code with synthetic local child output, controlled timers and simulated
forwarding/socket readiness. It covers eight failed preflights before success,
permanent/unknown failures, queued and in-flight cancellation, and healthy sibling
leases. It never invokes SSH or establishes a remote host's version or availability.

Local consumer tests cover eight initial failures, capped backoff, cancellation
before and during cleanup, explicit Reconnect and independent sibling leases.
The production-composition test uses private synthetic control/render sockets,
real protocol handshakes, authenticated browser RPC and World snapshots. It proves
automatic late-local readiness, failed admission before recovery, fresh topology
after recovery and refusal of the retired generation. These are current Linux/CI
transport controls, not evidence about a historical macOS login incident.
