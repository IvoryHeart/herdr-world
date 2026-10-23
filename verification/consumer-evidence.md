# Consumer and alternative evidence decisions

This reconciles the remaining baseline entries without treating a component model as a proof of its consumers. Each decision names the required real tests in `coverage.json`; existing accepted-delivery CI is baseline execution evidence. New candidate execution is reported in PR #188 and source-bound manifests. Environment-gated live/OS checks retain their prerequisites and may not be reported as locally executed. All Q01–Q43 mappings and alternatives are independently accepted in review 5516249164 within their stated bounds. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.

## Shared model consumers

| Area | Mapping and required consumer evidence | Limits |
| --- | --- | --- |
| Q02 Profile service and persistence | Manager replacement and drain guarantees are consumed by profile persistence/retry admission; real profile tests retain default persistence, rollback and cancellation during cleanup. Models: runtime-control, runtime-drain. | Persistence atomicity and retry clock/jitter remain real integration evidence; manager readiness alone does not prove catalogue consistency. |
| Q03 SSH supervision | Manager currency and drain fence late transport completion. Real supervisor/tunnel tests exercise process exits, cancellation, reconnect classification and private path ownership. Models: runtime-leases, runtime-drain. | Real OpenSSH, OS process and Windows transport semantics remain platform checks; the manager model does not simulate SSH. |
| Q04 Subscriptions | Retired manager owners cannot publish readiness. Subscription tests independently exercise stop-before-ready, stop-during-retry, coalesced drain and callback suppression. Models: runtime-leases, runtime-drain. | Subscription retry progress requires actual timers and transport behavior; model producer guarantees do not prove callback consumers. |
| Q05 RPC/HTTP routing | Qualified manager leases supply dispatch authority. Protocol and HTTP tests check malformed/stale generations, explicit rejection, legacy omission and cancellation of stale streams. The session-link routing fixture combines the real manager, RPC dispatcher, runtime handlers and filesystem lookup with a synthetic external transport; identical pane IDs stay isolated, and replacement during confirmation or immediately before transport dispatch cannot report a link. Models: runtime-leases, runtime-control. | No model substitutes for endpoint parsing or HTTP stream cancellation; legacy compatibility is scoped separately from explicit admission. |
| Q07 Terminal input/reconnect | Real Bridge replay covers transport retirement and late-socket replies; creation replay covers uncertain dispatched mutation without retry. API and terminal recovery tests supply input-specific consumers. Models: chunk-assembly, creation-flow. | Creation is not a model of terminal bytes or resume clocks; uncertain input, compressed frames and browser lifecycle remain direct/browser tests. |
| Q15 Focused operational contexts | Captured owner/generation and colliding native IDs are exercised through real store/Bridge replay. Store and concurrent-context tests verify inactive-host operations and context isolation. Models: creation-flow, browser-preparation. | React context binding and all operation kinds remain actual consumer tests; generic readiness is insufficient to select an operational target. |
| Q16 Resource caches | Runtime currency remains the cache admission identity. File Explorer regressions independently reject retired prefetches and in-flight previews while preserving healthy contexts. Models: browser-preparation, runtime-leases. | Browser focus generation, transport epoch and runtime generation remain different tokens; the model is not a proof of every resource-cache callback. |
| Q18 Watchlists | Runtime retirement and observation epochs establish producer boundaries; real watchlist tests enforce exact identities, bounded/idempotent admission and old-revision/reconnect behavior. Models: runtime-leases, browser-refresh. | Watchlist revision is independent of observation epoch; its real store mutation/revision tests are mandatory consumers. |
| Q19 Presentation capacity | Real allocation is compared with the independent exhaustive finite allocator across 5,103 configurations and six asymmetric host orders. Tree/graph tests retain ancestor reservations and projection capacity. Models: space-admission. | Finite three-host allocation does not prove arbitrary tree/graph projections or all capacity domains; projection integration remains necessary. |
| Q20 Shared entity identity | Real object preparation and allocation preserve qualified host identity; object/tree tests check dense cancellation, colliding IDs and ancestry projection. Models: browser-preparation, space-admission. | Model preparation uses small synthetic topology; dense cardinalities, labels and layout require implementation/browser tests. |
| Q25 History/task/checkout reports | Captured runtime authority applies to checkout report reads. Real history/task parsers and checkout tests check transcript order and exact live session identity. Codex protocol/inference/cache fixtures directly exercise complete bounded discovery, visible-pane uniqueness, recent unloaded competitors, freshness, evidence changes, title precedence, contradictory reports, batched final snapshots, unavailable backoff, connection/generation isolation and refusal of inferred message/answer authority. Models: runtime-leases. | Session identity is a distinct consumer guard; parsing external formats and evaluating inference evidence use direct protocol/fixture tests, not a manager guarantee. Unseen clients can make a daemon guess wrong. A guess never proves client identity, cannot send or answer, and cannot persist a link. |
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
| Q43 Rendering/layout/search/metrics/site | Actual production-context/browser/layout and generated site-content tests exercise rendering, search projection and published content. ConcurrentContexts checks phase-specific terminal lifetime and stable Board card observer registrations during status-only refreshes at desktop and phone widths; direct ref tests cover replacement, removal and abandoned renders. | Pixel/layout/performance/device outcomes require real rendering and supported browser/site checks; no model of every device or accessibility event schedule. |

