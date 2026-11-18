# Upstream synchronization and compatibility boundary

- **Spec ID:** `013-upstream-synchronization`
- **Status:** Approved
- **Created:** 2026-08-14
- **Owner:** Downstream compatibility owner
- **Reviewers:** Repository requester
- **Approved by:** Repository requester
- **Approved at:** 2026-08-14

> This approved specification is immutable. Implementation evidence and any
> later intended behavior belong in its paired summary or a numbered extension.

## 1. Purpose

Keep this downstream Herdr Web repository aligned with the latest compatible
upstream improvements while documenting, without normatively adopting, any
unreconciled Herdr terminal protocol change observed during the audit.

## 2. Scope

- Record and audit the refreshed `herdrdev/herdr` and
  `kcosr/herdr-web` upstream references.
- Adopt the latest compatible Herdr Web presentation fixes in the current
  application structure: the existing Herdr SVG favicon and centered square
  icon buttons.
- Preserve the reviewed Herdr `v0.8.0` compatibility copy and terminal protocol
  19 contract in this bounded synchronization slice.
- Document the point-in-time protocol-20 observation and the validation evidence
  for the safe synchronization slice.

## 3. Non-goals

- Do not vendor the full Herdr source tree or make the bridge build against an
  external checkout.
- Do not partially copy Herdr `master` into `vendor/herdr-compat`.
- Do not claim support for Herdr terminal protocol 20, direct graphics, new
  pixel-input messages, or other post-`v0.8.0` wire/API features in this slice.
- Do not alter the user-owned evidence captures or the untracked repository
  analysis document already present in the worktree.

## 4. Context and constraints

The current bridge and compatibility crate are reviewed against Herdr
`v0.8.0`, commit `346411fa21afd297f5ed3b3fa56f9e3fbf7654b7`, and terminal
protocol 19. At the 2026-08-14 audit point, the canonical Herdr upstream is
`herdrdev/herdr`; its observed `master` commit was
`d76657f2c7fc18dcce3b9af43842c8afaba1646b`. The observed protocol-20 state and
its private wire/API/input changes are point-in-time, non-normative audit
observations only; they do not change this specification's support contract.
The audited Herdr Web upstream head is `9897522` on `kcosr/herdr-web`. The
latest Herdr Web changes relevant to this slice include the favicon fix from
`dfb6add`/PR #56 and square icon-button alignment fix from `d0a2bc4`/PR #55.

## 5. Requirements

### Requirement: Preserve explicit compatibility admission

The bridge SHALL continue to admit only Herdr versions at or above `0.8.0`
that report terminal protocol 19. This requirement records the existing
reviewed compatibility contract; it does not normatively classify any
point-in-time Herdr upstream observation.

#### Scenario: Current supported daemon remains admitted

- **GIVEN** a Herdr daemon reports version `0.8.0` and terminal protocol `19`
- **WHEN** the bridge validates daemon status
- **THEN** startup remains admitted and capabilities report protocol `19`

#### Scenario: A daemon outside the reviewed protocol is rejected

- **GIVEN** a Herdr daemon reports a terminal protocol other than `19`
- **WHEN** the bridge validates daemon status
- **THEN** startup is rejected with an incompatibility error naming the reviewed
  protocol and no partially compatible terminal service is exposed

### Requirement: Adopt compatible Herdr Web presentation fixes

The web app SHALL declare the existing Herdr SVG asset as its browser favicon,
and square icon buttons SHALL center their icons without relying on browser
default button padding or compensating icon transforms.

#### Scenario: Favicon uses a repository-owned asset

- **GIVEN** the production HTML shell is served
- **WHEN** a browser reads the document head
- **THEN** it finds an SVG favicon link pointing at the existing Herdr logo asset

#### Scenario: Square controls are geometrically centered

- **GIVEN** the sidebar filters, tab-bar add control, generic icon button, or
  terminal upload control is rendered
- **WHEN** the control is laid out
- **THEN** its icon is centered in the full square control box without a
  filter-specific horizontal transform

### Requirement: Keep upstream provenance auditable

Repository documentation SHALL identify the audited upstream heads and commits,
the bounded compatibility decision, and the validation commands/evidence for
the delivered slice.

#### Scenario: Reviewer can reproduce the audit

- **GIVEN** a clean checkout with the configured upstream remotes
- **WHEN** a reviewer runs the documented ref and vendor checks
- **THEN** the Herdr Web changes and protocol-20 rejection boundary are
  reproducible without relying on an untracked external source snapshot

## 6. Data and interface contract

The browser favicon is a static asset reference only. No API, bridge capability,
terminal wire message, persisted data, or Herdr daemon interface changes in
this slice. Protocol 19 remains the reviewed terminal compatibility identifier.

## 7. Privacy and security

The bridge remains local-first and retains its existing protocol admission
guard. No new network endpoint, authentication bypass, credential handling, or
upload behavior is introduced.

## 8. Acceptance evidence

- `scripts/check-vendor.sh`
- `npm run lint:web`
- `npm run test:web`
- `npm run build:web`
- bridge tests covering protocol-19 admission and rejection of protocols outside
  the reviewed contract
- `git diff --check`
- review of the upstream commit/ref audit and final worktree status

## 9. Deferred decisions

Any future decision to support a newer Herdr protocol requires a separate
approved migration spec. That spec must cover the changed wire messages, API
schema additions, input/raw-input dependencies, bridge terminal behavior,
browser capabilities, version policy, and compatibility acceptance evidence
before implementation begins. The point-in-time protocol-20 observation in
this draft is not itself a migration proposal.
