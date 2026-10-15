# Outstanding upstream work

The owner prioritizes and approves policy changes; the integration agent revisits
open entries on every source sync and proposes implementation when acceptance is
satisfied. Independent reviewers verify those claims. Link deferred/divergent ledger
entries to a stable section here or a repository issue. Preserve completed sections
with their resolution PR so historical records retain a destination.

## Bun-free plugin installation

Status: deferred, proposed by the integration agent; acceptance requires human
review of this PR. Source: Roamgate ffca28f2 (#415), v0.8.4.
Owner: repository owner prioritizes and approves; the integration agent revisits
and proposes a compatible implementation, independently reviewed before merge.

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

Revisit on every source sync and any installer/plugin/launcher/release change.
No scheduled implementation or completion claim is implied. Until the acceptance
is delivered in a reviewed PR, retain this entry and explain each reconsideration
in the integration report. Record the resolution PR here when complete.

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
