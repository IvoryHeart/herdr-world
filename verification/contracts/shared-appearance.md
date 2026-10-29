# Shared appearance consumer contract

## Intended behavior

The source is the shared terminal appearance and terminal colour requirements in
`openspec/specs/world-surfaces/spec.md`, derived before implementation in
`openspec/changes/shared-appearance/specs/world-surfaces/spec.md`.

Allowed: current tab colour/status edits, native tab renames, independent pane
avatars, per-field resets, continuing split witnesses, positive move/compensation
evidence and legacy colour adoption from complete current observations.
Forbidden: another connection or retired generation authorizing an edit; a
conflicting occupant inheriting a bound choice; offline/partial absence rebinding
metadata; an old save acknowledgement replacing a newer revision; or a failed
native rename installing a World-owned shadow name. Runtime badge semantics stay
independent of manual colour/status.

## Evidence choice and mapping

The maintained runtime lease model and actual manager replay continue to establish
lease currency, as documented in `runtime-leases.md`. The appearance handler is
an additional consumer, tested directly rather than copying those manager
transitions into another abstract model. A 64-case finite matrix crosses the two
operations, two connections, two generation choices, two witness choices and
retirement at none or each of three native reads. It executes the actual RPC
handler with controlled runtime reads and checks document revision, errors and
native rename dispatch. Existing API/manager consumers remain mandatory.

In-flight moves retain a bounded in-memory colour-edit clock: explicit edits and
resets advance it, while native close cleanup does not. A concrete store test
distinguishes those histories. The per-connection move queue includes metadata
reconciliation, with current document reads after native probes, so another move
or a delayed snapshot cannot overwrite unrelated field/string edits.

The actual document store is reopened for persistence and exercised for
independent field patches, schema bounds, avatar resets, colour aliasing,
replacement IDs and confirmed moves. Observation tests require complete current
coverage before legacy adoption, learn continuing split witnesses, and reject
conflicting or unavailable evidence. Move tests reject reused occupants and
require positive complete witnesses for compensated tab relocation.

Two independent browser document clients test normal shared revisions and a held
old acknowledgement after a newer peer edit. Projection tests keep runtime state
unchanged while Board/Town receive the same status and independent avatars.
Town look tests check stable frame references and restoration of profile defaults.
The existing CLI colour path uses the same single colour map and current tab
witness, checking host currency after observation. Its Undo probe includes the
bound occupant, so an old undo cannot erase a replacement's equal-colour edit or
restore the preceding occupant's colour. Legacy unbound undo records may be
refused after migration instead of being guessed onto a new binding. A failed
ledger write compensates both colour and binding/status to their original values.
The two-profile Chrome test drives the actual editor/header on desktop and phone
through the actual service handler and persistent store. It checks cross-client
updates, native failures with retained drafts, independent pane resets and
viewport bounds. Its native runtime and event stream are synthetic; existing
Bridge/WebSocket, live Herdr and native window/handoff browser consumers remain
responsible for their transport and integration boundaries.

## Limits and required checks

This direct finite evidence does not enumerate arbitrary Herdr split/move races,
external runtime internals, network schedules or authenticated principals. Native
Herdr rename has no atomic terminal-witness precondition: World revalidates the
captured runtime/observed target before dispatch, while the native operation's
own atomicity remains Herdr's responsibility. Stored choices stay witness-scoped.
Legacy colours have no reconstructable historical identity; one-time adoption
preserves their current choice, then enforces continuity. Unknown observations
retain records. Fixed bounds and persistence errors remain explicit failures.

Run the unfiltered `bun run verification:gate` through the required delivery gate,
plus the maintained affected unit and browser consumers. A focused matrix or
browser pass does not substitute for the complete gate or independent PR review.

These added consumers await independent PR review; prior acceptance of the
foundation models does not accept this extension automatically.
