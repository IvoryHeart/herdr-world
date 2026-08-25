# Herdr World foundational roadmap

- **Status:** Superseded on 2026-08-25
- **Revised:** 2026-08-20
- **Downstream baseline:** `ad5fe9a`
- **Upstream reassessment:**
  [`upstream-plugin-surface-reassessment-2026-08-20.md`](upstream-plugin-surface-reassessment-2026-08-20.md)

> This is a historical planning record. Its multi-phase packaging and surface
> extraction plan was replaced by the single
> [Herdr World independence and upstream synchronization spec](../specs/004-world-packaging-and-upstream-boundaries-spec.md).
> Herdr World now remains one monorepo and follows Herdr Web through ordinary
> downstream Git synchronization.

## Decision

Herdr World will be an open downstream distribution, not a competing Herdr
runtime, plugin system, extension registry, or bridge coordinator.

The project will:

- consume Herdr's public CLI/socket/session APIs and plugin model first;
- keep Herdr Web's existing `BridgeManager`, `/api/capabilities`, runtime cache,
  and terminal transport authoritative in the browser;
- compose World visualizations as trusted compile-time surfaces;
- retain custom providers only for documented semantic or historical-data gaps;
- preserve Herdr Web Git ancestry and reconstruct one focused upstream concern
  at a time from current upstream; and
- release original and redistributed material only after source/art provenance,
  licensing, notices, governance, security, SBOM, and reproducibility gates pass.

The earlier generic `/api/extensions` direction is withdrawn. Spec 010 now
defines extension alignment and an observability source audit rather than a new
registry.

## Current upstream baseline

| Project | Current audited state | Consequence |
| --- | --- | --- |
| Herdr Web | v0.4.3; main `cff6335683acc20cbb76c24b67d03f9e75dd78e6` | New dev, IME, focus, accessibility, and contribution-policy work should be assessed and replayed by concern. |
| Herdr | v0.8.2 at `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`; protocol 20 | Spec 015 work unit 1 refreshes the bridge to the complete protocol-20 wire shape and records stock-daemon evidence. |
| Herdr plugins | Manifest actions/hooks/panes/link handlers; full public CLI/socket access; public terminal session observe/control | Prefer plugins/public APIs for executable workflows and companion clients; native browser UI remains outside plugin v1. |
| Herdr Web issue #65 | Open protocol-20 incompatibility report | No upstream fix was present at the 2026-08-20 audit; work unit 1 resolves the downstream gap and records the disposition. |
| herdr-mirror | Active MIT Herdr plugin using public terminal session APIs | Evidence that public APIs/plugins can cover companion and multi-host workflows without another registry. |

## Target architecture

```text
Herdr runtime
  authoritative session facts, public APIs, plugin registry
        │
        ├── optional Herdr plugins / supervised companion processes
        │
        v
Herdr Web core
  bridge + multi-bridge profiles + capabilities + runtime cache + terminals
        │
        ├── generic Web assembly: Spaces
        │
        └── Herdr World assembly: Spaces + Office + later compiled surfaces
                                      │
                                      └── optional narrow provider contracts
                                          only for documented upstream gaps
```

Product and package identity remain distinct:

- Herdr is the upstream runtime.
- Herdr Web is the upstream browser application and bridge.
- Herdr World is this downstream distribution and product assembly.
- Office, Graph, and City are compiled World surfaces.
- Reusable executable workflows are separately identifiable Herdr plugins.
- Providers are optional data adapters, not plugins or surfaces by default.

## Delivery order

```text
P0 stable compatibility (Spec 015)
        ↓
P1 open-source/package boundaries (Spec 004)
        ↓
P2 extension and data-source alignment (Spec 010)
        ↓
P3 minimal surface composition (Spec 011)
        ↓
P4 focused upstream proposals and public World release
```

Spec 004 compliance/documentation work can be prepared while Spec 015 is in
review. Implementation should not freeze a new browser host API until Spec 010
has identified which current observability semantics belong to Herdr versus an
external provider.

## P0 — restore current stable compatibility

