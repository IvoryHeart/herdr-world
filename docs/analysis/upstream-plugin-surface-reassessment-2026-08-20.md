# Upstream, plugin, surface, and open-source reassessment

- **Date:** 2026-08-20
- **Downstream baseline:** `ad5fe9a`
- **Herdr Web audited head:** `cff6335683acc20cbb76c24b67d03f9e75dd78e6`
- **Herdr stable baseline:** v0.8.2 at
  `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`
- **Herdr observed master:**
  `ffc4e263168f9e81d5bbc14db4b16ca9818d684a`
- **Purpose:** planning and spec correction; no implementation is authorized
  by this report

## Executive conclusion

Herdr World should remain an open downstream distribution with a deliberately
small upstream-aligned Web core, trusted compiled-in browser surfaces, optional
provider adapters, and independently installable Herdr plugins where the use
case is an executable workflow. It should not become another plugin platform,
extension registry, or multi-server coordinator.

The previous roadmap had two sound goals—separate World from generic Web and
make changes upstreamable—but it selected abstractions before rechecking what
the upstreams already supplied. The revised direction is:

1. restore compatibility with stable Herdr v0.8.2/protocol 20;
2. make licensing, provenance, contribution, and release boundaries explicit;
3. classify every integration against Herdr public APIs/plugins and existing
   Herdr Web bridge capabilities before creating a custom contract;
4. implement only a minimal compile-time surface boundary to remove World from
   generic core; and
5. reconstruct focused upstream proposals from current upstream heads after
   maintainer alignment.

## What changed upstream

### Herdr Web

