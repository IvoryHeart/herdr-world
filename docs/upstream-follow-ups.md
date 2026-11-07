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

Status: addressed by the React 19 migration (#679), pending candidate review.
Source: Roamgate e030b2e2 (#453), post-v0.8.6 main.
Owner: repository owner and independent delivery reviewer.

World now follows Roamgate's `^19.3.1` range for React and React DOM, with 19.x
types. The original development-build stall was the changed-prop diagnostic walk
bypassing its own width counter when descending into changed objects. A small,
version-scoped Bun patch corrects that counter in both development entry points;
production code and diagnostic availability are unchanged. See the
[18/19 measurements, reproduction and patch removal conditions](react-19.md).
The historical assessments below record the earlier React 18 decision; they do
not require future source integrations to downgrade React. Focus, native blur,
IME, qualified drafts and independent runtime ownership still require browser
and consumer evidence on dependency updates.

## Mobile navigation and History input

Status: deferred to one dedicated mobile PR (firstmate-2 ruling, 5 November 2026),
proposed for owner review. Source: Roamgate 396d0cb0 (#482), e724e17e (#489) and
22ee302f (#493), in the b84ccd53..2b16e991 range.
Owner: the mobile PR's author, with the repository owner's phone try.

These changes consolidate mobile tab and pane navigation, keep mobile History input
in a bottom bar and compact mobile Ranger around a shared Message input. World ports
them onto its MobileControls and layer Back order in one PR after the Roamgate web
part. Acceptance: the owner tries that PR on a phone, comparing upstream's bottom
bar with World's in-flow Message input, under the phone rules (tabs one tap away,
one-tap keyboard, no extra bars). Revisit in that PR, otherwise every source sync.

## Mobile entry point

Status: intentional divergence, proposed for owner review. Source: Roamgate
52cbea92 (#491).
Owner: repository owner.

Upstream makes Chat the mobile entry point. World keeps Town as the phone's default
view, with Chat one tap away. Adopting it needs an owner decision to change the
default view. Revisit every source sync.

## Agent seen tracking

Status: intentional divergence, proposed for owner review. Source: Roamgate
fd86a13d (#544).
Owner: repository owner.

Upstream tracks which agents the user has seen, apart from Herdr's focus. World's
reviewed record and Desk marks are its attention model; a separate seen store would
add a second, conflicting notion of seen. Revisit every source sync, or when the
owner changes World's attention model.

## Recently opened agent sort

Status: intentional divergence (firstmate-2 ruling, 5 November 2026), proposed for
owner review. Source: Roamgate 10546ef8 (#518).
Owner: repository owner.

Upstream sorts agents by a per-browser history of opens (`agentRecency.v1`). World
keeps no activity history in the browser: its `agentRecency.ts` is service-backed,
and the service records no "opened" signal. "Recently opened" could return later if
the service records owner opens as part of the World model. Revisit every source
sync and when such a signal exists.

## Diff worker dependency update

Status: deferred (firstmate-2 ruling, 5 November 2026), proposed for owner review.
Source: Roamgate f4367c30 (#508), `@pierre/diffs` 1.5 to 1.6.
Owner: the integrator of each source sync.

Pierre 1.6's diff worker bundles both highlighter backends and a second copy of
World's curated grammars: 56 more asset files and 1.9 MiB more, beyond the 180-file
limit and the web total budget in [packaging](packaging.md). World stays on 1.5.x,
and no budget is raised for it. Re-check at every source sync; adopt when the worker
fits the budgets or the owner changes them.

## Browser port-forward controls

Status: deferred, proposed for owner review. Source: Roamgate e5b399ce (#546).
Owner: the author of the next web or mobile integration PR.

World #636 adapted the service side of SSH port forwarding: explicit local and
reverse forward RPCs after login, bound to the selected connection and runtime.
Upstream's browser controls (`portForwarding.ts`, the Connection switcher and
command-menu entries, and terminal link offers) are not in World yet, although
#636 planned them for the web part. Acceptance: the controls use the qualified
forward RPCs, appear only on a page served over loopback as upstream does, and keep
World's connection ownership and browser tests. Revisit in the next web or mobile
integration PR, otherwise every source sync.

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

## Assessment for source b84ccd53 (22 October 2026)

The eight commits from 1a81c5da through v0.8.8 contain no workflow/action edits or
React dependency changes. No new action security fix or platform requirement in
this range changes the existing workflow-control decisions. World controls and
U1's DOMPurify 3.4.17 / undici 8.12.3 security updates remain unchanged. The React
18 compatibility condition still applies: History's inert attribute is set through
the DOM, PR refresh callbacks use World's effect-callback adapter, and new composer
and launcher consumers run on 18.3.1. No major migration is proposed or accepted.
The existing action and React follow-up owners, acceptance and revisit triggers
remain unchanged; their unmet acceptance stays visible. World release identity,
asset budgets, top app bar, tab-window restoration and session binding are retained
through compatible adaptations recorded in UPSTREAM.md and the disposition ledger.

## Assessment for source 2b16e991 (1 November 2026)

The 69 commits from b84ccd53 (v0.8.8) to 2b16e991, after v0.8.13, land in three
parts: SSH transport (#636), Ranger and transcripts (#645), and the web part with
this ledger merge. U1's DOMPurify 3.4.17 and undici 8.12.3 are now inside the
recorded range (#488, #500). Three commits edit workflows: #480's Bun pins are
adapted through World #644, #499's workflow, dependabot and Copilot edits stay
World's, and #504 updates Roamgate's CodeQL workflow, which World does not have.
No new action security fix or platform requirement changes the workflow-control
decisions. React stays 18.3.1: the range keeps upstream on 19.3.1 without a React
change, and its new consumers run on 18 (`forwardRef` search input,
`useStableCallback` for `useEffectEvent`, World's effect-callback adapter). The
three standing workflow and React divergences are re-reviewed for this source and
unchanged; their unmet acceptance stays visible.

New proposals for owner review: deferred #482, #489 and #493 (one mobile PR), #508
(diff worker budget) and #546's browser controls; divergent #491 (mobile entry
point), #504 (workflow controls), #518 (Recently opened) and #544 (seen tracking).
Source after 2b16e991, including v0.8.14 and v0.8.15, is not part of this record.