### Stored Groups (Q43)

Properties come from the Stored Groups requirement: pooled lead/builder roles
belong to one Pod per address, reviewer may span Pods, terminal Teams alone
magnetize/prune, unresolved addresses never guess an occupant, and group edits
plus bounded attribution persist atomically. `shared/groups.test.ts` exhausts
36 two-Pod role combinations and exercises canonical address scope, restart,
away/ambiguous resolution and custom-kind isolation. `board-groups.test.ts`
covers read-only legacy migration, all three conflicting-role paths and
confirmed transfer, rollback/stale revisions, member/role/participating-Pod
caps, 64-entry promotion diffs, no-op suppression and 128-event deletion
attribution. Existing relation/store/CLI tests retain terminal grouping,
pruning and undo; the browser adapter also proves Pod-only data does not scan
terminal topology or enable magnetic Ungroup.

Group read-model properties come from the Group projections and derived facts
requirement. `shared/groupViews.test.ts` enumerates all 36 pairs of the six
roll-up states and covers qualified Room/Desk projections, separate stored
refs, deduplicated members/work, away/ambiguous exclusion and generation/session
work-link matching. `shared/groupObservations.test.ts` exercises both actual
service and browser adapters against the same fixtures: current-generation
admission, canonical full agent names, replacement-session refusal, conflicting
names and no display/harness fallback. These are bounded observation and pure
projection checks, not runtime leases or a proof of source completeness.

Direct exhaustive and service evidence fits these pure finite validation rules
and the existing atomic Board write. No new scheduling or authenticated caller
protocol is introduced. Board/Town browser checks remain necessary for real
layout and gesture outcomes. This does not prove human-only role editing,
permanent audit retention, or untested Groups roster behavior.

### Shared Town move execution (Q43)

The existing Town desk/agent move contract supplies the properties: one queue
per captured connection, retired-generation refusal, topology/colour capture at
queue admission, unchanged rollback/uncertain-step behavior, and Board following
only from confirmed or positively observed topology. `town-move.test.ts` uses
the actual RPC adapter and native move functions to check the injected shared
queue, a retired queued generation, known partial-failure reconciliation,
unknown topology without retry/anchor guessing, and the original ordering of
Board following outside the move queue. Existing `desk-move.test.ts` retains
the full native move/rollback fixtures. The fixture was moved unchanged to a
shared test helper. These controlled promise schedules and actual transformations
are direct bounded adapter evidence, not a general temporal progress proof.

### Group CLI and shared Town moves (Q43)

The CLI's allowed/forbidden cases follow the stored/projected Group ownership
requirements: aliases do not change kind, ambiguous names never choose a member,
lead/builder transfers need explicit confirmation, and promotion requires every
terminal-to-address mapping. `world-cli-groups.test.ts` exercises the actual
service edits, retained deletion attribution and role preservation;
`cli/world-groups.test.ts` checks parser intent and preview-before-mutation output.
These edits have recent Group attribution rather than Board ledger undo. Markdown tests add explicit table parsing/escaped rendering and actual service all-or-none import, existing-name refusal, role-conflict rollback and sender attribution; the CLI test proves only the selected file is read and piped Markdown stays Markdown. No file watcher or resynchronization is introduced.

`group-move.test.ts` drives the real native move orchestration and the actual CLI
HTTP service. A controlled queue blocker demonstrates the same injected queue as
RPC, changed occupants refuse before any move, retired queued leases make zero
Herdr calls, and terminal witnesses refuse changes after preflight. Known partial
failure reconciles Board anchors from observed terminals; lost replies with
unreadable topology return Unknown without retry. `town-move.test.ts` retains
queue-versus-Board-follow ordering checks, while native desk/pane tests retain
rollback, last-room consent and uncertain-step contracts. Source roll-up tests
distinguish current, stale and unknown work so unavailable counts cannot claim
a confirmed limit warning.

Direct finite cases and controlled promise schedules are the proportionate
alternative here: they execute the production transforms and adapters, rather
than modeling a duplicate CLI parser. This does not authenticate sender claims,
prove every external Herdr interleaving, or extend the bounded history into an
audit. The revision-only publisher extraction has no contract impact: it preserves the exact type/revision payload, explicit send context, synchronous error behavior and live client iteration. Full required registry/consumer verification remains a batch-close check.


## Review and remaining obligations

Evidence statuses describe concrete decisions; independent acceptance is recorded separately. Review 5516249164 accepts every Q01–Q43 bounded mapping and alternative. Mandatory consumers and excluded claims remain binding. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding. Review must inspect the intended requirement, model/reducer domain, adapter fidelity, actual consumer tests and excluded claims. Q21 has its separate bounded exhaustive contract. Q26–Q28 retain their separately accepted Ranger storage/permission assumptions.

No temporal progress proof has been added. Successful reachability witnesses show that a tested path occurs; they do not establish eventual completion for all schedules. Scheduler/deadline regressions are bounded implementation evidence with their stated transport/storage assumptions. Additional fairness assumptions need an explicit requirement and review before introducing temporal properties.
