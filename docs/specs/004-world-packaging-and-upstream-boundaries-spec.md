# Herdr World independence and upstream synchronization

- **Spec ID:** `004-world-packaging-and-upstream-boundaries`
- **Status:** Approved
- **Created:** 2026-08-10
- **Rewritten:** 2026-08-25
- **Owner:** IvoryHeart / Herdr World
- **Approved by:** IvoryHeart
- **Approved at:** 2026-08-25
- **Supersedes:** the previous drafts of Specs 004, 010, and 011

## Purpose

Herdr World is one straightforward downstream product, not a framework split
across release-candidate packages. It must remain usable and independently
releasable while following changes from Herdr and Herdr Web. This document is
the single contract for that relationship.

## Repository model

| Project | Responsibility | Relationship to Herdr World |
| --- | --- | --- |
| [`herdrdev/herdr`](https://github.com/herdrdev/herdr) | Runtime, daemon, socket/API, terminal protocol, and runtime plugins | External upstream dependency. Herdr builds and runs without either web project. |
| [`kcosr/herdr-web`](https://github.com/kcosr/herdr-web) | Independent generic browser UI and bridge upstream | Git upstream. It builds and releases without World code. |
| [`IvoryHeart/herdr-world`](https://github.com/IvoryHeart/herdr-world) | Spaces plus World visualizations, downstream integrations, assets, and distribution | Independent downstream monorepo derived from Herdr Web. It consumes a compatible Herdr daemon and periodically reconciles Herdr Web changes. |

Herdr World contains its browser app, bridge, narrowly vendored Herdr
compatibility slice, World surfaces, tests, and packaging in one repository.
It does not require `herdr-web`, `herdr-world-foundation`, or any other sibling
checkout at build or runtime.

The current logical boundaries are intentionally simple:

```text
bridge/                 browser-to-Herdr bridge; kept close to Herdr Web
vendor/herdr-compat/    traced compatibility slice from Herdr
web/src/                shared Spaces/browser implementation
web/src/world/          World-only surfaces, projection, and integrations
web/public/world/       World-only shipped assets
scripts/                one repository's development, test, and release tools
```

Directories may be improved when a real maintenance problem justifies it.
They are not required to become separately versioned packages.

## Requirements

### 1. Keep all three projects independently operable

- Herdr World SHALL use Herdr through a reviewed released protocol/API
  compatibility boundary and SHALL NOT require changes in a user's Herdr
  checkout.
- Herdr Web SHALL remain an external upstream; Herdr World SHALL NOT require a
  custom Herdr Web build, token, package, or service.
- Herdr World SHALL build and test from a clean checkout with its declared
  dependencies only.
- The assembled application SHALL have one bridge-profile owner, one runtime
  cache, and one terminal-session owner. `/` serves Spaces and `/world` serves
  the World visualization within the same application.

### 2. Synchronize Herdr Web as an ordinary downstream

The repository SHALL keep this remote relationship:

```text
origin    git@github.com:IvoryHeart/herdr-world.git
upstream  git@github.com:kcosr/herdr-web.git
```

For each meaningful upstream release or group of commits:

1. fetch `upstream` and record the exact commit or tag in `UPSTREAM.md`;
2. compare behavior and files against the current World tree;
3. merge or cherry-pick missing compatible changes, resolving overlaps in
   favor of preserving both upstream behavior and intentional World behavior;
4. do not duplicate a change that World already implements;
5. record intentionally excluded changes briefly; and
6. run the normal repository checks before updating the live installation.

A reconciliation merge MAY use a concern-based implementation followed by a
merge commit that records the audited upstream head as a parent. It MUST NOT
silently claim unreviewed upstream behavior was adopted.

World-specific code SHOULD stay outside upstream-aligned files where practical,
but reducing merge conflicts is an engineering preference, not a mandate to
invent packages or public APIs.

### 3. Track Herdr compatibility explicitly

Herdr protocol/API updates SHALL name the upstream Herdr release and commit,
update the minimal vendored slice, preserve its Apache-2.0 provenance, and test
the wire behavior. A current Herdr release is the compatibility target; Herdr
`master` may be audited but is not an implicit runtime requirement.

Herdr World SHALL fail clearly on an unsupported terminal protocol or bridge
compatibility version rather than maintaining speculative adapters.

### 4. Keep downstream features downstream by default

Office, future World visualizations, World branding and art, observability,
and future integrations such as GitHub, CI/CD, Vercel, or Supabase belong in
Herdr World unless a focused piece is useful to Herdr Web without World.

Use the existing mechanism that fits the job:

- Herdr plugin/API for runtime actions and daemon-owned behavior;
- Herdr Web bridge capability for browser-safe host behavior;
- compiled World surface or World-owned adapter for visualization and external
  service data.

Do not create a second plugin registry, provider marketplace, dynamic browser
loader, bridge manager, or terminal owner without an approved concrete need.
Observability is a valid World feature; it does not need to become a generic
Foundation provider system.

### 5. Let upstream contribution help without blocking World

Generic fixes MAY be proposed upstream. Prepare them as focused commits or a
fresh branch against the current upstream target, excluding World art,
branding, providers, and unrelated changes.

An upstream discussion, review delay, rejection, or release schedule SHALL NOT
block Herdr World. The compatible downstream implementation may ship first and
be reconciled if upstream later accepts a different form.

### 6. Keep open-source attribution practical and explicit

Herdr World SHALL retain the root license and the license/notices required by
source and assets it actually distributes. `UPSTREAM.md` SHALL identify the
Herdr Web baseline and adopted upstream changes. Vendored Herdr source and
copied/adapted assets SHALL retain their source, revision, license, and
modification record where applicable.

No personal legal name, CLA, separate governance system, SBOM service, or
release-token topology is required merely to develop or publish this personal
open-source project. Additional release metadata may be added when it provides
clear user value or a shipped dependency requires it.

## Acceptance

This direction is working when:

- a clean `IvoryHeart/herdr-world` checkout installs, tests, and builds without
  a sibling repository;
- one local Herdr daemon plus one World bridge serves working Spaces and World
  views, including terminal attach and the intended integrations;
- `UPSTREAM.md` names the current reconciled Herdr Web and Herdr revisions;
- upstream Web changes can be fetched and reviewed through ordinary Git
  ancestry;
- World-only code is absent from any focused patch proposed to Herdr Web; and
- no Foundation package, private cross-repository release, or repository token
  is part of normal development, CI, or runtime operation.

The normal acceptance command is `npm run check:acceptance`. Live activation
on port 8787 follows only after the candidate passes and keeps the Herdr daemon
and user data unchanged.

## Migration decision

The working protocol-20 World baseline was copied to
`IvoryHeart/herdr-world`, then reconciled with Herdr Web v0.5.0. The previous
`IvoryHeart/herdr-web` repository is left untouched as historical work; it is
not a dependency and need not be closed, rewritten, or deleted.

The experimental Foundation repository and its release candidates are not in
the Herdr World architecture. Useful ideas or code may be copied later only
when they solve a demonstrated problem in this monorepo.
