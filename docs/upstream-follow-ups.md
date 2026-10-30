# Outstanding upstream work

The owner prioritizes and approves policy changes; the integration agent revisits
open entries on every source sync and proposes implementation when acceptance is
satisfied. Independent reviewers verify those claims. Link deferred/divergent ledger
entries to a stable section here or a repository issue. Preserve completed sections
with their resolution PR so historical records retain a destination.

## Bun-free plugin installation

Status: completed in [PR #194](https://github.com/IvoryHeart/herdr-world/pull/194),
merged through [PR #191](https://github.com/IvoryHeart/herdr-world/pull/191).
Source: Roamgate ffca28f2 (#415), v0.8.4. The owner accepted the migration and
explicitly waived the counted independent-approval requirement before merge.
Independent technical follow-up review supported acceptance of revision b949f67c.
[Exact-revision CI](https://github.com/IvoryHeart/herdr-world/actions/runs/38751737664)
passed Windows installation, both macOS launchd architectures and Delivery checks.
The combined-stack run also passed after retrying a Windows fixture compilation
that exceeded its five-second test timeout; the initial failure remains in
[run history](https://github.com/IvoryHeart/herdr-world/actions/runs/38754539559).
The cumulative ledger now records the upstream feature as adapted.

Goal: released Herdr World plugins install without a separately installed Bun.
World already runs without external Bun after installation. This deferral is not
a permanent rejection of the upstream feature or blanket packaging exclusion.

Acceptance:

- Unix and Windows release installation succeeds without Bun using World release
  identity, version selection and checksum-verified artifacts.
- Existing cached plugin actions and the frozen launcher argv remain functional,
  either via a compatibility launcher or a verified migration.
- Unreleased source builds, local linking, service ownership and update/rollback
  behavior remain explicit and tested. Source builds may still require Bun.
- Plugin start/restart/status/URL/version/uninstall/panel behavior is verified on
  supported platforms; documentation, packaging and release tests agree.

Resolution: native World plugin commands and system installers preserve cached
launcher argv, checksum/version/native-command validation, source-build support,
and canonical service ownership. The completed section remains a stable historical
reference. Reassess regressions during future installer/plugin/launcher changes;
this item no longer carries an outstanding deferral.

## World workflow controls

Status: intentional divergence, proposed for owner review. Source: Roamgate
75f61e36 (#401), v0.8.3/v0.8.4 source range; also 2388b914 (#454), whose
Roamgate-only CodeQL workflow has no World counterpart.
Owner: repository owner and independent delivery reviewer.

World retains its own workflows and pinned actions; automated source publication
cannot modify .github or .codex. Revisit every source sync and assess incoming
security fixes and required platform changes manually. Accept equivalent action
updates only through a trusted human-reviewed control change with existing
workflow, platform and delivery checks. Retaining control ownership does not mean
upstream security updates may be silently ignored. Record any follow-up PR and
rationale here; retain this standing entry while the divergence applies.

## React 18 compatibility

Status: intentional divergence proposed for owner review. Source: Roamgate
e030b2e2 (#453), post-v0.8.6 main.
Owner: repository owner and independent delivery reviewer.

World retains React 18 under its current adoption policy. The upstream React 19.3.1
patch cannot be applied as an 18.x update. Revisit every source sync, relevant React
security advisory, or owner-approved major migration. Acceptance requires an
explicit policy decision and passing React DOM/browser evidence for focus, native
blur, IME, qualified editor drafts and independent runtime ownership. Keep this
entry until a compatible migration or security backport is reviewed and delivered.

## Assessment for source 57327a0d (20 October 2026)

The carried action-update commit 75f61e36 changes CodeQL init/analyze
4.38.2→4.38.3 and artifact upload 7.0.1→7.0.2/download 8.0.1→8.0.2.
The new 2388b914 advances CodeQL to 4.39.0. Official release notes were inspected:

- [CodeQL 4.38.3](https://github.com/github/codeql-action/releases/tag/v4.38.3)
  updates the default bundle to 2.27.2, warns about discontinued bundle versions
  and corrects per-language query configuration handling.
- [CodeQL 4.39.0](https://github.com/github/codeql-action/releases/tag/v4.39.0)
  changes minimum bundle support, validates checkout paths, repairs third-party
  cache restoration and changes private-registry proxy release discovery. World
  has no CodeQL workflow or action reference, so these bundle/query/platform
  changes have no existing World job to patch. Adding such a job remains a
  separate trusted control decision.
- [Upload 7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) and
  [download 8.0.2](https://github.com/actions/download-artifact/releases/tag/v8.0.2)
  update the artifact library to 6.3.1 and improve HTTP 429/Retry-After handling.
  These reliability improvements apply to World: its release/browser workflows
  still pin upload 7.0.1 and download 8.0.1. They remain explicit pending control
  work, not an adopted update or a claim that older pins are security-equivalent.

Owner: repository owner and independent delivery reviewer. Acceptance: a separate
trusted control PR updates the applicable artifact pins, checks upstream advisories
and runs workflow, delivery and platform publication checks. Revisit on the next
source sync, an artifact-action advisory or a publication throttling failure.
The release-note assessment is not a universal vulnerability audit or owner approval.

## Assessment for source 1a81c5da (20 October 2026)

The nine commits after 57327a0d contain no workflow/action updates or React
version changes. The action-release assessment above still applies; no new
security fix or platform requirement in this range changes the retained control
divergence. World main's newer delivery controls are merged unchanged. React 18
remains required by World policy: the new History ref types and Files callbacks
are adapted to 18, and qualified focus/browser regressions remain required.
The release-only v0.8.7 version and upstream asset-budget bump are adapted to
World's own release lifecycle and existing enforced budgets. These outstanding
workflow and React divergences remain proposals for owner approval.
