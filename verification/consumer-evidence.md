# Consumer and alternative evidence decisions

This reconciles the remaining baseline entries without treating a component model as a proof of its consumers. Each decision names the required real tests in `coverage.json`; existing accepted-delivery CI is baseline execution evidence. New candidate execution is reported in PR #188 and source-bound manifests. Environment-gated live/OS checks retain their prerequisites and may not be reported as locally executed. All Q01–Q43 mappings and alternatives are independently accepted in review 5516249164 within their stated bounds. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.

## Shared model consumers

| Area | Mapping and required consumer evidence | Limits |
| --- | --- | --- |
| Q02 Profile service and persistence | Manager replacement and drain guarantees are consumed by profile persistence/retry admission; real profile tests retain default persistence, rollback and cancellation during cleanup. Models: runtime-control, runtime-drain. | Persistence atomicity and retry clock/jitter remain real integration evidence; manager readiness alone does not prove catalogue consistency. |
| Q03 SSH supervision | Manager currency and drain fence late transport completion. Real supervisor/tunnel tests exercise process exits, cancellation, reconnect classification and private path ownership. Models: runtime-leases, runtime-drain. | Real OpenSSH, OS process and Windows transport semantics remain platform checks; the manager model does not simulate SSH. |
| Q04 Subscriptions | Retired manager owners cannot publish readiness. Subscription tests independently exercise stop-before-ready, stop-during-retry, coalesced drain and callback suppression. Models: runtime-leases, runtime-drain. | Subscription retry progress requires actual timers and transport behavior; model producer guarantees do not prove callback consumers. |
| Q05 RPC/HTTP routing | Qualified manager leases supply dispatch authority. Protocol and HTTP tests check malformed/stale generations, explicit rejection, legacy omission and cancellation of stale streams. Models: runtime-leases, runtime-control. | No model substitutes for endpoint parsing or HTTP stream cancellation; legacy compatibility is scoped separately from explicit admission. |
| Q07 Terminal input/reconnect | Real Bridge replay covers transport retirement and late-socket replies; creation replay covers uncertain dispatched mutation without retry. API and terminal recovery tests supply input-specific consumers. Models: chunk-assembly, creation-flow. | Creation is not a model of terminal bytes or resume clocks; uncertain input, compressed frames and browser lifecycle remain direct/browser tests. |
| Q15 Focused operational contexts | Captured owner/generation and colliding native IDs are exercised through real store/Bridge replay. Store and concurrent-context tests verify inactive-host operations and context isolation. Models: creation-flow, browser-preparation. | React context binding and all operation kinds remain actual consumer tests; generic readiness is insufficient to select an operational target. |
| Q16 Resource caches | Runtime currency remains the cache admission identity. File Explorer regressions independently reject retired prefetches and in-flight previews while preserving healthy contexts. Models: browser-preparation, runtime-leases. | Browser focus generation, transport epoch and runtime generation remain different tokens; the model is not a proof of every resource-cache callback. |
| Q18 Watchlists | Runtime retirement and observation epochs establish producer boundaries; real watchlist tests enforce exact identities, bounded/idempotent admission and old-revision/reconnect behavior. Models: runtime-leases, browser-refresh. | Watchlist revision is independent of observation epoch; its real store mutation/revision tests are mandatory consumers. |
| Q19 Presentation capacity | Real allocation is compared with the independent exhaustive finite allocator across 5,103 configurations and six asymmetric host orders. Tree/graph tests retain ancestor reservations and projection capacity. Models: space-admission. | Finite three-host allocation does not prove arbitrary tree/graph projections or all capacity domains; projection integration remains necessary. |
| Q20 Shared entity identity | Real object preparation and allocation preserve qualified host identity; object/tree tests check dense cancellation, colliding IDs and ancestry projection. Models: browser-preparation, space-admission. | Model preparation uses small synthetic topology; dense cardinalities, labels and layout require implementation/browser tests. |
| Q25 History/task/checkout reports | Captured runtime authority applies to checkout report reads. Real history/task parsers and checkout tests check transcript order and exact live session identity. Models: runtime-leases. | Session identity is a distinct consumer guard; parsing all external formats is direct fixture evidence, not a manager guarantee. |
| Q32 File search and annotation drafts | Runtime-qualified late-result admission is the shared rule; real File Explorer tests exercise retired prefetch/preview and annotation tests retain durable checkout identity and stale anchors. Models: browser-preparation, runtime-leases. | Draft persistence intentionally uses durable checkout identity rather than transient generation; glob expansion and anchor reconstruction remain pure/fixture tests. |
| Q37 Whole-service startup/shutdown | Manager shutdown prevents new starts and drains retained owners. Startup/shutdown tests verify listener availability, one shared drain and forced exit deadline. Models: runtime-control, runtime-drain. | Actual listener/process/service-manager lifecycle and forced-exit policy are integration/platform evidence; models do not prove OS termination. |

## Direct implementation, browser and platform alternatives

