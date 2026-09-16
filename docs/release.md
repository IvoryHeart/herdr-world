# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

1. Create a clean release branch from current `origin/main` and ensure the Unreleased
   changelog accurately describes user-visible changes and the current source lineage.
2. Run `bun install --frozen-lockfile`, `bun run notices:generate` when needed and
   `bun run check`.
3. Run `bun run release:prepare -- X.Y.Z` (or `patch`, `minor`, `major`). Review the
   public plugin version change, then open a ready release PR. Private root, web and
   server manifests remain at `0.0.0`; tagged builds inject the reviewed release
   version into binaries, archives and update metadata.
4. After independent review and merge, dispatch **Publish Release** with the exact
   `X.Y.Z`. The workflow locates the merged release commit, creates an annotated tag
   if needed and starts **Release** on that immutable tag.
5. The Release workflow revalidates metadata/tests, builds all six platform archives,
   checks their contents and formats, and publishes archives, checksums, update
   manifests and `install-herdr-world.sh` as the GitHub Latest release.
6. Verify the installer, Herdr plugin download/start/status/url flow and project-site
   release probe against the published assets.

Do not retag a release or build final artifacts from an unreviewed worktree. If a
published artifact is wrong, prepare a new version. PWA/site deployment runs from
`main` and requires a valid published Latest release.
