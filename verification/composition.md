# Authority and lifecycle composition

Review each producer guarantee together with the real consumer assumption. A
passing component model cannot authorize a consumer's operation by itself.

| Identity | Owner and evidence | Consumer obligation |
| --- | --- | --- |
| Connection ID and server runtime generation | Manager lease/administration/drain models; real manager tests | Capture both immutably; no explicit-ID failure may fall back to another host. |
| Browser transport epoch and runtime lease object | Real Bridge in assembly, preparation and creation replay; API regressions | Late sockets/replies and omitted generation under negotiated generation capability cannot restore authority. |
| Observation epoch | Refresh/preparation models and real World store | Retire publication across disconnect; revalidate each captured runtime after cooperative yields without discarding healthy siblings. |
| Socket/request/batch index | Credit/assembly models, actual sender/admission/Bridge integration | Unique request IDs within socket lifetime; only the expected batch releases credit. Credit is read-only, not runtime operation authority. |
| Decoder job/AbortSignal | Assembly model; actual decoder/worker/browser tests | One request owns completion/retirement; large-worker capacity, thread behavior and URL cleanup remain real tests. |
| Qualified terminal/attachment attempt | Creation flow and existing ownership/handoff regressions | Advertisement alone is insufficient; old acknowledgement or cleanup cannot replace the current attempt. |
| Creation event/request identity | Actual store/coordinator/Bridge in creation replay | Single-flight key includes owner, runtime, kind and source; uncertain dispatch is not retried automatically. |
| Navigation revision and Inspector intent | Creation admission plus actual SharedViewCreation/terminal-handoff browser suites | A valid mutation result is insufficient for focus after newer user intent; real openers must obey cancellation. |
| Task/workspace permission and cancellation | Ranger action replay plus real service/task confirmation tests | Supply the live authorization predicate at target checks and immediately before send; readiness cannot replace permission. |
| Shared appearance entity and terminal witness | Actual appearance RPC admission matrix, document/move/migration tests and two-profile Chrome editor | Capture immutable connection and runtime; validate current native target and terminal continuity before field saves/native rename. Revisions suppress older acknowledgements; no shadow name or conflicting occupant inheritance. See [bounded consumer contract](contracts/shared-appearance.md). |
| Durable endpoint/boot/workspace identity | Ranger SQLite recovery replay plus context/task/SDK storage tests | Obtain a fresh lease only after durable identity comparison; recovered rows still require scheduler and permission admission. |
| SQLite transaction and exclusive storage lease | Actual task storage rollback/reopen and durable-storage lock-loss tests | Local filesystem and SQLite commit guarantees are assumptions; retain private-file, migration and corruption checks. |

The protocol integration tests connect real sender, admission, Bridge and World
store. They demonstrate no partial publication, generation-1 rejection after
ready generation 3, and suppression of queued credits after transport retirement.
Creation replay connects real ownership preparation, qualified dispatch, uncertain
retirement and generic conditional admission. Browser suites verify the hook and
opener assumptions that a headless admission model cannot establish.

Legacy omitted-ID compatibility is deliberately separate from explicit admission:
existing protocol/HTTP/API tests check the negotiated legacy active-host path.
Generation-capable clients must supply explicit generation, and explicit unknown
IDs cannot use that compatibility path. The new generation-omission fault control
checks this real Bridge boundary. No socket, epoch, readiness or UI intent token
substitutes for another identity. Ranger permission and durable identity now have distinct implementation-connected
models. Their supplied predicates, scheduler admission and storage assumptions
remain mandatory consumer obligations.

All mappings were independently accepted within their documented bounds in
[review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164).
Final implementation and gate acceptance is recorded in
[review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140);
owner-approved PR #188 merged as `481ca1e8`. The consumer obligations and storage
assumptions above remain binding; acceptance does not extend the documented claims.
