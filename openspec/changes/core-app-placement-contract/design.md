## Context

The owner places World alongside Herdr's desktop app as a peer editor of the
core's `herdr-app` document. This replaces the read-only proposal and archived
M1/M2 for core rooms. See [proposal](proposal.md) for motivation.

## Decisions

The sourced [capability design](../../specs/herdr-core-runtime/app-layout-design.md)
records the schema, shared read path, versioned write intents, conflict and
uncertain-write handling, migration, storage, verification and rollback.
It is the design-first deliverable. The pending
[delta](specs/herdr-core-runtime/spec.md) does not assert delivered behavior.

## Delivery boundaries

This PR contains documentation only. Earlier implementation is removed from
its candidate diff. Follow with separate read and write PRs, in that order.
Reuse this active change and keep implementation tasks open until verified.

## Risks / Trade-offs

- Concurrent desktop edits → preserve raw JSON and reapply intent on version
  conflicts, refusing changed targets instead of replacing an old snapshot.
- Non-atomic terminal/document writes → report partial or uncertain results;
  never replay an ambiguous write or roll back over a later app edit.
- Legacy layouts disagree → app membership wins; import only missing content
  and retire legacy placement authority after acknowledged migration.
- Mobile fallback lacks published implementation evidence → cite the owner's
  observation distinctly and require phone acceptance alongside fixtures.
