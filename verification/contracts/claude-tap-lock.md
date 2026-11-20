# Claude limits writer ownership

## Intended behavior

The [subscription-limit contract](../../openspec/specs/world-usage/spec.md#requirement-subscription-limit-observations)
requires comparable readings in one reset window never to decrease. Two Claude
sessions may commit in either order; later resets may start lower. Optional
readings may be skipped after bounded contention, but the user's status command
still runs. A dead owner's recovery cannot enable that owner to publish later
or remove a replacement owner's lock.

Issue #1086 retains the audit's counterexample: A prepares 22 from stored 20,
passes its ownership check, pauses, B reclaims by age and commits 23, then A
renames 22. A second ownership check cannot close this interval.

## Protocol and filesystem assumptions

The tap publishes a preinitialized, nonempty directory as the lock using a
same-directory rename. Rename cannot replace a nonempty directory. Its unique
owner marker includes the process ID. Signal 0 confirms process existence on
Bun/Node, including Windows; only `ESRCH` authorizes removal. Permission errors,
unknown liveness and PID reuse retain ownership, regardless of age. A confirmed
dead process cannot resume its final rename. This assumes host-local process
identity and filesystem semantics; a cache shared between different process
namespaces or machines is outside this contract.

Recovery and release unlink only the exact generation marker, followed by
nonrecursive `rmdir`. A delayed cleanup cannot remove a replacement nonempty
directory. An empty directory left during release is safe to remove. A legacy
token-bearing file lock can be removed for a confirmed-dead PID; `unlink`
cannot remove a replacement directory. Unknown legacy contents fail closed.
No elapsed-age lock stealing, directory moves or recursive deletion are allowed.

## Bounded model and actual adapter

`quint/claude-tap-lock.qnt` explores four suspension boundaries: before lock
publication, after acquire/read but before preparing the temporary file, after
the ownership check but before final rename, and after commit but before
release. Each has a live and an irreversibly dead process outcome. B's
acquire/read/merge/publish/release is one nested contender transaction; its next
status update retries any skipped reading. The fixed reset and readings
20/22/23 represent their relative order, not provider quotas. No fairness or
arbitrary-process-count claim is made.

TLC exhaustively checks all eight schedules. Three simulation seeds export 100
completed traces each; every seed must cover every schedule. The adapter calls
the actual `claudeStatusLineTap` with real temporary files and injects B at the
filesystem boundary, explicitly aging the lock without timer sleeps. The gate
compares each model history with the corresponding real commit history, caching
identical schedules. The old `20 → 23 → 22` schedule is now a positive regression
with `20 → 22 → 23` (B retries after its skipped reading).

A model fault permits live-owner stealing and must yield an invariant-violating
counterexample that disagrees with the production history. A production mutant
that treats an existing process as dead must reproduce `20 → 23 → 22`.
This establishes sensitivity without weakening the positive safety property.

`server/src/usage/claude-tap.test.ts` separately exercises delayed reclamation
against a replacement directory, dead/legacy/empty recovery, unknown liveness,
bounded contention with status chaining, reset maxima, numeric privacy, and the
generated standalone and compiled programs. Model exploration does not prove
OS behavior on every filesystem, PID visibility across containers, cross-host
cache safety, power-loss durability or mixed-version legacy writer safety.

Run the focused regression with `bun run test quint/claude-tap-lock.test.ts`
and the complete required evidence with `bun run verification:gate`.
Independent review of this repaired protocol and its mapping remains required.
