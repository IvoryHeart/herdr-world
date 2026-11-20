# Saved connection registry ownership

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

## Concrete protocol and consumers

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
