# Q44: Adapter conformance (P3)

## Requirements and properties

The [current adapter contract](../../openspec/specs/world-adapters/spec.md) requires
instance-qualified native IDs; absence only from a complete listing; conservative
continuity on resets and reuse; rereads after event disorder or loss; counted unknown
data; declared verbs and limits; retirement fences; and zero disabled acquisition.
The synthetic source must never be enableable by production composition.

Allowed: a partial list retains an absent row; an unknown field is dropped; a reset
reports the previous capture ended; no witness means unconfirmed; an event dirties
an observation and the next clean read restores confirmation. Forbidden: joining
IDs by an ambiguous separator, interpreting partial absence as deletion, applying
event payloads, dispatching an unknown verb, publishing a late owner's response,
or retaining unlimited rows through repeated partial listings.

## Evidence and limits

The shared assertions in `server/src/adapters/testing/conformance.ts` exercise the
real `AdapterSession` with both adapter definitions. Fixtures translate native
Herdr lists and optional agent failure; unknown kinds and malformed pages are
explicit fault injection after translation. The deterministic synthetic source
has opaque IDs, no terminal, partial multi-page listings, resets, revisions and
payload-free invalidations. Direct tests cover paging consistency, resource
refusal, retained-state bounds and typed dispatch. A delete/recreate regression
failed for both adapters before observation-local lifetime tokens were added.

`registry.test.ts` bundles the actual release entrypoint and rejects the synthetic
registration and implementation. It also checks a frozen production registry and
data-only descriptors. `herdr.live.test.ts` supplies opt-in evidence against one
disposable named Herdr session, including verified pane witnesses and refusal of
terminal writes. `snapshot.test.ts` retains production cache, projection and
retired-lease behavior after factoring its raw reads into the Herdr adapter.

P3 explicitly selects direct external-source evidence rather than a finite model.
This boundary neither implements durable World binding policy nor proves source
truth, cross-source claim conflict resolution, legacy mutation actor policy, or
World subscription delivery. The last has a spec-required named pending test;
no v2 consumer migration is authorized by these results. Tombstones have an
entity-count horizon; older captures conservatively become unconfirmed.
Independent implementation review and CI remain required.

## Commands

```sh
bun run test server/src/adapters/ server/src/world/snapshot.test.ts
HERDR_WORLD_LIVE_ADAPTERS=1 bun run test server/src/adapters/herdr.live.test.ts
bun run test scripts/verification-coverage.test.ts
```
