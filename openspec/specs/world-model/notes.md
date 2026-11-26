# world-model notes

Contract: the active change delta
[`openspec/changes/world-one-object/specs/world-model/spec.md`](../../changes/world-one-object/specs/world-model/spec.md)
until it is archived. Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- World as one object: sources of record, derivation on the service, display-only
  views, the write path, offline hosts, history and undo.
- Sources and the facts they own: `openspec/changes/world-one-object/sources.md`.
- Known breaks by fact: `openspec/changes/world-one-object/audit.md`.

**Code:**

- `server/src/world/snapshot.ts` (aggregate observation and late-result fences)
- `server/src/rpc/world.ts` (`world.snapshot`, World verbs)
- `server/src/verbs/registry.ts`
- `server/src/verbs/rpc.ts` (verb tiers; runtime-tier writes are the ones to retire)
- `server/src/verbs/evidence.ts` (command evidence stages)
- `server/src/world/world-ledger.ts` (history entries)
- `server/src/world/world-cli.ts` (`history`, `undo`)
- `server/src/storage/catalog.ts`
- `web/src/world/runtimeStore.ts` (browser replica; today also the browser builder)
- `web/src/world/worldObject.ts` (derivation that moves to the service)
- `web/src/worldHosts.ts` (grouping, first fact to move)
- `openspec/changes/world-one-object/write-path.qnt` (design-stage write-path model; moves to `quint/` with its adapter)

**Pitfalls:**

- An acknowledgement is not an observation: World's value for a runtime fact comes
  only from a read that started after the acknowledgement.
- A fix that works in one view is not a fix; add the fact to the cross-view test.
- Terminal input and output are not World facts.
