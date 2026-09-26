# Herdr World repository guidance

Deliver the simplest complete design that satisfies the real requirements. Do not
trade away correctness because a change would be expensive for a human, and do not
invent abstractions or process without a concrete need.

## Delivery workflow

- Never commit or push directly to `main`. Work on a branch and stop after opening a
  ready pull request unless the repository owner explicitly asks you to merge it.
- Pull requests require independent review unless the owner explicitly waives it.
- Put worktrees below the primary checkout's `.agents/worktrees/` directory. Create
  one with `bun run agent:worktree -- create <slug> <parent-ref>` after resolving the
  requested parent branch.
- Treat existing changes as the user's work. Preserve unrelated edits and never move
  or clean another agent's worktree.
- Specifications are decision aids, not a gate for ordinary fixes. Use an OpenSpec
  change when the owner asks for one or when a genuinely new product/API contract
  needs a decision. Update one coherent change when direction changes rather than
  creating a document per implementation tranche.

Read [docs/agent-development.md](docs/agent-development.md) for the working loop and
[docs/knowledge-map.md](docs/knowledge-map.md) to find contracts, source, tests and
runbooks. Current contracts are in `openspec/specs/`; active changes are in
`openspec/changes/`; numbered documents under `docs/specs/` are historical context.

## Product shape

Herdr World is one Bun service and same-origin React Web/PWA application. The service
owns isolated local and OpenSSH Herdr connections; the browser never connects to a
remote World bridge. Herdr remains an external runtime.

- Browser application: `web/src/`
- Browser RPC and focused runtime state: `web/src/api.ts`, `web/src/store.ts`
- Aggregate World store and views: `web/src/world/`
- Bun service: `server/src/`
- Connection/runtime ownership: `server/src/connections/`, `server/src/bridge/`
- Aggregate topology: `server/src/world/snapshot.ts`
- Installer, plugin and release tooling: `scripts/`, `herdr-plugin.toml`

Before changing behavior, read `README.md`, the relevant knowledge-map row and the
local package/source tests. Read `docs/packaging.md` or `docs/release.md` before
changing distribution behavior.

## Engineering boundaries

- Keep downstream Herdr operations qualified by immutable connection ID and runtime
  generation. Never fall back to another connection.
- Aggregate World observation is bounded and read-only. Cached failed-host topology
  is stale and non-actionable.
- Keep the browser on the one World origin. Do not reintroduce the retired bridge
  Host, Origin or cross-origin CSP configuration.
- SSH profiles accept an OpenSSH alias or `user@host`; SSH policy belongs in the
  service user's OpenSSH configuration. Never persist passwords, private keys,
  passphrases or arbitrary SSH options.
- The service is local-first and trusted-single-user. LAN binding, authentication,
  uploads, shell/terminal operations and update installation are security-sensitive.
- Keep generated outputs out of commits: `web/dist/`, `server/public/`, compiled
  binaries, `.pages-dist/` and `dist/`.

## Privacy

Treat environment- and user-specific data as sensitive. Never copy real hosts,
usernames, paths, socket names, keys, tokens, sessions or repository contents into
tracked files, tests, docs, issues, PRs or commits. Use reserved example domains and
synthetic data. Inspect the final diff and relevant history before pushing.

## Commands

Install the pinned toolchain dependencies with:

```bash
bun install --frozen-lockfile
```

Run relevant focused tests after a coherent change and before opening a PR. Run a
targeted test earlier when diagnosing a failure, but do not repeat type checks and
tests after each edit or commit. Run a repository-wide quick type check after
affected interfaces are integrated, or sooner to diagnose a type failure. CI runs
`bun run check` on the PR head; use that as the final gate rather than repeating it
locally by default. Run it locally when CI cannot cover the candidate or to
investigate a failure. The full gate covers notices, formatting, lint, type checking,
all tests, production builds and strict OpenSpec validation. Browser tests require
Chrome/Chromium or `CHROME_BIN`:

```bash
bun run typecheck:quick
bun test <path>
bun run test:browser
```

Let the tracked pre-commit hook check formatting and lint at commit time. In an
agent worktree without installed hooks, commit with
`git -c core.hooksPath=.githooks commit` so those checks run without changing shared
Git configuration.

Run `bun run notices:generate` whenever the resolved dependency graph changes and
commit the byte-stable `DEPENDENCY_NOTICES.md`. Use `bun run build:site` after site or
tutorial changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full matrix.

## Changelog and releases

- Add user-facing changes under the appropriate `CHANGELOG.md` Unreleased heading.
- After opening a PR and before merge, add its number/link to the relevant entries.
- Record the exact Roamgate source synchronization in `UPSTREAM.md`; say "derived
  from" for source and "compatible with" for the external Herdr runtime.
- Release preparation happens on a clean branch from `origin/main` and is delivered
  through a reviewed PR. Tags and release artifacts are created only from the merged,
  verified release commit. See [docs/release.md](docs/release.md).
