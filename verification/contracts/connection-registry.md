# Live connection registry admission

## Intended behavior

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

## Model and implementation mapping

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

## Properties and controls

`safety` checks successful edits against an independent serial composition and
ensures a valid default. Every schedule is replayed, rather than relying on
random sampling to hit failure or overlap. Witnesses include each CLI verb,
both admission orders, queued and late arrival, failed first/second save, and
retry on the latest catalogue. The model control captures the second snapshot
at request time; TLC must find the lost-update counterexample. The compiled
implementation control removes only the service's queue dependency and must be
rejected by the adapter's `registry.overlap` observation. Generic errors cannot
count as a kill.

## Bounds and limits

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

The actual offline CLI consumer reproduces a lost update in
`quint/connection-registry.test.ts`; [#1084](https://github.com/IvoryHeart/herdr-world/issues/1084)
tracks the missing cross-process ownership protocol. Live serialization does
not close that issue. The characterization asserts the observed defect and
must become a positive preservation regression when its repair lands.

## Evidence and review

The canonical `bun run verification:gate` includes TLC, exhaustive production
replay and both controls. `quint/connection-registry.test.ts` runs the same finite
consumer matrix. Q54 records ownership and mandatory integration consumers.
Candidate evidence and timing belong to the PR. Independent review is required;
the existing lifecycle model's acceptance does not approve this new contract.
