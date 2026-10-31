# Observation v1 service and wire evidence

## Requirements and properties

Source: runtime federation's “Service incarnation and based aggregate replies”.
A confirmation is allowed only when service incarnation, owner, runtime generation,
snapshot generation and projected-content token all match. Unknown or mismatching
bases require complete replacements. A missing base preserves complete topology.
Malformed bases must fail before runtime acquisition. Wire omission must never
hide topology from service-side appearance, profile or annotation processing.

## Implementation mapping

`WorldObservation.reply` is the real wire builder called by `handleWorldRpc`,
after complete snapshot side effects. Its token is SHA-256 over the producing
generation and the actual projected snapshot, cached by snapshot identity.
`WorldSnapshotService.projectSnapshot` reuses projections for the same acquired
raw lists, owner, generation, priorities and watch revision; variants are bounded.
The projection-key optimization does not replace hashing projected content.

`server/src/world/observation-v1.test.ts` exhausts the service rule over two
incarnations, generations 1–2, matching/unknown tokens and matching/unknown owners.
It checks metadata-only health changes, producing-generation changes, null
snapshots and invalid-base bounds. `snapshot-observation.test.ts` drives the real
snapshot service with overlapping projections, a 513-workspace source, cache
reuse, generation replacement and malformed input before acquisition.
`server/src/service/observation-v1.test.ts` uses two real composition-root services
and their WebSocket hello/RPC path, each with two synthetic generation-1 runtimes.
It checks distinct incarnations, unchanged omission, changed-host replacement,
full-reply equivalence, no-base compatibility and refusal before downstream reads.

## Browser mapping and M1

`web/src/world/observationBase.ts` builds bases only for the negotiated hello and
retained producing generation. Confirmations require their captured base and held
content; missing content discards the response before preparation and triggers one
full recovery. Refusal disables bases only for that hello. Incarnation changes
cannot share content. `runtimeStore.ts` retains the observation epoch, one request
in flight and staged per-owner Bridge revalidation. No unchanged confirmation can
revive a retired lease. Identical metadata and objects produce no publication.

`quint/observation-base.qnt` checks `replyEqualsFresh`, `noResurrection`,
`incarnationReset` and `confirmationHeld`. Its two-host domain has generations 1–2,
tokens 0–2, incarnations 0–1, observation epochs 0–2 and at most six wire pulls, including complete recovery.
Source updates linearize while a request is outstanding, before reply construction;
post-reply qualification retirement is separate. Dropping held content commutes with
reply construction and is represented after it. Request/reply temporaries are cleared
after application, while freshness and held-content checks retain their computed
results; this removes history that cannot affect a later request, without changing
the properties or domain. No temporal liveness or unbounded-schedule claim is made.

`quint/observation-base.ts` exhausts the real service rule with independently forged
incarnation/generation/token combinations, then replays controlled replies through
the real runtime store and real Bridge qualification gate. It observes host identity,
producing generation, content token, actionability and service-incarnation content
provenance at every boundary. Eviction is a controlled local held-content stimulus;
it is not claimed as a new production eviction API. Missing-base recovery is checked
as one publication. `unchangedSkip`, `oneHostReplaced`, `incarnationChanged`,
`retiredDuringRequest` and `discardedConfirmation` are required on production replay
for seeds 42, 73 and 103. BROKEN confirms by token without generation; its
counterexample must fail `base.generation` on real replay. Compiled controls remove
the service generation checks (`base.generation`) or browser incarnation reset
(`base.incarnation`). Production sources are never mutated.

## Incremental preparation and consumer boundaries

P6 uses the test clock and production work counters. One status change prepares
one room and dependent aggregates, preserving every other room presentation; a
Town-only refresh prepares no Board topology. Appearance/watch changes retain
unaffected room inputs, while unrelated profile edits retain prepared actor looks.
Seeded observation, appearance, watch and seen-mark sequences compare Town and Board
with complete preparation. Relations, Town master and source data remain separate
readers; topology preparation does not fingerprint or invalidate data it never reads.
Their existing consumer suites remain mandatory. The Board document remains mounted
for appearance and relations. Existing Spaces mounting and operational lease checks
are unchanged. Switching views finishes missing models before they are presented.

Q14 adds M1 and P6; accepted `browser-refresh` and `browser-preparation` scopes stay
mandatory and unchanged. Q12/Q13 continue to cover the unchanged chunk credit and
assembly paths. Dense browser tests retain rendering, input responsiveness, terminal
and resource consumer claims beyond the finite model. New M1/P6 mapping acceptance
requires independent review; historical reviews do not approve these additions.
