# Ranger and transcript repair boundaries

This repair belongs to PR #645, targeting `agent/roamgate-integration`, with frozen
Roamgate source `2b16e991eeb2e90f55c948e249acaef1497d5254`. It does not advance the
source synchronization point or establish final main or owner-preview acceptance.

The three independent review bodies remain distinct: [Sol S](https://github.com/IvoryHeart/herdr-world/pull/645#pullrequestreview-5731505635),
[Sol's Astra delegate D](https://github.com/IvoryHeart/herdr-world/pull/645#pullrequestreview-5731506289),
and [assigned Astra A](https://github.com/IvoryHeart/herdr-world/pull/645#pullrequestreview-5731509494).
The delegate is not the assigned Astra seat. All 20 original numbered findings
are retained below; D2 also contains the separately retained notice finding.
Author repairs require fresh independent verification before closure.

| Topic | Original IDs / priorities | Repair and maintained evidence |
| --- | --- | --- |
| T01 dynamic intent | S1, D2, A2 / P2 | SQLite v4 records membership explicitly, migrates v1-v3 transactionally, preserves old fixed plans and refuses damaged flags. `task-storage.test.ts` migration/reopen and `tasks.test.ts` new admission after restart cover dynamic and fixed controls. |
| T02 proposals | S2, D1, A1 / P2 | Saved proposal normalization retains dynamic intent. `service.test.ts` drives manual model-tool creation and management proposals through actual SQLite save/confirmation; storage reopen retains proposals. |
| T03 continuation provenance | S3, D3, A3 / P2 | Candidate discovery returns paths only. Shared service parsing uses bounded top-level JSONL metadata; nested IDs, malformed records and ambiguous successors confer no authority. `claude-ssh.test.ts` executes the production POSIX payload against disposable files; local resolver controls use the same parser. |
| T04 local lookup claims | S4 / P2; D8, A5 / P3 | Accepted scoped-documentation remedy: CHAT, HISTORY and disposition #563 distinguish SSH configured-root/unique UUID discovery from unchanged local default-root/newest-match lookup. Local configured-root parity is not claimed or implemented here; overlapping main Chat work remains for later reconciliation. |
| T05 process ownership | S5, A4 / P2 | The local runtime's enumeration uses its captured binary runner and abort signal. The standalone local file adapter starts no process. The runtime-process table covers current/retired/independent owners; an active-child control checks that runtime stop aborts the native process port. |
| T06 permission prerequisite | S6 / P2; D7 / P3 | Accepted narrower-contract remedy: Tutorial, Deployment and the current spec describe dynamic membership over current explicit grants, without requiring broader high permission. Existing service admission tests include newly granted and excluded workspaces; manual model proposals remain valid. |
| T07 omission notices | S7 / P3; D2 subfinding / P2 | The run row persists notices after completion. Real SQLite reopen tests retain the notice independently of unfinished admission data. |
| T08 cached identity | D4 / P2 | Every authoritative remote read renews the validated UUID lookup. Successor cache entries validate exact returned paths and invalidate on source/successor identity, size or time changes. `session-file-access.test.ts` refuses a new duplicate UUID and substituted stat path with one resolver context. |
| T09 queued branch content | D5 / P2 | Branch, metadata and sidechain filters precede queue/attachment projection. `session-trajectory.test.ts` retains live human content and excludes rewound/sidechain attachments. |
| T10 newline paths | D6 / P3 | Candidate enumeration is NUL-delimited; structured reads retain complete paths. The selected-host Claude fixture contains a newline and quote in its project directory and finds only a proven continuation, including files written within the same second. |

Two original private probes demand the broader local-root/global-grant remedies.
Their failure is not represented as a green executable regression: T04 and T06
use the scoped remedies expressly accepted in the review-routing clarification.
Current local behavior and narrower grants are preserved; no finding is waived
by this distinction. The repair handoff records its exact commit and evidence for
every original ID, while reviewer acceptance remains separate.

The continuation parser reads at most 1 MiB from each of at most 200 sibling
candidates. Malformed or ambiguous provenance retains the reported transcript;
lookup/ownership failures refuse rather than falling back to another runtime.
Unchanged successors may retain the 30-second discovery interval, with explicit
metadata invalidation; remote UUID uniqueness is renewed on every resolution.
Model bounds remain unchanged. Direct filesystem/SQLite/process-port consumers
provide the new evidence; platform/provider and final integration exclusions stay.
