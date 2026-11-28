## Decisions

After verifying the caller's process ancestry, the shared actor resolver opts
into Herdr's canonical `pane.get` row even when the request used a launch alias.
New actor labels and pane/tab/room fields come from that row. The lookup stays
on the same captured connection and generation. Unverified placement and answer
recipient reads still require an exact native ID. Core uses its existing
current topology description and adds its tab ID. No surface computes its own
location.

Actor snapshots remain immutable history. The existing JSON bodies gain an
optional `tab_id`; old records require no migration. Launch aliases need no new
store because Herdr already resolves them. Existing original-recipient equality
continues to check the captured pane, terminal and session, so accepting a lookup
alias does not retarget automatic answer input.

Self-answer refusal instead uses the question's stable connection and terminal
identity, just like question withdrawal. The CLI, recipient authorization,
atomic answer recording and dispatch guards share this ownership check even
for asks without a delivery recipient. Legacy records without a stable terminal
retain same-connection pane matching. Original-recipient checks stay strict for
delivery and acknowledgement; owning a question does not authorize either.

## Evidence boundary

The isolated CLI tests cover both native runtime mappings, before/after move
records, stale inherited runtime claims in both directions and a process that
claims another pane. The core move uses the real framed client, mirror, topology
and move operation against a disposable in-process core. Existing caller and
answer-delivery suites exercise nearest ancestry, replacement and generation
refusals. Self-answer checks exhaust all 128 combinations of verification,
connection, terminal, generation, session fingerprint, session ID and pane
equality, with separate legacy-record and exact-recipient boundaries. This
identity predicate adds no queue, ordering or recovery state for a new Quint
model; the complete verification gate still covers the answer lifecycle owners. Vendor
harness resume itself remains covered by the existing agent-move tests.
