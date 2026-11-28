# Shared herdr-core app layout design

Status: design step for issue #1435. Read and write implementation follow in
separate PRs, in that order. The owner decision of 2026-11-27 supersedes M1/M2
for core room arrangement. The [active delta](../../changes/core-app-placement-contract/specs/herdr-core-runtime/spec.md)
holds the pending contract; current `spec.md` remains the delivered contract.

## Contract and sources

World and Herdr's apps share the core's machine-local `herdr-app` document.
Existing spaces/tabs keep their IDs, names, order and pane placement. Missing
spaces are created there, including the requested **Crew** space. World has no
second core room arrangement. Town geometry, Board pins and checkout metadata
remain World presentation/resource metadata.

Sources checked at app commit `1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa`:

- [Skill](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/SKILL.md)
  and [guide](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/defaults/AGENTS.md):
  labels adopt terminals into machine-local IDs. Installed `herdr-app --skill`
  was unavailable; its published source was verified against upstream blob IDs.
- [mirror.rs](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/mirror.rs):
  `spaces[{id,name,folder,tabs:[{id,name,root}]}]`; IDs are local in the document,
  machine-qualified only in the client model. Unrecognised space/tab fields
  survive the app's own round trips.
- [layout.rs](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/layout.rs):
  a root node has `id,type`; a `block` has `content:{terminal:"t1"}`;
  `row`, `column`, `stack` have recursive `children`. Nodes also support
  `floating` blocks, size, styling and other content. A terminal list is not
  this schema; new panes use this node format, with collision-free IDs.