| Area | Selected evidence and reason | Limits |
| --- | --- | --- |
| Q08 Terminal composition/touch/clipboard | Real xterm/browser composition, touch and clipboard transitions are the executable subject; synthetic abstract key transitions would omit the shipped core duplication that the regression reproduces. | IME/browser/clipboard behavior depends on platform events; supported browser scenarios are exercised, not every device keyboard. |
| Q09 Terminal composer and shortcuts | Pure command resolution/catalogue tests and qualified composer draft tests directly cover aliases, key normalization and owner identity. | No abstract shell semantics or automatic command execution is claimed; terminal dispatch authority is covered separately. |
| Q10 Aggregate observation | Real snapshot tests exercise retirement during construction, expired catalogue scheduling, failed-host stale topology and healthy sibling publication with bounded synthetic transports. | Snapshot integration is the selected consumer evidence for manager authority; no exhaustive claim over arbitrary host topology or transport schedules. |
| Q11 Observation scheduling | Real controlled scheduling tests exercise 32 hosts, three stalled priority owners, slot release, repeated invalidation rotation, overlapping priorities and cached hosts without refetch. | These are explicit adversarial scheduling scenarios, not a liveness proof. Eventual progress assumes completed transport turns; stalled-owner deadlines and capacity remain implementation tests. |
| Q22 Tab/pane layout, pins and reorder | Direct pure layout/pin/reorder tests plus queued visible-layout retirement tests cover owner-keyed state; Q21 adds bounded window reducer exploration. | All tab cardinalities and asynchronous native layout responses are not exhausted; captured generation checks retain their implementation regressions. |
| Q24 Desk receipts and review marks | Fixture receipt parsing and real Desk browser routing/review tests directly check human-facing summaries and review intent. | A summary is presentation evidence, not proof that external work succeeded; publication identity remains a separate operational guard. |
| Q29 Task notifications and Web Push | Real notification listener/push tests and durable task notification tests exercise session-safe clicks, endpoint validation and persist-before-dispatch/dedup across restart. | Dedup is scoped to recorded occurrences/sessions; it does not make external push delivery exactly once. |
| Q30 Browser authentication | Real HTTP tests exercise authentication, PIN/rate budgets, cookies and browser admission; real request/response semantics are the security boundary. | No new abstract authentication model replaces protocol/security tests; trusted-single-user and supported deployment assumptions remain unchanged. |
| Q31 Files/uploads/previews | Real filesystem/upload/path tests exercise traversal, native cwd, publication and cancellation using owned synthetic fixtures. | Filesystem permissions, symlink/path and upload semantics require implementation/platform evidence; no universal filesystem or remote atomicity claim. |
| Q33 Git actions/auto-sync | Real Git repositories and process tests exercise dirty-tree refusal, fetch/merge failures, qualified actions and synchronization. | Git/network/platform behavior and uncommitted user changes are not represented by an abstract branch flag. |
| Q34 Worktree create/remove/hooks | Real worktree/hook tests exercise fetch-before-create, failed fetch, one in-flight removal and retry after failure. | Native Git/filesystem/hook execution is required; shared-operation examples are bounded integration evidence, not all concurrent worktree schedules. |
| Q35 Settings/private-file publication | Owned filesystem and fresh-process tests exercise private namespaces, permissions, settings publication and durable secrets. | Actual rename/fsync/permission behavior remains platform-dependent; unsupported power-loss guarantees are not inferred. |
| Q36 Herdr setup/service/update | Real setup/update/service tests exercise verified assets, replacement failures, request budgets and installation ownership. Native compiled plugin fixtures with isolated homes and no Bun exercise every frozen verb and canonical service routing; system installer fixtures reject corrupt/mismatched releases and restore binaries on failed launcher promotion. | OS service managers and downloaded artifacts require supported-platform CI/live evidence; environment-gated checks must report prerequisites/skips. |
| Q38 Optional metrics/cache work | Real provider/HTTP/cache tests exercise bounded read-only observation, unavailable providers, coalescing and validated credential-free configuration. | Metrics do not grant operation authority; provider availability and network deadlines are observed integration behavior. |
| Q39 Renderer and lazy-module lifetime | Real rendering-resource and browser/lazy-module tests exercise graphics destruction, shared texture ownership and reload/lifetime behavior. | GPU/browser/URL behavior requires the actual implementation; arbitrary device/driver failure schedules are excluded. |
| Q40 Binary/control protocol parsing | Wire fixtures and actual endpoint/thin-client/Herdr parsers exercise protocol versions, truncation, close buffering and codec negotiation. | Chunk ownership has maintained models; byte parsing remains direct fixture/protocol evidence across supported versions, not all byte strings. |
| Q41 Release/package/CI orchestration | Real packaging/installer/release/CI tests exercise archive validation and dependency gates; actual platform/release workflows supply distribution evidence. | Local tests cannot establish every packaged platform or published asset. Protected validation and release checks remain required. |
| Q42 Preferences/filters/shortcuts | Pure bounded key parsing and browser storage tests exercise namespaces, canonicalization, quotas and newest explicit preference. | Storage quota/browser implementation behavior remains direct evidence; preferences do not authorize downstream operations. |
| Q43 Rendering/layout/search/metrics/site | Actual production-context/browser/layout and generated site-content tests exercise rendering, search projection and published content. | Pixel/layout/performance/device outcomes require real rendering and supported browser/site checks; no model of every device or accessibility event schedule. |

