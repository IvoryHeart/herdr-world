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

## Limits and remaining evidence

This is the service/wire phase. Browser base application is not implemented here;
the browser still requests complete replies. M1 `observation-base`, including
browser replay through the real Bridge lease gate, required witnesses and negative
controls, lands with browser admission in the following phase. Q14's accepted
`browser-refresh` and `browser-preparation` models remain mandatory and unchanged.
Q12/Q13 chunk credit and assembly mappings remain unchanged. No new model safety
or browser work-count claim is made by this service-only candidate.
