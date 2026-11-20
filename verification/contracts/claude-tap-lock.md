# Claude limits writer ownership (counterexample)

## Intended behavior

[Subscription limit observations](../../openspec/specs/world-usage/spec.md#requirement-subscription-limit-observations)
must retain the highest comparable reading in a reset window. Multiple Claude
sessions write one host-local observation. Allowed: either writer commits first;
a new reset starts lower; a dead writer's lock is recovered; optional readings
may be skipped on contention. Forbidden: a retired lock holder overwriting a
new owner's higher reading or releasing that owner's lock.

Derivation: unique token comparison is evidence of ownership only at the instant
of comparison. Reclaiming a stale lock must fence the subsequent file replacement,
including a writer suspended between the comparison and rename. Existing
out-of-order and nested-contention tests do not enumerate that interval.

## Exploration and actual consumer

`quint/claude-tap-lock.qnt` separates acquire/read, ownership check, stale reclaim,
replacement-owner commit and old-owner commit. Its `safety` property deliberately
remains violated by the current implementation. Two writers, one fixed reset
window, readings 20/22/23 and a single expiry suffice; numbers represent their
ordering, not provider quotas. TLC exhaustively finds the trace, with no timing
or fairness assumption. No live Claude or timer wait is required.

`quint/claude-tap-lock.ts` drives the actual `claudeStatusLineTap` with real
temporary files. At A's final rename entry (after `mine()` returned true), it
ages A's lock, runs B through production stale recovery and commits 23, then
allows A's already-authorized rename of 22. Recorded commits are 20, 23, 22.
This is a filesystem-operation schedule, not a duplicate tap implementation.
Existing tap tests retain reset comparison, user-command chaining, exclusive
creation, stale-token identity and ordinary concurrent consumers.

## Evidence boundary

This is **a known product counterexample, not accepted safety evidence**. The
repair is tracked by [#1086](https://github.com/IvoryHeart/herdr-world/issues/1086).
canonical gate checks that TLC still rejects the unchanged requirement and the
real consumer still reproduces the reported trace. Its successful completion
means the diagnostic is reproducible; it does not certify the broken protocol.
Q55 stays pending until the issue's ownership repair and consumer/model mapping
are independently reviewed. Never weaken `safety` to remove the finding. When
the fix lands, replace expected rejection with positive conformance and retain
this trace as a regression. A repair needs atomic ownership/commit coordination;
another token check merely moves the pause window.
