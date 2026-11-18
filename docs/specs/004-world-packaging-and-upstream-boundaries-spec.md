# Herdr World independence and upstream synchronization

- **Spec ID:** `004-world-packaging-and-upstream-boundaries`
- **Status:** Approved
- **Created:** 2026-08-10
- **Rewritten:** 2026-08-26
- **Owner:** IvoryHeart / Herdr World
- **Approved by:** IvoryHeart
- **Supersedes:** the previous drafts of Specs 004, 010, and 011

## Purpose

Herdr World is an independent downstream application that follows Herdr and
Herdr Web while keeping World-specific work separate. This is the complete
repository-boundary and upstream-sync contract.

## Projects

| Project | Owns | Herdr World relationship |
| --- | --- | --- |
| [`herdrdev/herdr`](https://github.com/herdrdev/herdr) | Runtime, daemon, API, terminal protocol, and runtime plugins | Runtime upstream. |
| [`kcosr/herdr-web`](https://github.com/kcosr/herdr-web) | Generic browser UI and bridge | Git upstream. |
| [`IvoryHeart/herdr-world`](https://github.com/IvoryHeart/herdr-world) | World product, visualizations, integrations, assets, and distribution | Independent downstream monorepo. |

Each upstream builds and releases independently. Herdr World builds from its
own checkout and connects to a compatible Herdr daemon at runtime.

## Simple source separation

Keep files that are useful to Herdr Web close to their upstream paths. Keep
World-owned implementation in clearly named locations:

```text
web/src/world/              World surfaces and presentation
web/public/world/           World assets
bridge/src/observability*   World observability provider and contract
docs/world-assets.md        World asset attribution
docs/observability.md       World observability operation
```

The shared application and bridge need a few integration seams for registering
the `/world` route, passing existing runtime services to it, and mounting
World-owned bridge routes. Those seams should remain small. When related code
is edited, move World logic into the World-owned files instead of expanding
shared upstream files. This is incremental cleanup, not a separate package or
framework project.

There is one application, one bridge manager, one runtime cache, and one
terminal-session owner. `/` serves Spaces and `/world` serves World.

## Updating from Herdr Web

Configure `kcosr/herdr-web` as the `upstream` Git remote. The normal update is:

```bash
git fetch upstream
git merge upstream/main
```

Git commits and merge ancestry are the source of truth. `UPSTREAM.md` keeps
only the upstream locations and latest synchronized revisions; it is not an
adoption log.

During a merge:

1. accept upstream changes in upstream-aligned files;
2. retain World files and the small integration seams;
3. resolve genuine overlaps directly;
4. run the repository tests; and
5. update the single current synchronization pointer.

Do not replay a change that is already present. Do not copy upstream release
bookkeeping or product wording that does not apply to Herdr World.

## Updating for Herdr

Herdr protocol/API updates use a released Herdr version. Refresh only the
bridge-required compatibility slice, retain its Apache-2.0 source and license
records, and run its protocol fixtures. Reject unsupported terminal protocols
with a clear compatibility message.

## World work and upstream contributions

Office, future visualizations, observability, branding, assets, and external
service integrations belong to Herdr World.

A generic fix that is useful to Herdr Web may be proposed as a focused patch
against current `kcosr/herdr-web` main. Upstream review does not block the
Herdr World implementation or release.

Runtime actions may use Herdr's existing plugin/API model. Browser
visualizations and service integrations remain ordinary World code unless a
concrete feature later needs a different design.

## Open-source attribution

Retain the repository license and the license/notices required by source and
assets actually shipped. The Herdr compatibility manifest records vendored
Herdr source. World asset documentation records copied or adapted assets.
Git history records changes taken from Herdr Web.

## Acceptance

The boundary is working when:

- a clean Herdr World checkout installs, tests, and builds by itself;
- one Herdr daemon and one World bridge serve working Spaces and World views;
- `upstream/main` can be merged through ordinary Git;
- most World changes stay inside the World-owned paths above;
- the shared integration diff stays reviewable; and
- `npm run check:acceptance` passes before live activation.
