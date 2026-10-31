# Durable identity and bindings

Requirement: [store-issued World IDs](../../openspec/specs/world-identity/spec.md).
Approved full design: `openspec/changes/world-protocol-identity`, task 6 and M4.
The maintained boundary covers the allocator, verified bindings and runtime field
claims. Remaining JSON-owned ID creation is separate work.

Allowed: any earlier ID format preserved on import; global registry collision
retry; independent random allocation after restoring a stopped copy; permanent
reservations after trimming; unused reservations; refusal after close.
Forbidden: clocks/counters/native IDs used as new IDs; acknowledgement before
reservation commit; reuse after retention; collision checks limited to one
record family; import renaming an earlier ID.

## Implementation and evidence

`server/src/storage/world-ids.ts` is the worker-only registry and migration.
`WorldStorage.ids` exposes only asynchronous issuance, through the existing
bounded worker queue and per-operation savepoints. Ledger `nextId` consumers
await the same port; operation and outbox creation reserve in their domain
transaction. Migration and import triggers reserve existing IDs, answer
occurrences and historical references. None of these identities is authority.

`server/src/storage/world-ids.test.ts` drives real temporary SQLite writers and
the actual worker port. It forces collisions across imported and migrated
families, keeps IDs after record/history deletion and reopen, restores a stopped
database copy with fresh entropy, injects failures before and after COMMIT,
exhausts collision retries, and allocates concurrently through the worker.
Repeated ask upserts must preserve an already-reserved answer occurrence: a
parent UPSERT must not turn the reservation trigger's duplicate into a failure.
`world-identifiers.test.ts` checks symbol shape, collision retry and exhaustion.
`service/storage.test.ts` exercises the composition-root port and close fencing.
The existing complete storage, writer, crash, answer-migration and CLI suites
remain required consumers; import must not reinstate unverified answer evidence.

Direct SQLite integration and finite commit-boundary faults are selected over a
Quint allocation model: the actual database uniqueness, migration and worker
acknowledgement boundary are the relevant observations. This is not an exhaustive
proof of process/filesystem failures or random uniqueness. The tests use
deterministic eight-byte entropy for collisions and fresh production randomness
for the worker case. There is no claim about physical power loss, different
instances sharing IDs, or a restored copy's knowledge of discarded future IDs.

Two temporary production-code mutations are rejected by assertion failures in
the complete ID suite: ignoring the registry collision check (six tests fail)
and omitting the reservation insert (three tests fail). Parser/import failures
are not counted. The original source is restored after each control run.

## Binding requirements and M4 mapping

Allowed: reattachment after World restarts when the original evidence is still
present; World-witnessed moves; appearance following a unique terminal in a
complete listing; Board strings remaining unresolved after outside moves; only
kind-declared absence ending a binding; explicit owner decisions; weak empty
workspace/tab anchors remaining non-sendable; native-key layout inheritance.
Forbidden: guessing by labels/cwd/agent kind, attaching reused IDs without their
witness, attaching or ending from ambiguous observations, changing saved identity
on partial/offline reads, using a saved fence as identity, and dispatching from
an unresolved/unconfirmed/ended capture.

`quint/binding-resolution.qnt` models one pane binding under both Board and
appearance policies. Its two native IDs and two terminals, current/partial/offline
health, two runtime generations and two service incarnations cover complete and
partial observation, offline, Herdr/World restart, World move, lost move reply,
outside move, observed close, qualified not-found, duplicate identity, user
keep/detach and a look-alike. It makes no temporal-liveness claim.

