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

- `server/src/world/snapshot.ts` (aggregate observation, per-host epoch fence, one
  publication revision for topology, hosts, settings and commands)
- `server/src/world/commands.ts` (World commands: compare-and-set, own connection and
  generation, settle only on a read that started after the acknowledgement)
- `server/src/service/world-commands.ts` (room rename on Herdr and core; each accepted
  command and its outcome recorded in
  the ledger history, unsettled ones settled as uncertain after a restart)
- `server/src/rpc/world.ts` (`world.snapshot`, `world.command`, World verbs)
- `server/src/verbs/registry.ts`
- `server/src/verbs/rpc.ts` (verb tiers; runtime-tier writes are the ones to retire)
- `server/src/verbs/evidence.ts` (command evidence stages)
- `server/src/world/world-ledger.ts` (history entries)
- `server/src/world/world-cli.ts` (`history`, `undo`)
- `server/src/storage/catalog.ts`
- `web/src/world/runtimeStore.ts` (browser replica: adopts only newer revisions, holds
  pending values; today also the browser builder)
- `web/src/world/worldReplica.ts` (published World and pending values in the replica)
- `web/src/world/worldCommands.ts` (browser side of World commands; room rename)
- `web/src/store/uiSettings.ts` (settings read from the World publication)
- `web/src/world/worldObject.ts` (derivation that moves to the service)
- `web/src/worldHosts.ts` (grouping, first fact to move)
- `quint/world-write-path.qnt`, `quint/world-write-path.ts` (maintained write-path model
  and its replay adapter; `verification/contracts/world-write-path.md`)

**Pitfalls:**

- An acknowledgement is not an observation: World's value for a runtime fact comes
  only from a read that started after the acknowledgement.
- A fix that works in one view is not a fix; add the fact to the cross-view test.
- Terminal input and output are not World facts.
