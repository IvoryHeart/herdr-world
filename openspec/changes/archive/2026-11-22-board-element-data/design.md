## Design

Use a closed typed shared registry with renderer/source keys, placement seams
and actions. Existing kinds retain their storage and operations; only memory,
log, document and link use the new element CRUD service. #1030 owns presentation.

New reference rows share Board writer transactions and committed invalidations.
Revisions fence stale update/delete/recreate. Reads bind the saved connection,
workspace and relative path to an explicit current generation using TUI/core
Files; changed elements, requests and runtimes retire pending results. Never
substitute a default host or cached topology. Links remain inert HTTP(S).

Keep the existing bounds: 500 references, 16,000 inline characters, 64 KiB text,
32 directory entries and eight simultaneous source reads, plus Board/writer
bounds. Confinement and errors preserve private roots. Saved transcripts remain
available without their original pane; agent metadata grants no authority.

Apartments retains migrations 14/15 and Board elements uses 16. Only the known
early Board-only schema-14 layout is recovered inside the normal private backup
and atomic upgrade transaction; unexpected damage still refuses. Real SQLite
operation permutations, source retirement matrices and finite predecessor/
rollback/retry cases provide Q50 evidence alongside the full verification gate.
No SQL model, new external effect or recovery state machine is introduced.
