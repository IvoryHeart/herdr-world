# Locked development verification tools

This package is deliberately outside the application's Bun workspaces. Its
`package-lock.json` is an explicit exception to the root Bun-lockfile convention:
Quint's development-only dependency graph is independently locked and never included
in shipped application assets or dependency resolution. Use `npm ci --ignore-scripts`,
not an unlocked global install. The package inventory is in `DEPENDENCY_NOTICES.md`;
actual tooling/checker redistribution must preserve upstream licence texts.

`checker.json` pins Apalache 0.62.1's release URL, archive SHA-256 and extracted JAR
SHA-256. That distribution provides translation and TLC. `tlc.json` limits the
checker to one worker, a 1 GB heap and a 16 MB stack. `verification:setup` downloads
and verifies the distribution into the checkout's ignored `.agents/verification/`
cache. The check verifies the installed JAR and does not download a checker.
It uses a private allocated endpoint for each invocation instead of borrowing an
existing local server. Checker and replay workers have owned POSIX process groups,
deadlines and TERM/KILL drain, including grandchildren and inherited pipes.

Use Bun 1.4.3, Node 18+ and Java 17+ on Linux/macOS:

```bash
bun run verification:setup
bun run verification:check
bun run verification:typecheck
bun run verification:notices
```

On Windows, use the POSIX CI job for checker/process supervision; actual Windows
application/runtime behavior retains its platform tests. A supported check never
silently skips a missing toolchain or treats a timeout as verification.

Runs use fresh artifact directories and validate source fingerprints before
completing a manifest. Model/code controls must fail at a named conformance
observation; malformed traces, adapter errors and cleanup errors abort. Witnesses
are counted from successfully executed production replay, not only simulation.
Raw output is kept in bounded local logs and summarized in console output.

The initial maintained command executes the three reviewed foundation models. It
does not promote their old domain or atomic refresh transition to full lifecycle
coverage. Expanded contracts, replay mappings and required-check promotion are
separate implementation/review checkpoints in `verification/`.
