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
  publication revision for topology, hosts, settings, commands and grouping;
  `WorldPublication` in `snapshot-types.ts`)
- `server/src/world/snapshot-records.ts` (bounded record selection and coverage counts)
- `server/src/world/commands.ts` (World commands: compare-and-set, own connection and
  generation, settle only on a read that started after the acknowledgement)
- `shared/hostGrouping.ts` (runtime grouping at two levels: `hosts`, the machines
  every host list and count reads, and `groups`, Town's buildings under "Group
  runtimes", each naming its host; World's host order, endpoint anchors and the
  view Town shows; derived in every `world.snapshot` reply, never stored)
- `server/src/world/setting-commands.ts` ("Group runtimes" as a `world.command`:
  one `setting change` entry in the ledger history, written as accepted before the
  setting and replaced by stored or failed; an entry a failed write or restart leaves
  accepted is settled by the next command or start, as uncertain when the value held
  is not the one asked for)
- `server/src/service/world-commands.ts` (one publication for settings and commands,
  with `host_grouping` derived from the catalogue, setting and staleness;
  room rename on Herdr and core; each accepted
  command and its outcome recorded in
  the ledger history, unsettled ones settled as uncertain after a restart)
- `server/src/rpc/world.ts` (`world.snapshot`, `world.command`, World verbs)
- `server/src/verbs/registry.ts`
- `server/src/verbs/rpc.ts` (verb tiers; runtime-tier writes are the ones to retire)
- `server/src/verbs/evidence.ts` (command evidence stages)
- `server/src/world/world-ledger.ts` (history entries)
- `server/src/world/world-cli.ts` (`history`, `undo`),
  `server/src/world/world-cli-ls.ts` (`ls` with the published groups),
  `server/src/cli/world-ls.ts` (`ls` human output by group)
- `server/src/rpc/bridge.ts` (refuses a plain "Group runtimes" settings write; only
  the browser's one-time only-if-absent offer passes)
- `server/src/storage/catalog.ts`
- `web/src/world/runtimeStore.ts` (browser replica: adopts only newer revisions, holds
  pending values; today also the browser builder)
- `web/src/world/runtimeDecode.ts` (decodes one published connection)
- `web/src/world/worldReplica.ts` (published World and pending values in the replica)
- `web/src/world/worldCommands.ts` (browser side of World commands; room rename,
  "Group runtimes")
- `web/src/store/uiSettings.ts` (settings read from the World publication)
- `web/src/world/worldObject.ts` (derivation that moves to the service)
- `web/src/worldHosts.ts` (reads the published grouping: `hostGroupOf`,
  `hostGroupRows`, `groupByRuntime` in published order)
- `web/src/world/town/townBuildings.ts` (Town's rendering adapter over the published
  grouping and endpoint decisions)
- `web/src/world/deskOtherHostsModel.ts` (Desk's other-host summaries by group)
- `server/src/world/world-cross-view.test.ts` (cross-view test: one snapshot, every
  view and the CLI; facts so far: grouping)
- `quint/world-write-path.qnt`, `quint/world-write-path.ts` (maintained write-path model
  and its replay adapter; `verification/contracts/world-write-path.md`)

**Pitfalls:**

- An acknowledgement is not an observation: World's value for a runtime fact comes
  only from a read that started after the acknowledgement.
- A fix that works in one view is not a fix; add the fact to the cross-view test.
- The cross-view test lives under `server/src` because the web type check targets
  ES2020 and cannot load the service modules; it imports only `.ts` view modules.
- Terminal input and output are not World facts.
