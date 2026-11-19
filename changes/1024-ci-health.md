### Changed

- Reduce CI contention with parallel core model controls, concurrent static and unit lanes, precise native inputs and exact-input checker/film caches.
- Check PR description and changelog policy before pushing, and report bounded CI and delivery measurements with `bun run ci:health`.

### Fixed

- Serialize expensive Town browser cases within each shard so software rendering does not compete with another Town fixture's clock.
