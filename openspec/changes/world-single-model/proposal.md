## Why

World-owned concepts have several storage homes and view-specific identities.
The storage catalog makes current ownership visible before the staged single-model work tracked by #1251.

## What Changes

- Step 1 (#1252) adds an inert storage catalog, completeness checks, generated storage notes and an unused feature data-declaration hook. It changes no behavior or schema.
- Later steps converge owned entities, facts and records on one model; the deltas record the owner's six decisions as the target, not delivered behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-storage`: catalog, single-model ownership, separate Ranger, restart-safe Bin and user-controlled retention.
- `world-identity`: shared entity identity, World-owned assignments/master, one native-aware pin and separate view positions.

## Impact

The catalog and checks cover World/Ranger tables, configured files, browser keys and memory owners. No migration, runtime consumer, API, dependency or user data changes in step 1. Later steps require their own implementation and acceptance evidence before these target deltas can be archived.
