# Changelog fragments

Each pull request with a user-facing change adds one file here instead of
editing `CHANGELOG.md`. Name it after the PR number or a short slug, such as
`changes/262.md` or `changes/town-peek-chat.md` (lower-case letters, digits and
hyphens). Include it in the implementation commit before the first push; do not
amend or push solely to rename it after a PR number is assigned.

A fragment has one or more headings, each followed by `- ` bullets. Each bullet
must be one physical line, at most **280 Unicode characters** excluding `- `
and surrounding whitespace (Markdown markup and link URLs count). Write one
short, user-facing change per bullet; do not wrap it or add nested bullets.
Keep technical context only if readers need it.

Optional longer text goes after `<!-- detail -->` at the end of a heading's
summary bullets. It may contain paragraphs, lists and indented continuation
lines without a length limit. A new `###` heading starts another summary
section; each section may have one nonempty detail part:

```markdown
### Fixed

- Keep the Town peek open when the agent's status changes.

<!-- detail -->

The peek now follows the selected agent across status updates, keeping the
reader's place in its history. This explanation appears only in the full
changelog.
```

Allowed headings: `### Breaking Changes`, `### Added`, `### Changed`,
`### Removed`, `### Fixed`, `### Documentation` and `### Known issues`. Each
heading may appear once per fragment. `bun run changelog:check` validates every
fragment, naming the file, line, character count and limit for an overlong
summary; `check`, `check:docs` and `check:changed` run it.

CI requires a fragment from every PR that changes more than ordinary
documentation (the same rule that selects the documentation-only CI mode). A
change with nothing user-facing, such as tests, CI or contributor tooling,
instead states why in its PR description:

```text
Changelog: none — <specific reason>
```

A fragment with `### Added` adds something users can find, so the PR also
declares its help in a `*.help.ts` file beside the feature (see
[docs/HELP.md](../docs/HELP.md) and `web/src/help/helpEntry.ts`), or states why
it needs none:

```text
Help: none — <specific reason>
```

Stable release preparation (`bun run release:prepare`) appends only the short
bullets to `CHANGELOG.md`, grouped by heading and ordered by file name, and
writes all summaries and detail to `docs/changelog/vX.Y.Z.md`. The short section
links to the full changelog, which links back to all releases. Both files are
written before fragments are deleted. Full changelogs are distinct from the
reviewed publication notes in `docs/releases/`.

`bun run changelog:assemble X.Y.Z` does the same assembly into Unreleased on its
own, without promoting it to a dated release. Supply the intended stable version;
an existing full changelog is never overwritten. A second run with no remaining
fragments changes nothing. To inspect both outputs without writing files or
deleting fragments, run `bun run changelog:assemble X.Y.Z --dry-run`.
Release candidates leave fragments and both changelogs in place.