The intended properties are no unverified retarget, only declared absence,
no attachment from ID reuse, ambiguity refusal, unresolved identity preservation
and attached-only actions. `quint/binding-resolution.ts` replays through the
actual resolver and compares state, saved native ID, evidence and ephemeral
authority. Required witnesses on each seed are restartUnconfirmed,
worldRestartReattached, partialKept, closeEnded, allTerminalsGoneEnded,
moveFollowed, lostReplyFollowedByTerminal, outsideMoveUnresolved,
duplicateUnresolved and lookAlikeRejected. Simulation uses 500 samples and at
most 25 transitions for seeds 42/73/103; 500 traces per seed are replayed. New absence and lost-reply witnesses require
actual ending/retargeting transitions, rather than later repeated observations.
TLC explores the finite domain. The model BROKEN fault treats an old pane's
absence as Board absence, and its counterexample must disagree with production.

Six compiled source controls test witness comparison, duplicate admission,
Board listing-move refusal, listing-absence policy, partial-observation identity
preservation and attached-only target issuance. Each must fail a named replay
observation, not parser/loader/cleanup checks. The direct exhaustive policy tests
cover all four record policies, foreign fences, known/unknown session evidence,
weak anchors, ended lifetimes and explicit decisions. Every resolution property
test must be killed by at least one matching production mutant.

## Durable and consumer boundaries

`WorldStorage.bindings` reserves binding IDs through the same single SQLite
worker and stores no incarnation, generation or transport epoch in identity.
Reads expose unresolved captures; only a fresh resolution supplies an ephemeral
qualified target. The caller must still check its exact lease before dispatch.
`world-bindings.test.ts` covers persistence/reopen, independent record slots,
bounded pages, strict identity/observation validation, permanent ID retirement,
close fencing and interrupted legacy-import recovery.
`storage/binding-order.test.ts` exhausts both commit orderings for an observation
and an explicit record edit, with present/absent reads under all four policies
(16 schedules). A captured record revision must match before resolution writes;
a conflict returns no target and leaves the newer record untouched. Removing
that comparison in a compiled production mutant must fail the real SQLite
ordering assertion. The Board Send consumer also rebinds during its native read
and checks that the older worker request cannot change the new binding. This
direct finite database check covers the read/edit boundary outside M4's atomic
resolve transitions; it does not add source-observation ordering guarantees.

The lazy `BindingBoardStore` projects existing Board strings, appearance/tab
colour and agent-interest captures into SQLite while keeping the JSON owner
representation. Imports use bounded pages and a persisted in-progress marker;
an interrupted import cannot authorize its legacy bindings. A subsequent complete
World-record import reconciles them. This complete World-owned record listing is
not source topology absence. Compatibility aliases never become new World IDs.
All bounded capture pages are prepared before the immutable continuity plan is
computed and before any binding/alias mutation. An old-to-new and new-to-old
match must both be unique; application pages cannot consume candidates in order.
The plan is in memory, while the durable in-progress fence survives its loss.
Incomplete application cannot finish or authorize legacy targets. A uniquely
witnessed appearance can retain its IDs; splits and merges never choose an old
identity. `legacy-binding-plan.test.ts` exhausts 256 two-record witness graphs,
both appearance policies and both old/current record orders (2,048 cases).
`legacy-binding-match.test.ts` drives real worker splits in both orders, across a
64-record page boundary, and confirms that actual one-to-one moves retain both IDs.
Unchanged identity preserves an ended state, and layout-only changes create no
binding records. Close drains admitted captures. Storage failure stops the root.

The Board Send RPC resolves the saved string against a complete native pane list
on its captured source/runtime, including duplicate terminal/session refusal,
then uses the existing recipient and fresh send checks. Neither the binding nor
this extra read makes Herdr's final read/prompt atomic. A failed/stale/partial
read never proves absence or allows fallback to another connection.

Mandatory existing consumers remain unchanged: Board store/anchor/recipient/send
witness tests; appearance observation/move/pruning and colour/close tests;
terminal-settings tests; and existing browser Board/appearance projections.
`service/binding-storage.test.ts` additionally checks actual root persistence,
World-record/binding ID continuity, interrupted recovery and workspace-ID reuse
inheriting layout/colour while a witnessed string is unconfirmed.
`world/board-binding-send.test.ts` and `rpc/board-binding.test.ts` exercise the
real storage/action consumer and actual RPC refusal before downstream input.
These consumer mappings need independent acceptance as well as the model.

