## ADDED Requirements

### Requirement: Inspectable storage ownership

World SHALL maintain one catalog of durable tables, data-folder files, browser keys and in-memory data owners, including each location's meaning, feature, identity, source/cache/derived role, limit and owning code. Completeness checks SHALL reject uncataloged tables, configured paths, browser key families and memory owners. Storage notes SHALL be generated from this catalog without opening user data.

#### Scenario: A storage home is added
- **WHEN** a migration, path, browser key family or memory owner is introduced without a catalog home
- **THEN** the completeness checks fail and the notes cannot silently omit that home

### Requirement: Single owned model target

World SHALL expose the same owned entities, facts and authored records to Desk, Town, Board, Spaces and future Code consumers, with one ordered revision. Runtime observations SHALL remain bounded, read-only and distinct from owned truth. Configuration, secrets and cross-instance discovery SHALL retain their justified separate homes. Ranger SHALL remain a separate subsystem and SHALL refer to workspaces by entity ID.

#### Scenario: Views read an owned annotation
- **WHEN** two views display the same entity's committed annotation
- **THEN** they read one owned record rather than maintaining separate sources

### Requirement: Restart-safe Bin target

World SHALL preserve reversible Bin holding intent across a service restart without converting an uncertain close attempt into permission to replay it.

#### Scenario: Restart while an agent is held
- **WHEN** World restarts before a held entry is committed for closing
- **THEN** the entry remains available to put back

### Requirement: User-controlled retention target

World SHALL NOT automatically trim user data, ended entities, sessions or history. Cleanup and history size SHALL be the user's decision, accounting for each harness. Old schema snapshots and legacy files SHALL be preserved under the instance's legacy folder through verified hard links, never silently deleted. Schema upgrades SHALL retain the existing pre-upgrade consistent snapshot and identify the snapshot needed for rollback.

#### Scenario: History ages or a schema snapshot is superseded
- **WHEN** retained user data ages or newer snapshots exist
- **THEN** World preserves it until the user chooses cleanup
