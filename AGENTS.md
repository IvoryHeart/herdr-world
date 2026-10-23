# Herdr World repository guidance

Deliver the simplest complete design that satisfies the real requirements. Do not
trade away correctness because a change would be expensive for a human, and do not
invent abstractions or process without a concrete need.

## Delivery workflow

- Never commit or push directly to `main`. Work on a branch. For PR delivery,
  stop after opening a ready pull request unless the repository owner explicitly
  asks you to merge it. A local-only handoff does not require a PR.
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

Use [the knowledge map](docs/knowledge-map.md) when locating contracts, source,
tests or runbooks. Read [agent development](docs/agent-development.md) for
agent-workflow changes or process investigations. Current contracts are in
`openspec/specs/`; active changes are in `openspec/changes/`; numbered
documents under `docs/specs/` are historical context. For multi-step handoffs
and review repairs, invoke the repo-local
[candidate-delivery skill](.agents/skills/candidate-delivery/SKILL.md).
For an optional visible two-agent run, use the
[Herdr Workflows recipe](docs/agent-development.md#run-an-optional-visible-team).

## Documentation maintenance

Every significant product, API, configuration, installation or workflow change
must update the relevant current documentation in the same change. Use the
knowledge map to identify affected guides. Update `docs/TUTORIAL.md` and
`FEATURES.md` when user steps or controls change, `README.md` for first-run
changes, and deployment, architecture or contributor guidance as applicable.
Tutorial text has one source: `docs/TUTORIAL.md`; run `bun run build:site` for
tutorial or site changes. Keep historical evidence historical. In the handoff,
name the updated docs or explain concretely why existing guidance remains
accurate; a changelog entry alone does not replace usage documentation.

## Behavioral verification

Assess changed contracts against `verification/coverage.json`. Use maintained
Quint models for ordering, ownership, authority and recovery when exploration
adds useful evidence; justify direct exhaustive, browser or platform alternatives.
Derive properties from requirements and allowed/forbidden scenarios before mapping
implementation. Update relevant contracts, adapters, consumer tests and evidence.
Mechanical edits require a no-contract-impact explanation, not a new model.
Run complete required verification for model/contract/adapter/tooling/consumer
changes; focused `--case` checks do not replace it. Bounded contracts and consumer
mappings have independent promotion acceptance. Pre-push runs `check:changed`
(the full verification gate when verification inputs or contract owners change);
behavioral verification is a required protected `Delivery checks` dependency.
Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
See `verification/README.md` and CONTRIBUTING.md for current boundaries.

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

Use focused tests and type checks when they answer a specific question. The
pre-commit hook checks formatting and lint without writing files; the pre-push
hook runs `bun run check:changed` for code changes: static checks, the affected
unit tests and nearest World browser suites, and the unfiltered verification
gate when its inputs change. CI runs the full gate; `bun run check:delivery` runs
it locally in parallel lanes. A Markdown-only follow-up uses `bun run check:docs`
only when a passed code gate already covers its code, and a push that only merges
`origin/main` (no edits beyond changelog fragments) runs `bun run check:static`.
Heavy checks from every worktree share one machine-wide queue (one browser lane and
one verification at a time); a queued gate prints whom it waits for, so wait rather
than bypass the hook.
CI runs documentation checks for Markdown-only PR diffs and full checks for code
changes. Browser tests require Chrome/Chromium or `CHROME_BIN`:

```bash
bun run typecheck:quick
bun run test <path>
bun run test:browser
```

Run `bun run install-hooks` once per clone so the tracked pre-commit hook checks
formatting and lint at commit time and the pre-push hook runs the applicable check. All
worktrees in that clone share the hook configuration.

Run `bun run notices:generate` whenever the resolved dependency graph changes and
commit the byte-stable `DEPENDENCY_NOTICES.md`. Use `bun run build:site` after site or
tutorial changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full matrix.

## Agentic efficiency

- **Block on running commands.** When a command returns a running session, call
  `write_stdin` on that session with empty `chars` and `yield_time_ms: 300000`;
  wait again only if it actually times out and remains running. Apply the same
  rule to `gh run watch`. Do not issue 30-second status loops or separate
  `ps`/`gh pr checks` probes while the blocking command is running. A Codex
  lifecycle hook cannot intercept `write_stdin`, so do not add one for polling.
- **One review, one fix pass.** Do not create re-review branches. Fix findings
  in place and move on. If a PR has too many findings, split the PR first.
- **Functional commits only.** Every commit should change behaviour or docs. Put
  verification records in the PR; do not create a commit or amend and push only
  to add metadata.
- **Read once, then act.** Do not re-read files already in context unless they
  were modified by another process.

## Tool output discipline

Every byte of tool output enters your context and stays until compaction.
Large outputs are the primary driver of context bloat and token cost.

- **Bound check output.** `bun run check` runs 8 stages and produces ~600K
  chars. Pipe through `tail -80` and read the exit code. `check:delivery` and
  `check:changed` keep each lane's log in `.agents/delivery/lanes/`. On failure, run only
  the failing stage (`tsc --noEmit 2>&1 | head -50`, `oxlint . 2>&1 | head -50`)
  to get actionable errors.
- **Do not dump full typecheck.** `tsc --noEmit` on this repo produces 200K+
  tokens of output when there are errors. Always pipe through `head -50`.
- **Search (rg/grep):** Always use `--max-count 5` and `--max-columns 200`.
  Scope to specific directories or file globs — never search the whole repo
  without limits.
- **File reads:** Use `sed -n 'start,endp'` for specific ranges. Do not
  `cat` entire files. If you need an overview, use `wc -l` then read the
  relevant section.
- **Git diffs:** Use `git diff --stat` first. Then targeted diffs on
  specific files with default context (not `--unified=100`).
- **General rule:** If a command might produce >200 lines of output, pipe
  it through `head -100` or `tail -100`. You can always re-run with
  different bounds if you need more.

## Changelog and releases

- Do not edit `CHANGELOG.md` for a change. Add a user-facing change as a fragment,
  `changes/<pr-number-or-slug>.md`, in the implementation commit, before the first
  push; [changes/README.md](changes/README.md) gives the format. CI requires a
  fragment from every PR that is not documentation-only; a change with nothing
  user-facing instead states `Changelog: none — <specific reason>` in its PR
  description. PR numbers and links are optional in entries. Prepare the final PR
  description before creation; it does not need to link to itself. Do not amend or
  push solely to rename a fragment after the PR number, or edit the PR body solely
  for later usage accounting; retain later usage in the workflow output.
- Record the exact Roamgate source synchronization in `UPSTREAM.md`; say "derived
  from" for source and "compatible with" for the external Herdr runtime.
- Release preparation happens on a clean branch from `origin/main` and is delivered
  through a reviewed PR. Tags and release artifacts are created only from the merged,
  verified release commit. See [docs/release.md](docs/release.md).
