# Connection registry serialization

## Live connection registry admission

### Intended behavior

[Managed connection catalogue](../../openspec/specs/runtime-federation/spec.md#requirement-managed-connection-catalogue)
requires CLI and Settings edits to share one service writer. A successful edit
must survive a later unrelated edit. The persisted default must name a retained
profile. Failure must preserve the preceding catalogue and must not poison the
queue; retry must read the latest committed state. These requirements precede
the implementation mapping below.

Allowed: either caller enters first; the second request arrives before or after
the first save completes; either save fails before publication; a failed caller
retries after the other completes. Forbidden: two saves derived from the same
old catalogue silently dropping a successful edit, publishing a failed save, or
a rejected task preventing later mutations. This is catalogue serialization,
separate from runtime generation and drain safety in Q01/Q02.

### Model and implementation mapping

`quint/connection-registry.qnt` starts with profiles `alpha`, `beta`, default
`alpha`. Settings adds `settings`; CLI adds `gamma`, removes `beta`, or selects
`beta` as default. Each caller submits once; either may retry once after a failed
save. `choose` selects the operations and persistence outcomes; `requestSecond`
can occur on either side of `finishFirst`. `finishFirst`/`finishSecond` are save
and publication completion while the service writer remains held. Runtime
registration/retirement within that critical section is abstracted: its own
failure/rollback consumers remain mandatory.

`quint/connection-registry.ts` replays every one of the 48 configurations against
the real `ConnectionProfileService` and `ConnectionProfileStore`, using temporary
private files and gated persistence. It checks both disk and service catalogue
after each settlement and reopens disk after retry. The adapter counts save
entry to reject overlapping writers, including transient overlap hidden by final
state. Production CLI/service tests connect those methods to the authenticated
loopback route and browser Settings; the model grants neither caller new authority.

### Properties and controls

`safety` checks successful edits against an independent serial composition and
ensures a valid default. Every schedule is replayed, rather than relying on
random sampling to hit failure or overlap. Witnesses include each CLI verb,
both admission orders, queued and late arrival, failed first/second save, and
retry on the latest catalogue. The model control captures the second snapshot
at request time; TLC must find the lost-update counterexample. The compiled
implementation control removes only the service's queue dependency and must be
rejected by the adapter's `registry.overlap` observation. Generic errors cannot
count as a kill.

### Bounds and limits

Two writers, one initial catalogue, three CLI operations, both arrival orders,
two arrival boundaries and two independent binary persistence outcomes: 48
configurations. All operations in this domain are independent except their
shared whole-file publication. Repetition is checked by a retry after both
settle. No claim covers two offline CLI processes, service startup racing an
offline CLI, independent Worlds, arbitrary OS failures after rename, or a failed
runtime-registration rollback. Profile rollback, endpoint admission, native
atomic-file tests and runtime-control/drain evidence retain those boundaries.
Such excluded schedules are assessed separately in the audit; exclusion is not
a safety proof.

The actual offline CLI consumer in `quint/connection-registry.test.ts` now
requires both successful additions to survive. The offline ownership protocol
and its independent-process/startup consumers are documented below; the live
model does not establish cross-process ownership.

### Evidence and review

The canonical `bun run verification:gate` includes TLC, exhaustive production
replay and both controls. `quint/connection-registry.test.ts` runs the same finite
consumer matrix. Q54 records ownership and mandatory integration consumers.
Candidate evidence and timing belong to the PR. Independent review is required;
the existing lifecycle model's acceptance does not approve this new contract.

## Saved connection registry ownership

Requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md#requirement-exclusive-saved-connection-registry-ownership).
This extends Q02 with candidate direct evidence; independent review remains required.

Allowed: successful unrelated edits accumulate in ownership order. An offline CLI
acquires the registry lock, rechecks service discovery, reads fresh state, validates
and saves/clears before releasing ownership and issuing success. Startup publishes
its data-folder claim, acquires the same registry lock before bootstrap/discovery,
and retains it until connection storage drains and closes. Live edits keep their
existing authenticated service admission queue; a failed live request never falls
back offline. Managed non-loopback save-and-restart stops the service first and
starts it after releasing offline ownership, even after an edit refusal.

Forbidden: two successful edits losing an unrelated change; startup discovery
replacing a successful edit; using another data folder to bypass an overridden
registry's owner; stealing an ownership lock because its holder paused; deleting
or renaming the sidecar during recovery; guessing past unsafe or invalid ownership;
acknowledging an edit that failed validation or persistence.

### Concrete protocol and consumers

The stable private `<registry>.ownership.sqlite` inode supplies an exclusive
SQLite transaction, held in the owning process. It stores no catalogue rows;
JSON publication remains atomic and its format is unchanged. Same-process edits
wait on their predecessor's completion promise rather than blocking its event
loop. Independent processes use a bounded five-second native lock wait. A service
retains ownership through its connection store's final queued write. SQLite/OS
process death releases the lock without lease expiry, PID recovery or unlinking.
A shared registry path has one owner even across different data folders. Invalid,
unsafe or contended ownership fails closed before reading a CLI snapshot.

- `server/src/cli/connections.test.ts` reproduces the original actual-CLI lost
  update (both exit 0, one addition lost before the fix); exhausts all 24 admission
  orders of two additions, unrelated removal and default change using concurrent
  real `runCli` calls and reopened storage; checks refusal releases ownership,
  live failure never falls back, and managed stop/edit/start ordering.
- `server/src/connections/registry-process.test.ts` runs independent Bun processes
  through the actual CLI and actual `createWorldService` composition without
  calling `start()` or opening a listener. Stdin barriers and stdout events cover
  the owner's snapshot, save and receipt boundaries; startup on either side of
  offline saved-state/first-save edits; startup claim, snapshot, discovery save and
  completed bootstrap; service and CLI deaths before/after persistence; a registry
  shared across data roots; invalid ownership; paused-owner contention and startup
  timeout with instance-claim cleanup. Every successful receipt is checked
  against the reopened real registry. No timing sleeps or external endpoints.
- Existing profile/first-run tests retain format, validation, clearing, default,
  atomic publication and discovery behavior. Existing live service consumers retain
  authenticated admission, Settings concurrency and instance isolation.

Direct exhaustive admission orders plus real process boundary/crash consumers are
chosen instead of another Quint model. The new ownership primitive's decisive
properties are actual OS file-lock exclusion, process-death release and startup
composition; another finite mutex abstraction would not establish those. Existing
runtime-control/drain models retain their scope and do not prove file ownership.
Run the complete consumer files and the unfiltered `bun run verification:gate`.

Excluded: power-loss durability, network filesystems lacking SQLite file-lock
semantics, arbitrary manual replacement of active ownership files, concurrent
writers using older binaries that do not participate in this protocol, filesystem
corruption recovery and a timing/liveness SLA. A five-second wait can refuse a
healthy but paused owner; it never grants ownership by expiring that owner.