### Governing draft

[`015-upstream-v043-protocol20-realignment-spec.md`](../specs/015-upstream-v043-protocol20-realignment-spec.md)

### Work

- Fetch current Herdr Web and Herdr again immediately before implementation.
- Monitor Herdr Web issue #65; adopt an upstream protocol-20 fix if it lands before review.
- Refresh the narrow compatibility crate to stable Herdr v0.8.2/protocol 20,
  including the complete enum/field delta rather than only the version constant.
- Keep browser terminals in `TerminalAttach`; explicitly exclude direct
  graphics file forwarding and define terminal-bell behavior.
- Validate an unmodified Herdr v0.8.2 daemon end to end.
- Defer v0.4.2/v0.4.3 Web replay by concern with attribution and regression tests
  to the next separate reviewable unit.
- Update active compatibility docs while preserving Spec 013 as historical
  protocol-19 evidence.

### Exit gate

- Stock Herdr v0.8.2 starts and passes snapshot, events, commands, terminal,
  detach/reattach, and multi-bridge acceptance.
- Protocol 19 and unknown protocols fail clearly.
- Every protocol-20 message has explicit safe bridge handling.
- Current setup/release docs no longer instruct users to install protocol 19.

## P1 — make the repository genuinely open-source ready

### Governing draft

[`004-world-packaging-and-upstream-boundaries-spec.md`](../specs/004-world-packaging-and-upstream-boundaries-spec.md)

### Work

- Approve downstream legal copyright holder, license, Herdr World name,
  non-endorsement wording, package/artifact IDs, and legacy aliases.
- Keep upstream-aligned `bridge`, `web`, and vendor paths easy to compare while
  isolating downstream contracts, providers, surfaces, plugins, and packaging.
- Add `CONTRIBUTING.md`, `SECURITY.md`, code-of-conduct/governance decisions,
  and a clear guide to the separate Herdr, Herdr Web, and World lanes.
- Audit the already-public default branch, publish a remediation record, and
  resolve each current compliance gap before the next tag or branded artifact
  without assuming that already published history can be undone.
- Create machine-readable source/art provenance, complete offline licenses and
  notices, Apache-2.0 modified-file notices, npm/Cargo/font/art review, and
  browser/bridge/artifact SBOMs.
- Add immutable assembly manifests, source archives, checksums, clean-checkout
  builds, and fail-closed release validation.
- Distinguish tracked Claw-Empire sprites, separately hashed historical source
  adaptations, PixiJS, possible Pixel Agents design/reference evidence,
  generated work, and original World material file by file.

### Exit gate

- No public artifact is possible with unresolved ownership, license, notice,
  provenance, supported-version, or SBOM data.
- The current public default branch has an explicit remediation disposition for
  every known compliance gap and historical limitation.
- A clean checkout needs no legacy workspace or absolute workstation path.
- Generic and World outputs are independently identifiable and traceable.
- Contributors can tell where and how a change may be submitted without
  violating upstream policy.

## P2 — align plugins, capabilities, providers, and observability

### Governing draft

Superseded by the current [Spec 004](../specs/004-world-packaging-and-upstream-boundaries-spec.md).

### Work

- Add one extension decision record for every proposed integration.
- Complete a field-level observability matrix against current Herdr API,
  events, reports, plugin methods, and terminal session streams.
- Source authoritative Herdr facts from Herdr; keep provider adapters only for
  historical/aggregate data Herdr does not represent.
- Use Herdr plugin manifests for actions/hooks/panes and separately supervise
  any long-running companion process.
- Keep browser feature admission in `/api/capabilities`.
- Prevent a generic `/api/extensions` route, duplicated plugin registry, or
  duplicated bridge profile/capability owner.
- Characterize why any remaining private protocol client cannot yet use public
  `terminal session observe/control`.

### Exit gate

- Office, observability, generic Web, and any companion plugin have explicit,
  non-overlapping owners and lifecycle.
- Every provider-only field has a documented public-API gap.
- Existing observability behavior remains compatible while duplicate data
  sources have a migration decision.
