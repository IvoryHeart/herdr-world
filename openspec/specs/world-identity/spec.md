# World identity

## Purpose

Give World-owned records store-issued identity independent of source IDs and
runtime fences. The current implementation covers the SQLite identity allocator
and ledger families; binding resolution, claims and legacy JSON-family migration
remain in the active `world-protocol-identity` change.

## Requirements

### Requirement: World IDs

WorldStorage SHALL provide a shared asynchronous ID allocator for new World-owned
records in `world.sqlite`. Each new ID SHALL contain a lowercase kind prefix and
eight random base32 symbols. The store SHALL check existing reservations and
reserve the ID durably before returning it. IDs SHALL NOT derive from counters,
clocks, source native IDs, labels, paths or runtime fences.

Existing SQLite IDs and record IDs imported from the ledger JSON store SHALL
remain unchanged and SHALL be reserved against new allocation. Allocation SHALL
check all registered families, regardless of a legacy ID's prefix. Reservations
SHALL survive record deletion, history retention and restart. A restored stopped
backup SHALL resume with fresh entropy and its saved registry, rather than a
rolled-back sequence. Closing storage SHALL refuse new allocation and drain
admitted allocations before releasing the worker.

#### Scenario: Imported IDs collide with new candidates
- **WHEN** a random candidate equals an existing imported ID, including one in a
  different record family
- **THEN** the store retries without changing the imported record's ID

#### Scenario: An old record is trimmed
- **WHEN** retention removes a SQLite record and its replay history
- **THEN** its ID remains reserved and cannot be allocated to another record

#### Scenario: Restore a stopped backup
- **WHEN** World opens an earlier stopped copy of its database
- **THEN** new IDs use fresh randomness and exclude that copy's reserved IDs

#### Scenario: Acknowledgement is lost
- **WHEN** ID reservation commits but the caller never receives the reply
- **THEN** reopening the store retains that reservation and never reissues it