Destructive appearance/interest consumers admit all reported native, terminal
and known-session identities through the shared ambiguity rule before creating a
terminal absence set. `binding-pane-list.test.ts` exhausts their identity
projections (including terminal-only and explicit unknown-session cases).
`binding-prune.test.ts` checks actual Board/SQLite capture retention for duplicate
native/terminal/session data through both native consumers, snapshot proposals
and fresh native rechecks. Complete unambiguous absence still reclaims records.
These consumer tests retain their original generation/revision gates and the
existing witness suites remain unchanged. Compiled controls removing the old
record's outgoing uniqueness or dropping native/session admission must fail
assertions; load or cleanup errors do not count as detection.

## Runtime field claims and direct evidence

The current multi-source fields are agent status and PR links. Native harness
session/thread IDs are additional claims about the occupant, never World IDs.
The typed field policy declares channel precedence for status/session, both PR
links with provenance, and reported-only session authority for named send verbs.
Conversation Send still re-reads its pane and keeps its original title/session
checks. PR verbs explicitly require GitHub's own record; a reported or inferred
link is display evidence only. The old visible projections remain unchanged.

`world/field-claims.test.ts` exhausts all 512 length-three sequences of report,
partial silence, complete omission and explicit retraction across two channels.
Its independent map oracle checks source ownership at every transition, detached
input/output values, coexisting evidence, declared display and reported-only
verb authority. `agent/agent-claims.test.ts` adds eight overlapping read schedules
across same/replaced terminals, with old transcript completion before/after the
new observation and transcript. It also checks native session replacement,
complete native absence and runtime disposal. These direct finite checks cover
source ownership and local publication order without expanding M4's atomic
binding-resolution model; no new timing or liveness claim is made.

`agent/conversation-claims.test.ts` reads an actual synthetic transcript through
the real conversation source and cache. Herdr idle and inferred working coexist;
removing the transcript keeps its earlier inference, and losing the current
native session refuses Send without downstream input. Regressions also remove
the reported session itself while preserving the other channel's evidence. Native IDs retain their
full provenance as values. Existing conversation send/title/race tests remain
mandatory consumers. `sources/link-claims.test.ts` drives the actual linker and
service: disagreement survives, reported-first legacy links stay unchanged,
metadata omission removes only its report, failed topology/git/source reads
retain other claims, and only complete unambiguous native absence retires an
occupant. A reported URL outside GitHub's own items remains visible evidence but
cannot authorize a PR verb. Existing source/action/freshness consumers remain
mandatory. Claim updates are staged with the source-service epoch so retired
refreshes cannot write them.

Seven compiled production controls remove partial-silence preservation, choose
the last status instead of the declared first channel, admit inferred authority,
ignore read ordering, reuse an occupant's evidence, admit ambiguous link topology,
or omit open-tool status inference. Each fails the intended test assertion;
loader/parser/cleanup failures are excluded. Claims live only in runtime memory;
the evidence does not establish provider truth, arbitrary native event order,
physical durability, or an atomic downstream read-and-send.

## Evidence and acceptance

Run the unfiltered `bun run verification:gate` plus complete mandatory consumers
and the applicable delivery gate. A focused M4 pass is development evidence only.
Manifests retain source/tool/input identity, per-seed replay witnesses, negative
controls and resource accounting through the existing gate. Each model receives
its measured shard weight; protected reports and branch rules are unchanged.
Independent PR review and CI are required. The ID foundation's review does not
accept the binding or claim extensions. JSON-owned ID creation,
physical power-loss safety, arbitrary provider/OS behavior and downstream
exactly-once execution remain outside the model and this candidate.
