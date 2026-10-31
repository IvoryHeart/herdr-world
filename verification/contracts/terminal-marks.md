# Durable terminal marks

Owner approval: `briefs/persist-marks.md` changes the former restart-clears rule.
Current contracts: World storage, World identity and World surfaces. Q51 is
candidate direct evidence; independent review and native CI remain required.

Allowed: store-issued record IDs and source bindings commit with bounded metadata
in the existing SQLite worker. Restart captures remain unresolved until a fresh,
complete, unambiguous observation of the original source verifies them. Runtime
generation and service incarnation qualify work and projections, never durable
identity. Watchlist follows the terminal; Desk and completion checks also require
their captured session when known. Explicit unknown session binds to terminal.
Complete current terminal absence clears each kind. Positive known-session
replacement clears Desk and seen; watchlist survives. Busy evidence or later
native completion progress ends seen. Exact Undo retains a newer review mark.

Forbidden: attaching duplicate pane, terminal or session evidence; inferring
continuity from names, paths or reused pane IDs; publication before commit;
publishing an old projection after runtime retirement; losing a neighboring
accepted transaction to a refused mutation; persisting runtime fences or transcript
text; adopting browser-local IDs without continuity evidence; duplicating Board
layout ownership.

Evidence uses actual temporary SQLite, the worker and production RPC handlers.
`storage/terminal-marks.test.ts` checks stable IDs, unresolved restart capture and
storage integrity, all 24 independent-family/refusal orders and revision fences. `world/persistent-terminal-marks.test.ts` exercises all three
identity ambiguities, complete absence/reuse, terminal moves, positive session
replacement, unknown session, missed native progress, two real browser stores
per family, exact Undo, refused writes, retirement during acknowledgement and native admission across a replaced
then restored session. The 40-open bound spans sources and equal-time actions. Display expiry commits without a source read;
expiry/Unpin replies and background writes cannot cross a disconnect and restore
an old projection.
`service/terminal-marks.test.ts` checks the composition root, two real WebSockets,
change notices and restart against the same database. `storage/terminal-marks-crash.test.ts`
uses source and standalone compiled processes, killed before commit, after commit
and after worker acknowledgement; admitted writes also drain on close. It checks
complete record/binding pairs and integrity. Native installer CI includes these
eight cases. Seven compiled production faults each fail named assertions; two
positive bundled suites establish the harness. Existing binding, Desk, watchlist, completion and browser consumers
remain mandatory.

Direct finite transitions, real SQL savepoints and process schedules provide
evidence at the actual persistence boundary; a new model of SQL would duplicate
those rules without exercising SQLite. The existing binding and runtime models
remain required, with the new per-kind declarations checked directly. Run the
unfiltered `bun run verification:gate`; a focused model case does not replace it.

Migration has no current file or browser owner to import: the old service's
process memory is gone on upgrade, and historical browser keys lack binding
evidence. The first upgrade therefore starts these families empty. Board's
existing layout migration belongs to its separate owner.

Excluded: physical power loss, arbitrary storage corruption, all possible remote
read schedules, replay of source events, exactly-once external effects and
persisted runtime claims. A source without native progress cannot reveal a
working/completion cycle World never observed. Multi-record observation repair
uses bounded independent row transactions; a crash may retain a committed prefix,
which is freshly re-resolved after restart. A user mutation acknowledges only
after all its resulting row writes finish. Browser/native CI and independent
consumer-mapping acceptance remain separate from local evidence.