- [window.rs, reconcile/start_adoption/adopt](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/window.rs#L2416):
  only terminals without panes are adopted from labels; missing spaces/tabs
  are created, and `terminal.keep {terminal,keep:true}` precedes adoption.
- [model.rs, space_name/tab_name](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/model.rs#L265):
  explicit names win; otherwise the first terminal's checkout/working folder,
  then space folder, supplies a space name; unnamed tabs use their ordinal.
- [mirror_sync.rs](https://github.com/herdrdev/herdr-app/blob/1180a5cec3b8bd4dfebf4a9b217ab8cb59a96ffa/src/mirror_sync.rs#L75)
  and [core schema](https://github.com/herdrdev/herdr-core/blob/2e8043a2a47db0130943135805f4ec82c2a764bd/schema/README.md#documents):
  `doc.get {name}` returns `{value,version}`; absence is null/version 0.
  `doc.set {name,value,version}` compares that version and returns a new one
  or `conflict`. Values are capped at 1 MiB; `doc` events name the document
  and version. Core stores opaque JSON, not a space registry.

The [mobile guide](https://herdr.dev/mobile/#your-spaces) describes shared app
spaces. The owner's Android observation on 2026-11-27 establishes folder grouping
without a document; the guide does not specify that fallback algorithm.
Parentage does not nest those groups. The dispatcher needs no change: retain
shared `herdr.space=crew` and distinct desk tab IDs. `where` is output only;
there is no supported display-name label.

## Read path: second PR

Subscribe to the unfiltered ordered stream and read `herdr-app` on the same
original connection, bound to immutable connection ID, generation and durable
core ID. Refresh on local app `doc` events, missed/recovery cuts and reconnects.
A notification overtaking a read invalidates it and schedules a coalesced read,
without timer polling. Retired replies cannot publish. Other-document and
linked-machine events cannot substitute this core's layout.

Keep raw JSON beside a bounded runtime projection, without another persisted
layout. Traverse terminal blocks, containers and floats, preserving unrelated
content. Linked references remain non-actionable without invalidating local
spaces. Malformed known structure, duplicate identities and oversized documents
are unavailable for editing, never mistaken for absence.

Feed document membership, order and explicit names into the unified World object
for Town, Desk, Board, alerts and room lookup. Uncovered terminals use working
folder groups; missing folders use a visibly unnamed fallback. Labels, legacy
SQLite and ancestor placement cannot override document/folder membership.
Preserve PR #1416's stable derived-name memory, markers and suffixes as display
fallback, supplying document/folder evidence instead of `where`. No derived
name is written back. This PR leaves the base code unchanged.

The read stage makes no document writes or migration. Moves/renames needing a
document edit explain their temporary unavailability instead of reporting a
label-only edit as shared placement.

## Write path and conflicts: third PR

World admits a create, launch, move, rename or migration intent with its original
connection/generation and terminal-program fences. Read the latest raw document
and version; transform only the intended target by stable IDs. Preserve unknown
fields at every level, unrelated spaces/tabs, node attributes, floats, mods and
order. Never reconstruct the whole document from a typed subset. An unfamiliar
structure that must be edited is refused without data loss.

For adoption, recheck the terminal and set `keep:true` before inserting its pane.
Allocate stable collision-free IDs once per intent. Joining a tab preserves its
tree and inserts the pane; moving a desk preserves its tab and full subtree.
Never prune an emptied foreign space/tab or rename/delete one unless the owner
requested that specific action. Unknown creation provenance counts as foreign.

Every `doc.set` uses the version just read, including 0 only after a successful
absent read. On definite `conflict`, reread and reapply the original intent to
the new JSON/version, never resend the stale document. Recheck membership,
destination, fences and whether the intent is already satisfied. If another
editor moved/removed the target, refuse instead of undoing their change. Bound
the operation by a deadline and report contention when exhausted.

An ambiguous timeout/disconnect is uncertain, not a conflict retry: reconcile
by reading without replay. Core cannot atomically combine keep, labels and the
document; report partial adoption without rollback over other editors. Refresh
compatibility labels/captions from committed placement under program fences.
A caption failure cannot undo the document or become another layout. Publish
success from the acknowledged or freshly observed committed document.

## Migration and storage

At the first writable synchronization, read before planning migration. Import
only live, local, unadopted terminals; existing app membership/names always win.
Reuse label IDs and legacy `app_space` IDs; map World room/tab IDs to their
existing `world-…` adoption IDs. Add missing spaces/tabs/panes, including empty
rooms explicitly created in World, without resetting the app layout, deleting
foreign content or restarting programs.

New names come from explicit saved World room labels or this issue's authorized
`crew` → `Crew` bootstrap. Other label-only spaces stay unnamed, matching app
adoption; never recover names from `where`, even during migration. Crew desks
keep distinct `crew-…` tab IDs and readable names despite different worktrees.

Reuse `core_topology` for migration acknowledgement, created-ID provenance and
checkout metadata, never continuing membership/name authority. The write PR
updates its schema and `server/src/storage/catalog.ts` together; no new table or
data file. Retain legacy data until acknowledged import, with no automatic
trimming. Record completion only after document readback. Deterministic IDs
make crash recovery idempotent; acknowledged migration does not resurrect
app-deleted spaces from stale legacy data. Map pins/positions/checkouts to the
committed room/tab IDs without changing terminal identity.

## Delivery, acceptance and rollback

1. Design PR: this note, navigation and pending requirements/tasks. No runtime
   changes, document writes or claimed UI change.
2. Read PR: real-schema fixtures, external rename/move refresh, folder fallback,
   linked references, event/read/recovery races and shared consumers. Capture
   Town/Board before/after regrouping and compare actual phone Spaces.
3. Write PR: isolated-core two-tab adoption with document/label/keep readback,
   concurrent editor conflicts, unknown-field round trips, migration/restart,
   explicit move/rename and uncertain outcomes. Assess Q52 coverage, extend its
   model/adapter where useful and pass the full verification gate. Supply
   bounded conflict/migration preview fixtures and exact owner clicks. Capture
   Town/Board/phone before/after on the same machine; real-machine writes belong
   to a later authorized owner try.

For the reported Linux core, the read step replaces World's inferred Crew room
with folder groups like the phone. The write step publishes Crew and its desk
tabs in both. Existing desktop arrangements survive. Real phone captures remain
owner/dispatcher acceptance, never fabricated from fixtures. Q8 stays open until
desktop and phone agree; label readback alone is insufficient.

Rollback stops World writes and keeps the shared layout already published;
never restore a saved whole document over subsequent app edits. Older World
versions may still show their legacy arrangement. This design does not change
PR #1416's implementation or require its feature.
