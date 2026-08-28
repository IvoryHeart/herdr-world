# Herdr World distribution release contract

- **Spec ID:** `017-herdr-world-npm-homebrew-distribution`
- **Status:** Draft
- **Created:** 2026-08-28
- **Owner:** IvoryHeart
- **Reviewers:** —
- **Approved by:** —
- **Approved at:** —

This specification defines the npm and Homebrew distribution contract for
Herdr World. It is related to, but independent from, [Spec 016](016-herdr-world-plugin-release-spec.md).
It describes the release outcome and boundaries; implementation details belong
in the packaging and release documentation.

## 1. Goal

For every final release tag, one release pipeline SHALL build or consume the
verified release outputs and publish that release to the supported distribution
channels. The normal path SHALL be the same for `vX.Y.Z`, prereleases, and
future releases; the current `v0.1.0-rc.1` is only a test fixture, not a
permanent version or special-case workflow.

The initial channels are:

- the public universal npm package `@ivoryheart/herdr-world`; and
- the stable third-party Homebrew Cask in `IvoryHeart/homebrew-tap`.

The release design SHALL make additional channels an adapter to the same
release version and verified release record. Where a channel can reuse the
verified outputs, it SHALL do so rather than creating another native build or
release procedure.

## 2. Scope and boundaries

The existing verified desktop archives are the native source of truth. The npm
package SHALL contain the shared application payload, documentation, legal
material, and all three supported desktop bridges. The Cask SHALL reference the
immutable desktop archives and their checksums.

Neither channel SHALL build a second native bridge, download release assets at
install time, start Herdr, create a workspace, or change plugin state. Desktop
archives and Android packaging remain independent outputs.

The supported operating systems, architectures, libc baseline, launcher
behavior, legal closure, and security defaults remain those established by
[packaging documentation](../packaging.md) and [release documentation](../release.md).
This specification does not duplicate platform implementation details.

Spec 016 remains the owner of plugin installation, plugin-managed lifecycle,
and source-build behavior. The npm package and Cask SHALL not be discovered or
used implicitly by the plugin. A future plugin mode that consumes an external
distribution requires an explicit change to the plugin contract.

## 3. Release contract

The final release tag SHALL be the version source for every channel. A release
pipeline SHALL:

1. build the native archives from the final release;
2. verify archive contents, legal closure, native formats, checksums, and the
   existing live smoke;
3. make the verified outputs available to the channel adapters;
4. publish the npm package and, for an eligible stable release, update the
   Homebrew Cask from those same outputs; and
5. invoke any additional enabled distribution adapters using the same release
   version and verified release record, subject to that channel's owning
   contract.

The pipeline SHALL run publication only for an intentional release tag or
release event. Ordinary branches and pull requests SHALL not publish.

Each adapter SHALL report success or failure against the release version. A
retry SHALL be safe: if the exact version and contents already exist, the
adapter MAY no-op; an existing version with different contents SHALL not be
replaced and SHALL require a new release version.

Adding a distribution channel SHALL require only its packaging metadata,
publication credentials, validation, and adapter in the release pipeline. It
MUST NOT require changes to native archive production or to existing channels.

## 4. npm distribution

The npm channel SHALL publish one public package, `@ivoryheart/herdr-world`.
It SHALL:

- use the release-tag version;
- contain all three native bridges plus the shared launcher, web assets,
  documentation, and complete legal material;
- expose only the `herdr-world` command;
- select the fixed bridge for the running supported target; and
- contain no install-time downloader or second native build.

Prereleases SHALL use the prerelease channel and SHALL not update the stable
Homebrew Cask. Stable releases SHALL use the stable npm channel and continue
through the same release pipeline.

The npm package SHALL be generated, packed, inspected, install-tested, and
hashed before publication. The published package SHALL be the exact package
that passed those checks. The npm scope and publication credentials are release
setup prerequisites, not per-release manual work.

Platform-specific npm packages, staged publication, and a separate npm
publication state machine are not part of the initial design.

## 5. Homebrew distribution

The Homebrew channel SHALL be one stable-only binary Cask in the public
third-party tap `IvoryHeart/homebrew-tap`, installed with:

```bash
brew install --cask IvoryHeart/tap/herdr-world
```

For an eligible stable release, CI SHALL generate and validate the Cask update
from the release version, immutable archive URLs, and checksums, then write that
update to the tap as part of the same release. There SHALL be no separate
Homebrew binary upload. The Cask SHALL expose only `herdr-world` and SHALL not
start a process or mutate a workspace during installation.

The ordinary Cask SHALL remain stable-only. A prerelease Cask, if ever needed,
requires a separately named channel. Source-building and binary formulas are
deferred.

## 6. Validation and acceptance

The implementation SHALL demonstrate:

- a release tag produces matching versions across all published channels;
- npm and Homebrew consume the verified desktop outputs without rebuilding a
  bridge;
- the universal npm package contains the intended bridges, shared payload, and
  legal closure;
- npm and Cask install, upgrade, reinstall, invoke, and uninstall correctly on
  every supported target;
- unsupported targets fail clearly and installation has no Herdr, bridge,
  workspace, or daemon side effects;
- prereleases do not update the stable Cask;
- a retry does not replace an existing published version or silently mutate
  release contents; and
- adding a future adapter does not change existing archive or channel output.

The release checks SHALL use versioned test fixtures. No acceptance requirement
SHALL depend on `v0.1.0-rc.1` being the release version.

## 7. Deferred work

- npm platform-package splitting;
- staged npm publication or a publication database;
- install-time downloaders, Cask wrappers, service supervisors, and formulas;
- additional operating systems, architectures, or libc implementations;
- a prerelease Homebrew channel; and
- plugin reuse of an external package-manager installation.

## 8. References

- [Distribution analysis](../analysis/npm-homebrew-distribution-analysis-2026-08-28.md)
- [Spec 016](016-herdr-world-plugin-release-spec.md)
- [Packaging documentation](../packaging.md)
- [Release documentation](../release.md)
- [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew taps](https://docs.brew.sh/Taps)