## Responsive Office consumer evidence

Office growth uses direct geometry, projection and production Pixi browser evidence
for Q19/Q20/Q39/Q43, alongside existing Q17 creation, Q23 Inspector intent and Q42
preference checks. `officeGrowing.test.ts` covers logical room/desk/standing growth,
phone section order, complete 129-room geometry and bounded row admission near the
10000th tab, adaptive desktop columns, compact unequal-room packing and corridor
clearance at 1024/1440/3440 widths and all three alignments, cooperative immutable publication and cancellation before a stale
layout can replace the current painted revision. A separate real Pixi consumer
forces font completion without React/scroll changes and checks that the completed
paint republishes the selected connector anchor. `officeGrowing.browser.tsx`, executed by `PixelOfficeCanvas.test.ts`,
uses three hosts with colliding native identifiers and 131 rooms: it reaches tab 100,
activates its exact qualified pane, bounds mounted controls, collapses without
closing work, retains focused controls while scrolling, pages to a room beyond
128 and preserves a late room when an earlier room grows. The production transport
fixture retains its strict input acknowledgement budgets with 32,768 admitted
workspaces and 262,144 leaves across 64 hosts. Phone and desktop cases retain the
production artwork, readiness and cleanup checks. These are concrete tested
boundaries, not an exhaustive cardinality, GPU or device guarantee. The existing
Tree/Graph space-admission model retains its own bounded scope.

## Review and remaining obligations

An additional production Pixi 3440px case covers a 100-tab room alongside forty
small rooms, exact late-pane activation and collapse. The 1280px/390px cases retain
the full 131-room navigation, refresh and responsive lifecycle sequence. Control
admission is bounded by viewport area, allowing the increased visible density.

`officeBuildings.test.ts` covers nested placement, containment, qualified equal-label
hosts, independent host/room collapse, complete counts and retired-request cancellation.
Dedicated real Pixi host cases at 390/1280/3440 widths verify focus and summary
retention, cross-host isolation, restored room choices, navigation into a hidden
host and unchanged native contents/terminal activation.

Room-shape and retained-cavity regressions cover gaps a contour-only placement
loses, using readable column candidates without changing qualified/native order.
The production fixture checks that the separate navigation row is absent and the
existing shell search can expand/reveal exact rooms, page bounded results and
open an idle agent's qualified terminal. Its refresh case preserves a room header
below the viewport origin as well as logical desk/standing rows.

Wide-screen fluidity has a two-host, fourteen-workspace regression that reproduces
unused horizontal space, then checks occupied width, reduced scene depth,
containment and non-overlap. A dedicated real 3440px Pixi case verifies the same
outcome through production preparation/paint. A single large-workspace case
checks that usable width reduces desk rows. Carpet, wood and asphalt material
consumers cover exact floor bounds at DPR 1/2 and constant preparation work for
large logical areas. These are direct rendering/layout alternatives; no global
packing optimum or native topology mutation is claimed.

Phone Office prioritizes qualified receptions with waiting/completed agents above
Economy and Workforce; empty receptions are hidden on phones, and workspace rooms
follow Workforce. Growing geometry and real Pixi phone consumers cover ordering, complete
reachability, and qualified late-pane activation after this presentation reorder.

Evidence statuses describe concrete decisions; independent acceptance is recorded separately. Review 5516249164 accepts every Q01–Q43 bounded mapping and alternative. Mandatory consumers and excluded claims remain binding. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding. Review must inspect the intended requirement, model/reducer domain, adapter fidelity, actual consumer tests and excluded claims. Q21 has its separate bounded exhaustive contract. Q26–Q28 retain their separately accepted Ranger storage/permission assumptions.

No temporal progress proof has been added. Successful reachability witnesses show that a tested path occurs; they do not establish eventual completion for all schedules. Scheduler/deadline regressions are bounded implementation evidence with their stated transport/storage assumptions. Additional fairness assumptions need an explicit requirement and review before introducing temporal properties.

Phone summary-board geometry is checked across 240–720 px: readable boards share
width when they fit and wrap otherwise, with exact drawing bounds and content-derived
lobby height. The production phone Pixi consumer checks the side-by-side arrangement
between attention receptions and workspace rooms without horizontal scene overflow.

Completed building fits retain a height-first candidate and an alignment-aware
candidate, choosing by final height and then fragmented vertical bands. The growing
geometry regression verifies a 5×1 strip becomes 3×2 while a lower four-desk room
becomes 4×1 at equal building depth. The production two-host Pixi fixture includes
the creation desk, verifies the five-desk grid, and allows a four-desk room beside
the top row when that is the tighter fit. Dense preparation remains cooperative.
