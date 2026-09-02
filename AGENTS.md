Use the agent's full capacity to deliver complete, coherent outcomes. Exercise judgment: choose the
smallest design that fully satisfies the actual requirements and known constraints. Do not reduce
scope because work would be expensive for a human, and do not add abstractions, process, future
proofing, or review requirements without a concrete need. Validate in proportion to risk, and keep
required correctness distinct from optional hardening. Simple means elegant and complete, not
minimal effort.

# Repository delivery workflow

- Never commit or push directly to `main`. Make all repository changes, including release preparation and fixes, on a branch and deliver them through a pull request. Do not run automation that pushes `main` directly; stop and use a PR-based workflow or ask for direction if the automation cannot do that.
- Treat opening the pull request as the delivery stopping point. Do not merge it unless the repository owner explicitly asks you to merge. Pull requests require independent review before merging unless the repository owner explicitly states that review is not required.

Specifications are decision aids, not a gate on ordinary engineering work.
Use one only when the repository owner asks for one or when a genuinely new
product/API contract needs an explicit decision. Upstream synchronization,
bug fixes, dependency refreshes, refactors, tests, documentation, and release
mechanics do not require new numbered specs.

Keep one current spec per coherent outcome. Do not create a new spec for every
implementation tranche, release candidate, review correction, or repository
move. If direction changes, update or supersede the current document in the
same PR; Git history is the audit trail. A short delivery note may record
important validation, but a paired summary is not mandatory.

# Agent Onboarding (Herdr World)

This is a lightweight internal onboarding note for agents working in this repo.

## Start Here

- Work from the `herdr-world/` repository root. The canonical local startup command is
  `npm run dev:local`; its full-app URL is `http://127.0.0.1:8787`. See
  [`docs/development.md`](docs/development.md) for the Herdr, bridge, Vite, and optional OTEL
  startup layers.
- Read `README.md` for the product shape, bridge runtime model, and local run commands.
- Read `web/README.md` before changing the React/Vite app.
- Read `docs/vendoring.md` before touching `vendor/herdr-compat/`.
- Read `docs/packaging.md` before changing desktop tarball or Android release artifact behavior.
- Read `docs/release.md` before changing release scripts or release checklists.
- Web source lives in `web/src/`.
- The repo-owned bridge implementation lives in `bridge/src/web_bridge.rs`.
- The minimal Herdr compatibility crate lives in `vendor/herdr-compat/`.
- Do not recreate a full `vendor/herdr/` upstream snapshot; use a separate Herdr checkout for
  refreshes and audits.

## Conventions

- Keep product changes scoped to the web app, bridge executable, and minimal compatibility crate
  unless the user explicitly asks for core Herdr changes.
- Prefer small pure helpers in `web/src/` for state, launch, and protocol formatting logic that can be unit tested.
- Keep bridge command exposure narrow. Browser commands should stay allow-listed and parameter-validated in `web_bridge.rs`.
- Keep generated outputs out of commits: `web/dist/`, `bridge/target/`, and
  `vendor/herdr-compat/target/`, `dist-packages/`, and Android build outputs.
- The bridge is local-first and currently has no full browser authentication. Treat LAN binding and upload behavior as security-sensitive.

## Privacy And Local Data

- Treat any environment-specific or user-specific data as sensitive by default.
- Never copy such data into tracked files, tests, fixtures, documentation, issues, PRs, commit
  messages, or generated artifacts. Keep real configuration outside the repository and use clearly
  synthetic placeholders or reserved example domains/ranges instead.
- Before committing or pushing, review the diff and relevant history for accidental disclosure. If
  sensitive data is staged or pushed, remove it from unmerged history when possible and report what
  was exposed and scrubbed; a follow-up deletion does not erase commit history.

## Testing

- Run `npm install --prefix web` if dependencies are missing.
- Run `npm run vendor:check` to verify the vendored layout.
- Run `npm run lint:web` for ESLint.
- Run `npm run test:web` for Vitest.
- Run `npm run build:web` for the frontend production build.
- Run `npm run bridge:test` for bridge unit tests when a Rust toolchain (cargo) is available.
- Run `npm run check` before committing or releasing.
- Install pinned `cargo-about` 0.9.2 and run `npm run notices:generate` whenever
  a production dependency graph changes. `npm run notices:check` is part of the
  normal repository check and must remain byte-clean.
- If cargo/Rust is missing, call out that bridge build/test verification could not run.

## Build And Packaging

- Development build: `npm run build` builds the web app and debug bridge binary.
- Android debug build: `npm run android:build:debug`; output is
  `android/app/build/outputs/apk/debug/app-debug.apk`.
- Desktop release tarball: `scripts/package-tarball.sh vX.Y.Z PLATFORM`; outputs go under
  `dist-packages/`.
- Build or provide `linux-x86_64` tarballs from Linux, `macos-arm64` tarballs from an Apple Silicon
  Mac, and `macos-x86_64` tarballs from an Intel Mac. Supplemental local build-service notes may
  describe the release operator's available build hosts, but the repo-owned packaging script remains
  the source of truth for tarball layout.
- Build final release artifacts from the final reviewed release commit/tag after
  `scripts/release.mjs tag` creates the immutable release tag. Inspect tarball/APK contents before
  upload.
- Desktop tarballs include `herdr-world-bridge`, bundled `web/dist` assets, the `herdr-world`
  wrapper, complete generated dependency licences, source/asset notices, and
  docs. They do not include Herdr itself. The development Cargo target remains
  `herdr-web-bridge` for upstream alignment.

## Changelog

- `CHANGELOG.md` records Herdr World release identities and downstream changes only. Do not copy or
  relabel Herdr Web release sections. Follow the release-lineage convention in `UPSTREAM.md`.
- Correlate every World release with the exact Herdr Web synchronization point from `UPSTREAM.md`.
  Use "derived from" for synchronized Web source, "compatible with" for the external Herdr runtime
  and protocol, and "depends on" only for an actual package or runtime dependency.
- Update the synchronization point before release preparation. The release helper inserts it into
  the World release section and release validation rejects a missing or stale correlation.
- Add user-facing changes to `CHANGELOG.md` under `## [Unreleased]`.
- Use these subsections when applicable: Breaking Changes, Added, Changed, Fixed, Removed.
- Add the needed subsection under `## [Unreleased]` if it is missing; do not create duplicate subsection headings.
- After opening a PR and before merging it, update each relevant changelog entry with the PR number
  or link.
- Include bridge compatibility and vendored Herdr refresh notes when protocol or overlay compatibility changes.
- When cutting a release, the release script removes empty unused subsections from the released
  version section; keep the fresh `## [Unreleased]` template headings intact.

## Release

- Create a clean release branch from current `origin/main` and ensure `CHANGELOG.md` has the release
  notes under `## [Unreleased]`.
- Run `node scripts/release.mjs prepare vX.Y.Z`. Review the generated release-reference and
  changelog diff, commit it as `Release vX.Y.Z`, and deliver it through an independently reviewed
  pull request.
- After that PR merges, synchronize a clean origin-only `main`, run the complete distribution
  preflight and browser smoke checklist in `docs/release.md`, then run
  `node scripts/release.mjs tag vX.Y.Z`.
- The tag command verifies the reviewed squash-merge commit and exact successful preflight, then
  pushes only the immutable release tag. It never commits or pushes `main`.
- The release workflow builds and uploads the desktop, npm, plugin, and Homebrew outputs. Android
  remains separate until a signed public APK exists. Do not commit `dist-packages/`, APKs, or
  generated Android outputs.
- Do not bump npm package versions until package publishing is defined.
