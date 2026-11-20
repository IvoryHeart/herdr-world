# Changelog fragments

Each pull request with a user-facing change adds one file here instead of
editing `CHANGELOG.md`. Name it after the PR number or a short slug, such as
`changes/262.md` or `changes/town-peek-chat.md` (lower-case letters, digits and
hyphens). Include it in the implementation commit before the first push; do not
amend or push solely to rename it after a PR number is assigned.

A fragment has one or more headings, each followed by `- ` bullets. Indent
continuation lines by two spaces:

```markdown
### Fixed

- Keep the Town peek open when the agent's status changes.
```

Allowed headings: `### Breaking Changes`, `### Added`, `### Changed`,
`### Removed`, `### Fixed`, `### Documentation` and `### Known issues`. Each
heading may appear once per fragment. `bun run changelog:check` validates every
fragment; `check`, `check:docs` and `check:changed` run it.

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

Stable release preparation (`bun run release:prepare`) appends the fragments to
the Unreleased section of `CHANGELOG.md`, grouped by heading and ordered by file
name, then deletes them. `bun run changelog:assemble` does the same step on its
own. Release candidates leave the fragments in place.
