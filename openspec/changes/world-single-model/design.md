## Context

The current service has one World worker/writer plus separate Ranger stores, private/configuration files, browser data and memory sources. Inventory current reality before replacing storage families.

## Goals / Non-Goals

Step 1 delivers a side-effect-free catalog and future `declareData` seam with no registrations or consumers. Moving data, schema cleanup, a new stream and view rewrites belong to later steps.

## Decisions

- Catalog entries group locations with shared meaning, owner, identity, role and current limits. Generated notes expose the same information. Limits describe existing behavior; no new trimming runs.
- Completeness checks open synthetic World and Ranger schemas, resolve `DataPaths`, statically follow browser keys through constants/imports/helpers and independently discover stateful domain classes and named Store/Cache/Registry factories. Named functional stores are also inventoried. Request-local scratch and transport internals are not product sources.
- Future storage stays centrally migrated and written. Feature declarations carry validation, limits, lifetime and read scope; features do not create tables. The declaration hook is unused in this step.
- The owner's decisions override older proposals: World owns assignment/master; view positions differ; all pins converge; Ranger stays separate; the Bin persists; retention is user-controlled.

## Risks / Trade-offs

Static discovery cannot infer arbitrary program semantics. Browser key builders must remain statically traceable, and functional memory sources require an explicit named catalog owner. Tests cover discovery with synthetic additions. The catalog is descriptive, never a runtime authority.

Later schema steps must use the existing pre-upgrade `VACUUM INTO` snapshot, preserve legacy files under `<data>/legacy/` using hard-link publication plus verification, and never delete retained data. Synthetic schema 13–15 and pre-SQLite folders must traverse the whole chain with semantic dumps compared before/after. Rollback: stop World and restore the snapshot named by the error. Step 1 neither migrates nor opens real folders. Existing synthetic schema 13–15 upgrade and pre-SQLite import checks remain applicable; larger shared semantic-dump fixtures remain for the schema steps.
