# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

1. Create a clean release branch from current `origin/main` and ensure the Unreleased
   changelog accurately describes user-visible changes and the current source lineage.
   Prepare a concise, reviewed `docs/releases/vX.Y.Z.md` covering upgrade steps,
   distribution changes and important limits; the Release workflow uses it as the
   public release body.
2. Run `bun install --frozen-lockfile`, `bun run notices:generate` when needed and
   `bun run check`.
3. Run `bun run release:prepare -- X.Y.Z` (or `patch`, `minor`, `major`). Review the
   public plugin version and dated changelog promotion, then open a ready release PR.
   If publication moves to another UTC date, update and review the date in that PR.
   Private root, web and
   server manifests remain at `0.0.0`; tagged builds inject the reviewed release
   version into binaries, archives and update metadata.
4. After independent review and merge, dispatch **Publish Release** with the exact
   `X.Y.Z`. The workflow locates the merged release commit, creates an annotated tag
   if needed and starts **Release** on that immutable tag.
5. The Release workflow revalidates metadata/tests, builds all six platform archives,
   checks their contents and formats, and stages npm packages and a Homebrew Formula
   from those exact archives. It publishes archives, checksums, update manifests and
   `install-herdr-world.sh` as the GitHub Latest release, then publishes the six npm
   platform packages followed by `@ivoryheart/herdr-world`. It opens a ready PR in
   `IvoryHeart/homebrew-tap` with the checksum-pinned Formula; merge that PR after
   independent review.
6. Verify the installer, npm installation with optional dependencies, Homebrew
   installation after the tap PR merges, Herdr plugin download/start/status/url flow,
   and project-site release probe against the published assets.

Before dispatching Publish Release, bootstrap the six new platform package names
once. npm requires a package to exist before its trusted publisher can be set.
Run `bun scripts/stage-npm-bootstrap.ts`, review the six generated manifests under
ignored `dist/npm-bootstrap/`, then publish each directory with `npm publish
dist/npm-bootstrap/<platform> --access public --tag bootstrap` using the npm
maintainer account and interactive 2FA. The bootstrap versions contain no binary
and never become the `latest` dist-tag. Configure `release.yml` as an npm trusted
publisher with direct publish permission for all six names and the existing
`@ivoryheart/herdr-world` package. The release workflow then uses GitHub Actions
OIDC without an npm token. The platform names are
`@ivoryheart/herdr-world-{linux,darwin,windows}-{x64,arm64}`.
The existing `HOMEBREW_TAP_TOKEN` must have permission to push a branch and open a PR
in `IvoryHeart/homebrew-tap`. A failed downstream publish can be rerun for the same
tag: npm skips byte-identical versions and rejects changed content.

Do not retag a release or build final artifacts from an unreviewed worktree. If a
published artifact is wrong, prepare a new version. PWA/site deployment runs from
`main` and requires a valid published Latest release.
