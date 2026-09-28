# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

1. Create a clean release branch from current `origin/main` and ensure the Unreleased
   changelog accurately describes user-visible changes and the current source lineage.
   Prepare a concise, reviewed `docs/releases/vX.Y.Z.md` or
   `docs/releases/vX.Y.Z-rc.N.md` covering upgrade steps,
   distribution changes and important limits; the Release workflow uses it as the
   public release body.
2. Run `bun install --frozen-lockfile`, `bun run notices:generate` when needed and
   `bun run check`.
3. Run `bun run release:prepare -- X.Y.Z-rc.N` for each candidate, starting with
   `0.2.0-rc.1`, or `bun run release:prepare -- X.Y.Z` (or `patch`, `minor`, `major`)
   for stable. Review the public plugin version and release notes, then open a ready
   release PR. RCs leave the Unreleased changelog open; stable preparation promotes
   it into a dated release section. The helper drafts later RC notes from the stable
   notes when no exact RC notes exist; review and edit that draft in the PR.
   If stable publication moves to another UTC date, update and review the date in that PR.
   Private root, web and
   server manifests remain at `0.0.0`; tagged builds inject the reviewed release
   version into binaries, archives and update metadata.
4. After independent review and merge, dispatch **Publish Release** with the exact
   `X.Y.Z[-rc.N]`. The workflow locates the merged release commit, creates an annotated tag
   if needed and starts **Release** on that immutable tag.
5. The Release workflow revalidates metadata/tests, builds all six platform archives,
   checks their contents and formats, and stages npm packages and a Homebrew Formula
   from those exact archives. It publishes archives, checksums, update manifests and
   `install-herdr-world.sh` as a GitHub release, then publishes the six npm platform
   packages followed by `@ivoryheart/herdr-world`. RCs use GitHub prerelease status,
   npm's `next` tag and the `herdr-world-rc` Formula. Stable releases become GitHub
   Latest, use npm's `latest` tag and update the `herdr-world` Formula. The workflow
   opens a ready PR in `IvoryHeart/homebrew-tap`; merge it after independent review.
6. Verify the installer, npm installation with optional dependencies, Homebrew
   installation after the tap PR merges, and Herdr plugin download/start/status/url
   flow against the published assets. For stable releases, also verify the project-site
   Latest release probe.

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
published RC artifact is wrong, prepare `X.Y.Z-rc.(N+1)` on a new reviewed release
commit. Prepare the stable `X.Y.Z` only after testing the candidate across the
supported platforms. PWA/site deployment runs from `main` and requires a valid
published Latest release.
