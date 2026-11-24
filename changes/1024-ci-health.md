### Changed

- Reduce CI contention with parallel model and unit checks, precise native inputs, shared macOS runners and reusable checker caches.
- Check PR description and changelog policy before pushing, and report bounded CI and delivery measurements with `bun run ci:health`.

<!-- detail -->

- Reduce CI contention with parallel core model controls, concurrent static and unit lanes, precise native inputs, shared macOS installer/launchd runners and exact-input checker/film caches. Reuse owned core checkers and generate targeted replay witnesses after exhaustive fault checks.

### Fixed

- Serialize expensive Town browser cases within each shard so software rendering does not compete with another Town fixture's clock.
- Include red final reruns in CI health samples, and check stacked PR policy against its actual immutable base.
- Commit synthetic SQLite fixture initialization once, retaining full durability for replayed operations while avoiding per-setting fsync bottlenecks.
- Keep the appearance close-churn capacity regression on the real store with a memory backing, avoiding thousands of unrelated durable file flushes.
- Initialize Ranger replay databases from a production-created empty seed while replaying every real SQLite save, rollback and reopen within the original deadline.
