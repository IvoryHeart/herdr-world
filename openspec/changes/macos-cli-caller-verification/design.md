## Context

See proposal.md. CallerLocator is a synchronous port used by the shared TUI/core
identity resolver. Linux already scopes descriptor search to pane descendants.
The HTTP boundary knows the platform; ask refusal must remain a World response.

## Decisions

- Retain Linux lookup and all shared ancestry, connection, generation and core
  occupant checks. Inject a normalized process-lookup port at the endpoint so
  Linux, Darwin and Windows follow the same service tests on any worker.
- On macOS run fixed `/usr/sbin/lsof` and `/bin/ps` paths without a shell or
  privileges. Filter lsof to established TCP sockets on the peer port; match
  client address and port, service port, loopback destination and unique owner.
  Read only PID, parent PID and process group from one ps snapshot. Each command
  has a 1-second deadline and 256 KiB output cap; reject snapshots over 4096
  processes and chains over 64 ancestors or with cycles. Cache only the macOS
  chain within one HTTP request. Native libproc would require a new native
  integration; these bundled utilities keep the change dependency-free.
- Append platform unavailability to refused ask replies at the endpoint, which
  owns platform selection. Do not grant a fallback identity or special authority.
- Keep the CLI's existing codes and use JSON null for unconfirmed recording.
  Confirmed refusals retain false and exit 3 with no fallback. Operational
  recording failures keep the existing single Herdr alert and exit 1.
  No persisted fields, stores or browser fixtures are needed.

## Verification decision

The OS lookup is bounded observation with no new writer, retry or asynchronous
state machine. The platform × runtime × matching/foreign ancestry matrix and
socket/process fixtures directly cover authority decisions. Exhaust the finite
refusal/recorded/transport outcome combinations in the CLI and test actual lost
and malformed HTTP replies. A new Quint model would restate these synchronous
decisions without testing OS semantics. Add the macOS consumer and evidence to
Q30 and run the complete unfiltered verification gate for the coverage change.

## Risks / Trade-offs

- macOS tools can be absent, restricted or slow: fail closed within the stated
  bounds, retaining unverified behavior. Real macOS verification remains an
  explicit owner PR check; synthetic fixtures do not establish OS compatibility.
- OS inspection is a snapshot, as on Linux; it does not make socket ownership
  and runtime admission atomic. Existing runtime qualification remains required.
- Clients reading `recorded` must handle null for uncertainty; the installed
  agent guide and capability notes explain all three values.

## Migration

No storage migration. Update the installed guide version so integrations refresh
the revised platform and output guidance. Normal revert restores prior behavior.
