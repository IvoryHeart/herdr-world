# World publication and commands (world-write-path)

## Scope and requirement

World publishes topology, hosts and the settings it derives from under one
revision (`server/src/world/snapshot.ts`), and changes go through World
commands (`server/src/world/commands.ts`, composed in
`server/src/service/world-commands.ts`). Every browser view reads one replica
(`web/src/world/runtimeStore.ts`, `web/src/world/worldReplica.ts`). The
requirement is the `world-one-object` OpenSpec change (`world-model`). Room
rename on both runtimes is the first command on this path.

Order: a view submits a command naming the entity, the field and the value it
saw → World refuses it when the current value (or the value still in flight)
differs, else sends it on the entity's own connection and generation → the
browser holds the new value for every view → after the acknowledgement World
invalidates and starts a read; only a read that started after the
acknowledgement settles the command → the settled outcome is published under a
new revision, even when the final value equals the old one → the browser
adopts only newer revisions and drops the held value once it has adopted the
outcome's revision. World records each accepted command in the World ledger's
existing change history before sending it and updates that record in place
with whatever outcome it reaches; after a restart, a recorded command that
never settled is settled as uncertain. A reply that waited on a slow host
carries every other host's newest read together with the revision and
published values it reports.

## Model and replay

`quint/world-write-path.qnt` has one room on one host, two browser views and
two screens (Town and Board) in one browser, source changes from outside,
reads that arrive late or are lost, commands that are refused, lost (and may
still land), or acknowledged, connection loss and one World restart. Its
safety invariant, checked after every step:

- World's published value is a value the source held, and its revisions never
  go back; a view only adopts a published revision, never an older one;
- a confirmed value stays until the source changes again;
- applying a read never flashes a view back to an older value;
- a command is sent only while online and only over the current value
  (compare-and-set);
- a restart drops every pending value, so views show what World publishes,
  and a command in flight is settled as uncertain from its ledger record;
- once everything has settled, World and every view show the source value.

Nine named runs pass: a late read is discarded, a source change after the
command wins, a refusal restores, offline refuses, an observed value holds
until adopted, compare-and-set refuses a stale expected value, the outcome is
delivered when the final value is unchanged, the pending value is shared by
both screens, and recovery after a restart. Exhaustive TLC did not finish in
ten minutes, so the gate runs three seeds of 2,000 simulated runs of up to 30
steps. Two model flags (no epoch fence, no compare-and-set) must each give a
counterexample.

`quint/world-write-path.ts` replays seven scenarios through the real
`WorldSnapshotService`, `composeWorldCommands` and two `WorldRuntimeStore`
replicas over a synthetic Herdr runtime with one room, whose reads can be held
to make them late. Three production mutants must be rejected: no snapshot
admission fence, no compare-and-set and no revision when only a command
settles.

## Limits

Sampling, not exhaustive. One host, one room and one browser are modelled;
several hosts and browsers in separate tabs rely on the same per-host fence
and on revision ordering, covered by unit tests. herdr-core rename is covered
by unit tests (`server/src/world/commands.test.ts` settles a core room;
`server/src/herdr-core/operations.test.ts` runs `renameCoreRoom`), not by
replay. Other
commands (names, pins, colour, grouping) join as they move onto the path.
