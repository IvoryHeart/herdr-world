# Contributing

Herdr World is an independent downstream application. Contributions are
welcome when they improve its existing terminal, federation, World surface,
observability, packaging, or maintenance workflows.

## Before You Start

- Search the existing issues and pull requests first.
- Open an issue before a large new visualization, integration, protocol change,
  or architectural redesign so the intended scope can be agreed early.
- Small fixes, tests, documentation improvements, and dependency maintenance
  can go directly to a pull request.

Generic changes that could also benefit Herdr Web may be implemented here.
Herdr World maintainers can separately propose a focused upstream patch;
contributors do not need upstream approval or coordination before helping this
project.

## Source Boundaries

- Keep World presentation and behavior under `web/src/world/` and World assets
  under `web/public/world/` where practical.
- Keep generic Herdr Web-aligned changes close to their upstream paths.
- Keep the bridge allow-list narrow and preserve one bridge manager, one runtime
  cache, and one terminal-session owner.
- Read `docs/vendoring.md` before changing `vendor/herdr-compat/`.
- Do not add credentials, private machine paths, generated build output, or
  untracked third-party assets.

The current boundary and upstream-sync contract is documented in
`docs/specs/004-world-packaging-and-upstream-boundaries-spec.md`.

## Pull Requests

- Keep one pull request focused on one coherent concern.
- Explain the problem, the chosen approach, and any user-visible trade-offs.
- Add or update proportionate tests.
- Add user-visible changes to `CHANGELOG.md` under `Unreleased`.
- Preserve applicable attribution and update `THIRD_PARTY_NOTICES.md` or the
  relevant provenance manifest when adding third-party material.
- Run `npm run check`; use `npm run check:acceptance` when browser behavior or
  runtime integration changes.

Contributions are submitted under the repository's MIT license unless a file
or directory carries an explicit third-party license notice.