The audited Herdr Web head is
[`cff6335`](https://github.com/kcosr/herdr-web/commit/cff6335683acc20cbb76c24b67d03f9e75dd78e6),
after the [v0.4.3 release](https://github.com/kcosr/herdr-web/releases/tag/v0.4.3).
Since the downstream's last synchronization, upstream added:

- a supervised `npm run dev` workflow and explicit static-asset cache headers;
- a focused [contribution policy](https://github.com/kcosr/herdr-web/blob/main/CONTRIBUTING.md);
- desktop IME composition, cancellation, and focus fixes;
- dialog/menu activation and focus restoration fixes; and
- optional terminal screen-reader text.

The contribution policy now says that Herdr Web is a small, focused personal
tool. Larger features, new product areas, architectural redesigns, or expanded
responsibilities should start with an issue. Pull requests should address one
concern and include practical tests, documentation, and changelog updates.

Herdr Web already has the browser-side multi-bridge primitives this downstream
needs: persistent profiles, enabled runtimes, selected runtime, independent
capability probes, qualified runtime URLs, and per-runtime failure state in
`BridgeManager`. It also already advertises bridge features through
`GET /api/capabilities`. A second bridge/profile coordinator or discovery
endpoint would duplicate upstream ownership.

Current open Web work covers
[terminal compression](https://github.com/kcosr/herdr-web/pull/59),
[mobile cursor/redraw behavior](https://github.com/kcosr/herdr-web/pull/60),
[wrapped URL copying](https://github.com/kcosr/herdr-web/pull/61),
[mobile chord input](https://github.com/kcosr/herdr-web/pull/63), and an older
[Capacitor iOS shell](https://github.com/kcosr/herdr-web/pull/37). No current
upstream pull request introduces a browser plugin SDK, surface marketplace,
generic extension registry, or World-like visualization host.

### Herdr

The current stable release is
[Herdr v0.8.2](https://github.com/herdrdev/herdr/releases/tag/v0.8.2), using
terminal protocol 20. Herdr Web v0.4.3 still requires protocol 19, and
[Herdr Web issue #65](https://github.com/kcosr/herdr-web/issues/65) now records
the resulting startup failure. The downstream has the same incompatibility.

Protocol 20 is not a constant-only bump. It adds
`ClientLaunchMode::AppDirectGraphics` before `TerminalAttach`, new direct
graphics and pixel-input client messages, `sgr_pixels` on mouse capture, and
terminal-bell/direct-graphics server messages. The inserted launch-mode variant
changes bincode enum layout. A safe upgrade must refresh and test the complete
wire shape.

Herdr's [runtime/client guardrail](https://github.com/herdrdev/herdr/blob/master/AGENTS.md)
continues to say that shared runtime/session facts belong in server state and a
neutral JSON API/event path, while presentation belongs in clients. It warns
against depending on the private TUI client socket when a public API is
practical. That is directly aligned with a separate Herdr World web client.

Herdr's current [plugin documentation](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx)
defines plugins as trusted executable workflow packages. Their manifests
declare actions, event hooks, one-shot startup restoration, terminal panes, and
link handlers. Plugins can use the full public CLI/socket API. Plugin v1 does
not provide native non-terminal UI or runtime action registration, and its
startup hooks are explicitly not daemon supervisors.

The public client surface is broader than the earlier World plan accounted for:

- `plugin.list`, `plugin.action.list`, and `plugin.action.invoke` provide
  canonical installed-plugin/action discovery and execution;
- `herdr terminal session observe` provides a read-only live ANSI stream; and
- `herdr terminal session control` provides writable stream, resize, scroll,
  release, and takeover behavior.

The active MIT-licensed
[`nikok6/herdr-mirror`](https://github.com/nikok6/herdr-mirror) plugin is useful
evidence. It uses public terminal session streams and Herdr APIs to mirror
remote workspaces, live panes, actions, and agent status into a local Herdr
instance. It has its own supervised daemon and pane processes rather than
pretending a one-shot startup hook is a supervisor. This does not replace
Herdr Web federation, but it proves that public APIs and plugins can cover more
multi-host/companion behavior than the old specs assumed.

The upstream contribution constraint is also stronger than Herdr Web's.
[Herdr CONTRIBUTING.md](https://github.com/herdrdev/herdr/blob/master/CONTRIBUTING.md)
rejects unsolicited implementation pull requests unless the authenticated
account is a maintainer or listed in `.github/APPROVED_CONTRIBUTORS`.
`IvoryHeart` is not in the audited list. Feature/API direction should therefore
start in a concise Discussion; only a personally reproduced bug should use the
bug issue template, and neither path authorizes a pull request.

## Correct extension model

| Proposed thing | Correct owner/mechanism | What World should not build |
| --- | --- | --- |
| Runtime action, event automation, pane tool, or reusable local workflow | Herdr plugin plus public CLI/socket API | World-specific plugin manifest or registry |
| Live external terminal consumer | Public `terminal session observe/control` when sufficient | Private TUI-protocol client by default |
| Browser bridge compatibility and optional HTTP/WS feature | Existing `/api/capabilities` on each `BridgeRuntime` | `/api/extensions` or a second capability catalogue |
| Multiple browser-connected Herdr hosts | Existing Web `BridgeManager` and federated runtime | Central coordinator or second profile store |
| Office/Graph/City React visualization | Trusted surface selected by the World build | Claim that a browser surface is a Herdr plugin |
| Historical metrics or aggregate data absent from Herdr | Narrow optional provider contract with an explicit gap matrix | Generic data envelope before repeated semantics exist |
| World release containing plugins and surfaces | Assembly manifest with independent component identities | One package identity pretending every component has one lifecycle |

This model answers the earlier architectural questions:

- Multi-bridge was already present. Downstream work should be described as
  correctness, identity, security, testing, and UX hardening around that
  upstream primitive, not a new federation invention.
- Observability can use a Herdr plugin for actions, reports, or reusable
  runtime workflows. Office itself cannot be a current Herdr plugin because it
  is non-terminal browser UI. Historical metrics may remain an external
  provider only where Herdr lacks the data.
- Herdr Web and Herdr World are applications/distributions. Packaging either
  as a plugin would confuse install lifecycle, browser serving, runtime
  authority, and UI ownership. A World distribution can include separate
  companion plugins.
- `agent.view.set` changes the built-in Agent view's filter/sort state; it is
  not an arbitrary browser projection or UI registration API.
- Generic plugin discovery already belongs to Herdr, and browser feature
  compatibility already belongs to `/api/capabilities`; therefore Spec 010's
  proposed `/api/extensions` is withdrawn.

## Surface composition reassessment

There remains one real downstream problem: generic `App.tsx` and the core
registry import and orchestrate Office. That prevents a credible generic Web
build and makes upstream reconstruction harder.

The previous Spec 011 correctly identified that problem but designed a platform
well beyond the evidence. It specified context version negotiation, three
slots, a new layered capability catalogue, optional-input recovery policy,
per-target requirements, minimum-host arithmetic, route grammar, and a large
lifecycle state machine. None is required to separate the two existing trusted
surfaces.

The revised Spec 011 keeps only:

- a type-safe binding of surface definition, context factory, and lazy
  component;
- a thin host adapter over the existing bridge/runtime/command/terminal
  services;
- one generic assembly containing Spaces and one World assembly adding Office;
- exact route/ID validation and route-local failure containment; and
- final bundle audits proving the generic build contains no World code or art.

It explicitly defers settings/slot generalization, context-version negotiation,
capability DSLs, and dynamic plugins until another concrete surface proves the
need. This is an extraction boundary, not a new UI framework.

## Observability reassessment

The implemented observability contract remains a valid compatibility boundary;
an immutable implemented spec should not be retroactively rewritten. The next
work should be a field-level source audit:

1. map current agent, workspace, pane, activity, target, health, aggregate, and
   time-series fields to stable Herdr API/events/reports;
2. mark data derivable without terminal scraping;
3. identify data a Herdr plugin can legitimately contribute;
4. retain Prometheus or another provider only for historical/aggregate data
   that Herdr does not own; and
5. deprecate duplicate sources rather than introducing a generic registry over
   both.

No current evidence justifies a generic `/api/extensions` route. A future
browser need to list or invoke plugin actions should be a thin allow-listed
mapping of Herdr's canonical plugin API, advertised through the existing bridge
capabilities.

## Upstream relationship and proposal lanes

### Herdr Web lane

Use a focused issue first for architecture or broader product behavior. Prepare
one branch/worktree from current `upstream/main` per accepted concern. Reproduce
only the generic change, its tests, focused docs, and changelog. Do not send
World assets, Office behavior, provider contracts, release packaging, custom
CI history, or an aggregate downstream refactor.

The first likely upstream concern is protocol-20 compatibility, but issue #65
already exists. Monitor it and adopt an upstream solution if one lands. If the
maintainer invites a contribution, reconstruct the smallest compatibility fix
on current upstream. Surface composition should be discussed as a concrete
problem—keeping the core app independent of an optional compiled view—not as a
general plugin framework.

### Herdr lane

Do not open an implementation pull request under the current account/policy.
Use Discussions for concise, user-centered API gaps. The most useful questions
are semantic and neutral, for example whether a missing shared runtime fact
should be exposed through the public JSON API/event path. Do not propose World,
Office, browser widget, registry, or provider-shaped fields to Herdr core.

Relevant existing discussions still show interest but not accepted contracts:

- [#515: remote session/client direction](https://github.com/herdrdev/herdr/discussions/515)
- [#1490: external client/API boundary](https://github.com/herdrdev/herdr/discussions/1490)
- [#1609: persistent plugin semantic summary](https://github.com/herdrdev/herdr/discussions/1609)
- [#1672: plugin action UI](https://github.com/herdrdev/herdr/discussions/1672)
- [#2192: companion lifecycle/revocation](https://github.com/herdrdev/herdr/discussions/2192)

Discussion #1490 is especially aligned: the maintainer described the server
runtime as open to build on, welcomed useful API improvements, and rejected
specific core integrations for individual wrappers. World should therefore be
an external client first and ask upstream only for neutral missing facts.

## Open-source and attribution assessment

The repository is not ready to claim a compliant Herdr World release merely
because its current code builds. It lacks complete release governance and
compliance outputs such as a downstream copyright-holder decision, complete
notice bundle, machine-readable provenance, SBOMs, contributor guide, security
policy, and release manifest. Because the fork and its GitHub source archives
are already public, the first Spec 004 implementation step is an immediate
default-branch audit and remediation record; the release gate applies to every
new tag and Herdr World-branded or generated artifact and does not pretend
earlier publication did not occur.

Current asset evidence must remain file-specific:

- the current character sprites are byte-identical to tracked files in
  [`GreenSheep01201/claw-empire`](https://github.com/GreenSheep01201/claw-empire),
  Apache-2.0, revision `66a24ea7df2435ef897c48c147deb7ec572c01c2`;
- the TypeScript geometry/renderer adaptations refer to separately hashed
  JavaScript files from an untracked historical reference directory. Current
  files label that source as Claw-Empire/Apache-2.0 and cite an owner approval,
  but the public release manifest still needs immutable evidence tying those
  exact source hashes, copyright holder, and permission together. The tracked
  sprite match does not by itself license the adapted JavaScript;
- PixiJS is MIT and its license is already stored beside World assets;
- [`pixel-agents-hq/pixel-agents`](https://github.com/pixel-agents-hq/pixel-agents)
  is MIT at the audited head
  `3537e140c2094761beae748592aeb92ece8edfdd`, but current documentation does
  not identify its files as the source of the distributed character assets;
  it should be recorded only as a possible design/reference project unless a
  file-level audit proves copied or adapted material; and
- replacing art later does not erase obligations attached to any other
  distributed adapted source.

Apache-2.0 redistribution requires the license, applicable copyright/NOTICE,
and prominent notices for modified files. The release must identify copied,
modified, adapted, generated, and reference-only inputs separately. If the
adapted JavaScript evidence cannot be made public and reviewable, those
adaptations remain a release blocker even though the sprites are resolved. An
asset being open source does not remove these obligations; it makes them
knowable and manageable.

The downstream also needs to avoid suggesting that Herdr World is an official
Herdr or Herdr Web release. Product naming, logos, package namespaces, metadata,
and README wording need an explicit non-endorsement relationship and a decision
from the repository owner before publication.

## Spec changes resulting from this audit

| Spec | Change | Reason |
| --- | --- | --- |
| 004 | Rewritten as open-source packaging and upstream contribution boundaries | Public release, attribution, governance, and branch strategy are now first-class gates. |
| 010 | Renamed/replaced with upstream extension alignment | Withdraws `/api/extensions`; classifies plugins, capabilities, surfaces, and providers by authoritative owner. |
| 011 | Returned from In review to Draft and reduced to minimal compiled composition | Keeps the real extraction need and removes speculative platform machinery. |
| 013 | Unchanged | It is an immutable implemented record of the earlier protocol-19 synchronization. |
| 015 | Added for v0.4.3/protocol-20 realignment | Current stable Herdr is incompatible; wire changes and upstream Web updates require their own reviewed slice. |

## Recommended order

```text
015 current stable compatibility
        ↓
004 OSS/package/contribution gates
        ↓
010 extension/source classification and observability gap audit
        ↓
011 minimal compiled surface boundary
        ↓
focused upstream proposals + Herdr World release implementation
```

Specs 015 and 004 may be reviewed in parallel, but protocol compatibility
should be implemented first because every integration and live acceptance test
depends on a supported stable daemon. Spec 010 should settle which data and
lifecycle belong upstream before Spec 011 turns any World-facing API into a
long-lived host boundary.

## Decisions still required from the owner

- Approve the revised architectural taxonomy and removal of the generic
  registry proposal.
- Select the Herdr World legal copyright holder, license for original World
  code, branding/non-endorsement wording, and repository/package names.
- Decide whether to retain, redraw, or replace current Office art; all choices
  still require a complete current provenance record.
- Decide whether the first public artifact is source-only, pre-release binaries,
  or both, and which signing/attestation level is required.
- Approve the protocol-20 baseline and deliberate protocol-19 drop before
  implementation.
