## Context

See proposal.md for motivation and the owner's tab-only scope decision.
World already persists colour in the shared Board document. Its revision/event
stream is consumed across browsers, while native tab names remain Herdr-owned.
Existing colours have no terminal continuity witness. Agent profiles already
provide bounded sprite looks; runtime state colours have independent semantics.

## Goals / Non-Goals

Provide one terminal-title-bar editor and consistent appearance projection across
Board, Town, Desk and Spaces. Preserve existing native naming, colour inheritance,
profile defaults and same-origin operation. Workspace icons/status, image uploads,
Herdr protocol changes and authenticated multi-user policy are outside this work.

## Decisions

### Extend the existing shared document and revision stream

Add bounded tab/pane appearance records to Board's service document, keyed by
immutable connection profile ID, entity kind and native ID. Records carry current
terminal-ID witnesses. Keep `layout.colors` as the single authoritative colour
map: appearance records bind a tab's colour key and carry status/avatar fields,
never a second colour copy. Existing colour operations, move reconciliation and
reset operate on that same map. This avoids a second file/event protocol and
preserves older clients' document compatibility.

On complete current observation, adopt legacy tab colours without changing their
value and bind them to current terminals. First adoption cannot reconstruct old
identity; this one-time compatibility boundary is explicit. Bound choices apply
only to a current matching witness; missing/offline information cannot delete or
rebind them. Explicit editing of a newly observed occupant can replace an old
binding, clearing the old occupant's fields. Workspace/host colour storage is
unchanged. A tab retains choices through split changes while a witnessed terminal
continues; moves reconcile native IDs with their witnessed terminals.

### Admit writes against the exact runtime and observed terminals

The browser sends connection ID, runtime generation, native target and observed
terminal IDs. The service captures that runtime, re-reads the target, checks its
witness and checks currentness again immediately before the atomic document
patch. A retired runtime, missing target or conflicting witness refuses the edit.
Bounded data validation happens before persistence. Field patches preserve other
fields edited by another browser. Reads project metadata only onto matching
observed targets and never fall back to another connection.

Moves retain their whole document reconciliation in the existing per-connection
queue. After native probes, reconciliation reads the latest document. A bounded
in-memory edit clock distinguishes explicit colour/reset intent from Herdr close
cleanup; a move carries the latest explicit choice without treating a native
close as a reset. The clock is not another persisted colour source.

### Keep native naming authoritative and failures visible

Show the native tab label in the terminal header. The editor invokes qualified
Herdr `tab.rename` and refreshes the native view. No saved appearance name or
optimistic shadow label is introduced. Rename and World metadata saves have
separate visible outcomes because two authorities cannot commit atomically.

### Reuse bounded existing sprites and colour controls

Offer a small fixed set of existing sprite looks for pane avatars, retaining
profile/identity-derived defaults on reset. Colour/status belong to the tab;
avatar belongs to the selected pane. A common editor composes existing colour
controls with native name, bounded plain-text status and avatar choices. It is
accessible from desktop and phone terminal headers. Board card icon/status,
Town character/callout, Desk identity and Spaces icon/tooltip use shared selectors.
Runtime badges and their colours remain independent.

## Risks / Trade-offs

- Legacy colours have no historical witness → bind only from a complete current
  observation and document the one-time adoption limit; never guess after binding.
- Herdr IDs can be reused → require exact connection/runtime plus terminal witness
  on saves and matching observation on projection.
- Offline snapshots can be stale → retain metadata without treating absence as
  deletion or allowing edits.
- Native rename and metadata persistence can fail separately → surface each error
  and keep native labels authoritative.
- Existing large views have size caps → extract cohesive appearance adapters/editor
  rather than raising exceptions.

## Migration Plan

Read old documents with empty appearance records. Bind observed legacy tab colours
in the same document, with no duplicate colour source. Continue emitting the same
Board revision notification. New metadata is additive; an older build can read
its existing colour map, though it cannot enforce new witness semantics. Do not
rewrite unrelated notes, groups, interest or profile assignments.
