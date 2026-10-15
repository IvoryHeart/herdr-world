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
75f61e36 (#401), v0.8.3/v0.8.4 source range.
Owner: repository owner and independent delivery reviewer.

World retains its own workflows and pinned actions; automated source publication
cannot modify .github or .codex. Revisit every source sync and assess incoming
security fixes and required platform changes manually. Accept equivalent action
updates only through a trusted human-reviewed control change with existing
workflow, platform and delivery checks. Retaining control ownership does not mean
upstream security updates may be silently ignored. Record any follow-up PR and
rationale here; retain this standing entry while the divergence applies.