- No new registry or generic transport exists without demonstrated consumers.

## P3 — extract the minimal compiled surface boundary

### Governing draft

Superseded by the current [Spec 004](../specs/004-world-packaging-and-upstream-boundaries-spec.md).

### Work

- Bind each surface definition, context factory, and lazy component with a
  preserved TypeScript generic.
- Build a thin `SurfaceHostV1` adapter over existing bridge, federated runtime,
  command, and terminal services.
- Move World orchestration out of generic `App.tsx` into the World registration
  and World-owned modules.
- Produce explicit generic Web and World assembly entries.
- Preserve current behavior before adding another visualization.
- Audit final emitted module graphs and assets, not only imports by keyword.

### Exit gate

- Generic Web builds and serves Spaces with no World source, assets, providers,
  or branding.
- World adds Office only through its assembly entry.
- Both surfaces use the same qualified runtime, command, and terminal owners.
- Route-local errors cannot tear down core runtime observation or unrelated
  terminals.
- No speculative settings registry, slot platform, capability DSL, or dynamic
  browser plugin system was introduced.

## P4 — engage upstream and release World

Upstream discussion should start before all downstream refactors finish, but
implementation proposals must remain independent and current.

### Herdr Web

1. Search current issues, pull requests, releases, and main.
2. Open a short issue before a larger feature or architectural change.
3. If aligned, reconstruct one generic concern from current upstream main.
4. Include only its tests, necessary docs, and changelog.
5. Exclude World code, art, provider contracts, packaging, and unrelated
   downstream history.
6. Track accepted/declined/superseded status in the World assembly manifest.

### Herdr

1. Use Discussions for product/API gaps and questions.
2. Use the bug template only for a personally reproduced bug and omit a
   speculative implementation plan.
3. Do not open an implementation pull request unless the acting account is a
   current maintainer or approved contributor.
4. Ask for neutral shared runtime facts or APIs, never Office/browser widget
   concepts.
5. Continue downstream against public APIs if upstream declines or defers.

### World release

The first public source/binary release occurs only after Spec 004's gates pass,
the selected compatibility matrix is live-tested, and generic/World assemblies
are mechanically distinct. Registry publication can remain deferred; source,
licenses, notices, provenance, checksums, SBOMs, security reporting, and
reproducible assembly cannot.

## Proposed reviewable work units

Each unit should be a separate branch/PR and should not mix unrelated Office
UX changes:

1. **Protocol-20 compatibility:** stable Herdr vendor refresh and live tests.
2. **Web v0.4.2/v0.4.3 replay:** split further by dev, IME, focus, and
   accessibility concern if conflict review warrants it.
3. **OSS policy and identity:** license-holder/name decisions, contribution,
   security, governance, and support docs.
4. **Provenance and release gate:** source/art manifests, notices, SBOMs,
   checksums, assembly manifest, and fail-closed tests.
5. **Observability source audit:** no product behavior change.
6. **Provider/companion boundary:** only the gaps proven by unit 5.
7. **Minimal surface seam:** typed binding and World orchestration extraction.
8. **Assembly proof:** generic/World entries and final bundle audits.
9. **Upstream candidate branches:** one current-upstream concern per branch.
10. **Public release:** only after all mandatory release gates pass.

## Non-negotiable stop conditions

Do not claim upstream readiness or public Herdr World distribution while any of
the following is true:

- the supported stable Herdr daemon cannot start or attach;
- an upstream proposal duplicates an active upstream fix or violates its
  contribution policy;
- a generic branch contains World-specific code, branding, art, providers, or
  aggregate downstream history;
- original/downstream copyright, product identity, or non-endorsement wording
  is unresolved;
- a distributed source, art, font, or dependency lacks provenance and required
  license/notice/modification evidence;
- builds depend on undeclared checkouts, secrets, or workstation paths;
- generic and World artifacts cannot be built and audited independently; or
- source archive, checksums, SBOMs, contributor/security paths, and assembly
  manifest are missing.
