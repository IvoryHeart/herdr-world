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
| Q16 Resource caches | Runtime currency remains the cache admission identity. File Explorer regressions independently reject retired prefetches and in-flight previews while preserving healthy contexts. Models: browser-preparation, runtime-leases. Selected agent-worktree identities/revisions now separate RPC/HTTP roots and caches; stale-occupant and real linked-Git tests cover the adapter. Actual Inspector tests reject delayed old-binding previews and callbacks across same-path root replacement while retaining path preferences. | Browser focus generation, transport epoch and runtime generation remain different tokens; the model is not a proof of every resource-cache callback. |
| Q18 Watchlists | Runtime retirement and observation epochs establish producer boundaries; real watchlist tests enforce exact identities, bounded/idempotent admission and old-revision/reconnect behavior. Models: runtime-leases, browser-refresh. | Watchlist revision is independent of observation epoch; its real store mutation/revision tests are mandatory consumers. |
| Q19 Presentation capacity | Real allocation is compared with the independent exhaustive finite allocator across 5,103 configurations and six asymmetric host orders. Tree/graph tests retain ancestor reservations and projection capacity. Models: space-admission. | Finite three-host allocation does not prove arbitrary tree/graph projections or all capacity domains; projection integration remains necessary. |
| Q20 Shared entity identity | Real object preparation and allocation preserve qualified host identity; object/tree tests check dense cancellation, colliding IDs and ancestry projection. Models: browser-preparation, space-admission. | Model preparation uses small synthetic topology; dense cardinalities, labels and layout require implementation/browser tests. |
| Q25 History/task/checkout reports | Captured runtime authority applies to checkout report reads. Real history/task parsers and checkout tests check transcript order and exact live session identity. Codex protocol/inference/cache fixtures directly exercise complete bounded discovery, visible-pane uniqueness, recent unloaded competitors, freshness, evidence changes, title precedence, contradictory reports, batched final snapshots, unavailable backoff, connection/generation isolation and refusal of inferred message/answer authority. Compressed Codex fixtures cover local/SSH representation changes, plain-file precedence, duplicate rejection, bounded decoded prefixes, malformed data and original exports through History/Chat handlers. Claude SSH fixtures exercise production POSIX discovery/stat/read payloads on a disposable filesystem with synthetic Herdr read/send/receipt and stale-session guards, refusing duplicate or malformed results and isolating connection targets. This is adapter evidence, not native SSH/Claude acceptance. Models: runtime-leases. | Session identity is a distinct consumer guard; parsing external formats and evaluating inference evidence use direct protocol/fixture tests, not a manager guarantee. Unseen clients can make a daemon guess wrong. A guess never proves client identity, cannot send or answer, and cannot persist a link. |
| Q32 File search and annotation drafts | Runtime-qualified late-result admission is the shared rule; real File Explorer tests exercise retired prefetch/preview and annotation tests retain durable checkout identity and stale anchors. Models: browser-preparation, runtime-leases. | Draft persistence intentionally uses durable checkout identity rather than transient generation; glob expansion and anchor reconstruction remain pure/fixture tests. |
| Q37 Whole-service startup/shutdown | Manager shutdown prevents new starts and drains retained owners. Startup/shutdown tests verify listener availability, one shared drain and forced exit deadline. Models: runtime-control, runtime-drain. | Actual listener/process/service-manager lifecycle and forced-exit policy are integration/platform evidence; models do not prove OS termination. |

### Chat source navigation (Q16)

The source-link parser fixtures cover absolute/relative paths, encoded names,
line locations, escaped filename delimiters, root filenames, whole inline-code
paths with spaces, prose exclusions and traversal refusal. Command arguments and
multiple references retain individual links and line targets. Scoped code-span
click cases cover comma/semicolon boundaries, mixed basename/path items,
no-space comma lists, executable-directory prefixes (including relative, home and
non-system absolute `bin`/`sbin` installations and virtualenv `Scripts`) and punctuation inside a
single filename. Bare names use
source/doc-format and context hints rather than linking dotted prose or code
identifiers. The real
Markdown/Inspector source-link
consumer rejects mismatched host, runtime, pane/session and missing worktree
bindings, and discards pending previews after binding replacement. Desktop and
phone Chrome fixtures use the real Chat and Inspector to open the same file at
two requested lines through a qualified agent-worktree read delayed across
equivalent fresh RPC observations. Notice replacement and the actual unbound
Spaces host retain their separate consumer assertions. These direct
consumer/browser cases complement browser-preparation and runtime-leases;
a new model would not establish Markdown parsing or CodeMirror line targeting.
Filesystem containment and symlink admission remain the existing service adapter's
responsibility and retain their current real filesystem tests.

## Direct implementation, browser and platform alternatives

| Area | Selected evidence and reason | Limits |
| --- | --- | --- |
| Q08 Terminal composition/touch/clipboard | Real xterm/browser composition, touch and clipboard transitions are the executable subject; synthetic abstract key transitions would omit the shipped core duplication that the regression reproduces. | IME/browser/clipboard behavior depends on platform events; supported browser scenarios are exercised, not every device keyboard. |
| Q09 Terminal composer and shortcuts | Pure command resolution/catalogue and qualified draft tests cover aliases, key normalization and owner identity. The real Chat wrapper DOM consumer activates production connection/runtime scopes, covers managed and legacy epochs, retirement, IME-safe Ctrl/Cmd+Enter send, multiline Enter, overflow command browsing, isolated drafts and transactional refusal restoration. The maintained AgentChat browser consumer covers qualified sends, attachment retries, pasted screenshots and sending their paths with secure-context-only APIs absent; source race tests cover native queued admission and unchecked slash-command receipts. | No abstract shell semantics or automatic command execution is claimed; terminal dispatch authority is covered separately. |
| Q10 Aggregate observation | Real snapshot tests exercise retirement during construction, expired catalogue scheduling, failed-host stale topology and healthy sibling publication with bounded synthetic transports. | Snapshot integration is the selected consumer evidence for manager authority; no exhaustive claim over arbitrary host topology or transport schedules. |
| Q11 Observation scheduling | Real controlled scheduling tests exercise 32 hosts, three stalled priority owners, slot release, repeated invalidation rotation, overlapping priorities and cached hosts without refetch. | These are explicit adversarial scheduling scenarios, not a liveness proof. Eventual progress assumes completed transport turns; stalled-owner deadlines and capacity remain implementation tests. |
| Q22 Tab/pane layout, pins and reorder | Direct pure layout/pin/reorder tests plus queued visible-layout retirement tests cover owner-keyed state; Q21 adds bounded window reducer exploration. | All tab cardinalities and asynchronous native layout responses are not exhausted; captured generation checks retain their implementation regressions. |
| Q24 Desk receipts and review marks | Fixture receipts retain their tests. Shared service metadata adds direct bounds/expiry/conditional-Undo and session-replacement tests; captured-lease RPC tests, two-WebSocket service tests, cross-browser Desk UI tests and deferred revision/socket-epoch schedules check the real producer and consumer boundaries. Fresh-observation callback admission remains covered by Q10. The 41-agent paired registry/store projection checks marks in both directions with unequal polling coverage, filter changes and later native activity/stops. Native progress counters from the already-fetched agent.list rows detect complete turns between snapshots, including after observation expiry; pane-only harness/session identity and matching metadata keep observation aligned with browser projection and RPC admission. Missing pane identity is never supplied by an agent row; qualified adapter and snapshot wiring cases reject ambiguous or stale progress. Stable stop IDs keep unchanged Done and Idle review marks across 13-hour display-time expiry; the real browser consumes expiry and new-stop publications. Deferred RPC cases fence session replacement, return to an original fingerprint and bounded-observation eviction; the actual Desk browser checks next-card focus for keyboard and button marks when publication precedes the awaited continuation. Real receipt/browser consumers include stable stop IDs in refresh and currency, reject late preceding-stop reads, keep marking disabled through pending/first failed refresh, and discard the old report when repeated failure settles as unreadable. Expiring only a display time does not refetch an unchanged stop. | A summary is presentation evidence, not proof that external work succeeded. The finite metadata rules are tested directly; this adds no claim of arbitrary transport liveness or authenticated user identity. |
| Q29 Task notifications and Web Push | Real notification listener/push tests and durable task notification tests exercise session-safe clicks, endpoint validation and persist-before-dispatch/dedup across restart. Finite harness-support cases and the real shell handoff consumer cover the Agents open preference and Terminal fallback using the admitted pane, including qualified sibling-host Spaces routing and an agent omitted from the aggregate view. Immediate refusal preserves the current Inspector; a session turnover during queued admission restores it unless another user action replaced it. A delayed older Beta request cannot retire, focus or activate after newer Gamma admission; native-queue and post-focus cancellation cases exercise the same captured request guard. The real hook and admission helper also cover an older retirement followed by an unavailable, session-refused or focus-refused successor: the original Inspector returns, a newer user selection is preserved, and successful Gamma presentation survives the canceled predecessor. Existing runtime/session replacement and navigation-retirement cases retain the authority boundary. | Presentation preference adds no new ownership or recovery protocol, so direct consumer cases complement the existing admission tests. Dedup is scoped to recorded occurrences/sessions; it does not make external push delivery exactly once. |
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

Direct exhaustive and service evidence fits these pure finite validation rules
and the existing atomic Board write. No new scheduling or authenticated caller
protocol is introduced. Board/Town browser checks remain necessary for real
layout and gesture outcomes. This does not prove human-only role editing,
permanent audit retention, or future Groups CLI/roster behavior.

### Mobile Board Work controls (Q43)

The control policy comes from the owner/PM/design ruling: Work remains first and
labelled, note strings retain their own action (including zero), and overflow
removes Notes before Fit and zoom without wrapping. Direct finite tests cover
every available width from 128 to 800 for phone/desktop and zero/nonzero counts,
retaining each action exactly once. Production uses actual measured control
widths on resize and font/count changes, outside the frame/physics loop. The real
Board browser consumer sets and asserts actual 320/360/390/430/1440 CSS-pixel
viewports through Chrome device metrics (window-size alone clamps at 500), with
focus emulation for native note blur, and checks reduced motion:
label/order/touch height and hit testing, one-row bounds, Work opening Pull requests, zero-count
empty tray and a detached string's distinct tray action. Existing Board tests
retain Tidy/undo and note reattachment. This is a presentation projection over
existing callbacks, not a new movement/authority protocol. Five-view screenshots
and the normal delivery gate remain delivery acceptance. The owner-context gallery
also covers 390×844, 1512×982, 1280×1440, 2560×1440 and 1440×2560; narrow
phone checks remain at 320/360/430 pixels. The owner's private mobile
image and authenticated PR-list contents are not public verification fixtures.

## Review and remaining obligations

Evidence statuses describe concrete decisions; independent acceptance is recorded separately. Review 5516249164 accepts every Q01–Q43 bounded mapping and alternative. Mandatory consumers and excluded claims remain binding. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding. Review must inspect the intended requirement, model/reducer domain, adapter fidelity, actual consumer tests and excluded claims. Q21 has its separate bounded exhaustive contract. Q26–Q28 retain their separately accepted Ranger storage/permission assumptions.

No temporal progress proof has been added. Successful reachability witnesses show that a tested path occurs; they do not establish eventual completion for all schedules. Scheduler/deadline regressions are bounded implementation evidence with their stated transport/storage assumptions. Additional fairness assumptions need an explicit requirement and review before introducing temporal properties.

### Reviewer RESULT evidence (Q43, #369)

A crew reviewer name is an explicit sender claim, never a verified principal
from a shared GitHub login. Unknown RESULT posts remain separately source-keyed
and linked; an older or later named clear cannot erase that evidence. Reviewed
heads require formal commit metadata or a unique explicit SHA. Ambiguous or
conflicting claims and stale heads cannot establish current-head readiness.
Open findings take precedence over unknown evidence, and unknown attribution
cannot establish clear.

Direct fixtures in `server/src/sources/pullRequestReviews.test.ts` and
`pullRequestDetail.test.ts` exercise canonical and current legacy posts,
quoted/author replies, shared-login refusal, distinct unknown sources, explicit
correction, latest named results, SHA ambiguity/conflicts and typed open counts.
Canonical and formal-current records also carry historical RED/comparison SHAs;
those references cannot supply or contradict an actual reviewed-head claim.
`shared/pullRequests.test.ts` covers readiness precedence; browser decoder and
static review rendering tests cover retention and useful unknown source links.
These are bounded pure parsing/projection rules, so a state model would repeat
the implementation boundary. Existing PR action tests retain browser-only,
confirmed exact-head admission. Real GitHub pagination/completeness and live
browser interaction remain excluded from this local fixture evidence; the
closing batch gate, site build and consumer/CI checks remain required.


### Harness readiness (Q01, Q43)

Only a complete executable lookup may confirm absence; only recognized native
status may confirm sign-out. Failed/partial/unsupported observations stay
unknown, and a retired connection generation cannot publish or retarget a
probe. These properties come from the qualified runtime and readiness contract,
not from treating every CLI exit as authentication evidence.

`harness-readiness.test.ts` uses synthetic processes/records for the parsing and
failure boundary. `launcher-probe.test.ts` exercises captured host, discovery
and process retirement plus actual RPC replies through the qualified publisher.
`shared/harnessReadiness.test.ts`, `agentProfiles.test.ts` and the readiness
summary's static-markup tests exercise safe wire normalization and presentation.
The existing runtime-leases model covers authority; finite parser/consumer
fixtures are the direct alternative for external status formats. This does not
prove every CLI version, native account/SSH outcome, or viewport interaction;
platform/browser checks and the batch's complete gate remain required.


### Failed-host cache and SSH recovery (Q02, Q03, Q43)

A lifecycle report may retire only its exact connection/generation; cached data
must stay stale and non-actionable during discovery and after an older response.
A later ready status is insufficient to restore actions without a fresh admitted
snapshot. Direct invalidation/runtime-store, Board projection/defer and Town
open/motion tests exercise these presentation and consumer boundaries. Existing
runtime authority models remain unchanged; native availability is not inferred.

Profile-service controlled timers exercise default recovery through eight
classified transient failures followed by success, with bounded exponential
jitter, stable healthy siblings, explicit finite retry policy and stop/remove/
replacement/cleanup cancellation. Continuing default retry does not establish
infinite progress or model OS/network failure. Static markup/injected recovery
verbs check explicit truthful controls; real viewport and SSH outcomes remain
closing browser/platform acceptance. See coverage.json for the required tests.

`ssh-preflight-recovery.test.ts` exercises the actual remote HOME discovery,
subprocess error boundary and profile scheduler together. Synthetic local child
processes return eight exit-255 timeouts before success; forwarding and socket
readiness are simulated. Permanent authentication/host-key failures, non-255
exits, invalid HOME output and arbitrary timeout-looking errors cannot acquire
retry. Disconnect/removal fence queued callbacks and in-flight results without
replacing a healthy sibling lease. `process-utils.test.ts` checks structured exit
facts and unchanged messages without serializing captured output. These direct
fixtures extend the existing classification consumer mapping, not its model or
generic-error allowlist, and do not establish live SSH availability, version skew
or an owner's viewport outcome. The closing batch retains full-gate acceptance.

### Native plugin fixture lifecycle (Q36)

The native compatibility fixture awaits the existing bounded, yielding cleanup
after its body settles. Persistent and nonretryable cleanup failures remain
fatal; a dual failure retains the original body and cleanup errors, rather than
letting a finally exception hide an assertion. Direct portable lifecycle tests
and controlled transient/persistent filesystem denial exercise this test-harness
boundary. Existing Windows held-file tests and the HTTP/HTTPS compiled fixtures
supply separate native evidence. No installer policy, model, production launcher
or release authority changed. Local filesystem fixtures do not identify the
lock holder in an earlier Windows run or establish that run's body succeeded.

### Committed Town building signs (Q39, Q43)

Sign refs register only committed DOM nodes and request a renderer frame. Their
registration identity prevents a retiring ref from removing a newer node for the
same host. Pure lifecycle and isolated React DOM tests cover cold commit,
status-only ref stability, culling/remount, late cleanup and suspended renders
that never commit. Roof opacity continues to come from the normal renderer.
The maintained Town browser suite includes phone/wide cold-mount and camera-cull
cases that require visible failed/healthy building signs and receptions without
changing topology or overriding CSS. These browser cases require closing-batch
execution; DOM fixtures alone do not establish pixels, camera/GPU behavior or the
unchanged 200 ms responsiveness budget.

### PR detail freshness (Q43, #372)

Successful list reads do not renew detail authority. Exact head/list-stamp
matching, a bounded original read/expiry time and complete detail coverage are
required; expired, failed, partial and deferred detail cannot pass findings or
screenshot readiness or admit a merge. Cached links remain qualified display
evidence. Source reconfiguration isolates cache writers, and a generation or
expiry change during the live native pre-merge check prevents dispatch.

Injected clock/process regressions in `pullRequestFreshness.test.ts` exercise
expiry plus failure, unchanged cache reuse, changed head, null/missing sections,
partial batches, recovery, 10/20 bounds and unread-tail ordering, disable/window
reconfiguration cache races, source failure and pre-merge expiry/retirement.
Shared wire/readiness and browser decoder/static card fixtures independently
check malformed qualification and stale-versus-current presentation. Existing
isolated mounted-card expiry tests advance the observing clock and invoke its
scheduled deadline without another source snapshot: readiness and fresh detail
presentation retire, an open merge sheet closes, read provenance stays unchanged,
and unmount cancels the deadline. These are actual React consumer checks; the
service retains its independent expiry and native admission checks. Existing
native review/head action tests remain mandatory. This bounded cache/projection
boundary is directly exercised with controlled clock/deferred responses rather
than a new model that duplicates those external-format rules. It proves no
complete GitHub history, network liveness, or operation rollback after native
dispatch; full behavioral verification and browser/CI acceptance still apply.


### Mobile transport presentation (Q06, Q07, Q08, Q16, Q43)

A transport epoch retires operational authority without retiring a same-runtime
presentation. Fresh catalogue admission governs owner removal and generation
replacement; a newly completed qualified focused list governs resource absence.
No terminal input or uncertain mutation is replayed, and the no-frame watchdog
has no automatic navigation action.

`WorldTerminalHandoff.test.ts` exercises the production React tree through
incomplete catalogue, unavailable owner and reconnect sequences, retaining
Inspector and split-renderer identities, and retiring only a replaced host.
`mobileTerminal.test.ts` checks last-frame retention, retired push callbacks,
one listener set after reconnect, input suppression, three no-frame failures
and explicit local retry at both phone widths. `WorldInspectorWorktree.test.ts`
preserves cached previews through an outage while still fencing same-path
worktree replacement. `WorldInspectorResourceResume.test.ts` mounts the real
Inspector, Files/Changes children and gate, retaining three file rows through
null worktree binding and delayed same-target readmission, while rejecting
late old-binding responses after replacement. These runners are explicitly
mapped to Q06, Q07, Q08, Q16 and Q43 in `coverage.json`. Layout, endpoint-presentation and recovery unit tests
cover exact geometry owners, stale parser completion and bounded retry budgets.
These direct browser and consumer checks are needed for DOM lifetime and event
timing; the existing ownership models and their mandatory consumers remain
binding. Real OS page discard, every mobile scheduler and cross-reload UI
restoration remain outside this evidence.

### Missing-only Herdr installation (Q36)

The generated World formula has no mandatory Herdr dependency. It installs only
World and a launcher into its keg. Normal local startup uses the compiled
runtime's read-only status lookup to preserve any existing Herdr, regardless of
version or installation owner. A missing runtime uses a generated Unix bootstrap with the verified release's
pinned SHA-256 and version. It rechecks discovery after download and publishes by
an atomic hard link that cannot replace an existing file, symlink or directory.
This compatibility path supports the immutable 0.2.7 binary without calling its
upgrade command. The standalone installer probes CLI capabilities: it uses the Unix
`--install --only-if-missing` operation when supported and the same compatibility
bootstrap for pinned older binaries. Its self-contained generated block is checked
against the canonical shell and verified metadata. A strict 0.2.7 fixture rejects
the new flag and must still end with an executable Herdr. Explicit installations
and bootstrap diagnose a blocking non-executable entry without modifying it or
repeatedly downloading. Discovery's installed label alone is not admission:
`assertHerdrBinaryRunnable` validates the selected CLI path, and the shared shell
presence check validates the exact selected path from status before early success.
The standalone presence check runs before capability selection, so a reachable
server without a discoverable binary also prevents a second installation. Explicit
upgrades retain their behavior. Metadata,
management and remote/custom-endpoint invocations do not bootstrap. A failed
check or installation warns with retry/opt-out guidance and still starts World,
so remote profiles and in-app setup remain available.

`scripts/generate-homebrew-formula.test.ts` executes the generated Ruby install
method and emitted shell launcher. Its process matrix covers older/current/newer
and externally managed runtimes, missing installation, detection/install failure,
metadata/management calls, remote configuration and opt-out. Controlled schedules
publish older/newer runtimes after status, during download and after the final
lookup; atomic publication preserves them. Checksums and version failures warn
and still start World. The checksum test tampers with a version-valid payload,
and disabling checksum admission independently fails that regression. `server/src/herdr/missing-install.test.ts` independently
exercises the real CLI/upgrader, concurrent installers, PATH discovery and late
file/symlink publication. The standalone
installer regressions independently cover missing-only behavior and owner/version
preservation. These direct process alternatives test the actual shell/Ruby paths;
an abstract model would not establish PATH detection or package ownership.
`scripts/herdr-bootstrap-discovery.test.ts` runs the real discovery and CLI status
producer for default, PATH and explicit candidates (directory, non-executable and
executable controls), and for a running server with no binary. It requires warnings,
no downloads, preserved entries and World startup for blocked paths. The standalone
regression separately records that running status skips the new CLI operation.
The archive-stage check validates the launcher and World inputs. The tap and
Release native CI use `scripts/check-homebrew-runtime.rb` to launch a temporary
World listener, install and execute a missing real Herdr, then reinstall World and
confirm that the existing external runtime's digest stays unchanged. Herdr's server
is never started by bootstrap. Native acceptance belongs to the exact CI head;
Linux harness results alone do not prove native Homebrew installation acceptance.

### World update notification lifetime (Q36)

Browser-origin/profile notification history is separate from the current update
installation offer. Maintained history and store tests cover repeated/manual
checks, simulated page reinitialization, later versions, restricted storage,
dismissal, disabled automatic checking, failed installation retry and successful
installation clearing. `updateNotification.browser.tsx`, selected by
`uiScale.test.ts`, exercises the real App/Toast/Menu at the five reference sizes,
including accessible attention, visible Upgrade, a blocked channel and the
existing explicit install request header. These bounded UI/storage transitions
use direct tests rather than an OS update model. Fake update replies do not prove
native replacement/restart; existing server/native platform checks remain binding.
The review-repair browser cases add an actual IndexedDB read/write interleaving
and two independent same-origin contexts with exactly one winner, plus actual
menu rechecks with polling disabled and rendered mobile channel guidance. Held
pre-install replies (both available metadata and HTTP errors) cannot replace a
successful-install state; later checks remain admitted. Persistent-storage denial
retains only best-effort legacy markers and page-lifetime deduplication, while a
slow persistent claim fails closed instead of racing a fallback.

## Owner asks extension (#472)

The existing World question ledger remains the system of record. Direct CLI and
service regressions cover caller-scoped cause keys, withdrawal authority, answer
preservation and wait cancellation. The watcher consumes it through the CLI and
uses its existing action ledger only for receipts; crash/retry, one answer read,
same-head clearing, blocked-seat recovery and held/scoped PR cases are exercised
through that real seam. Qualified-target and queue/marker tests plus actual Town,
Board and Desk browser suites cover the presentation. Notification tests bind the
original terminal/session, reject a reused pane, suppress initial-backlog and
duplicate announcements, reject obsolete socket replies, and retain local OS
notices when Web Push is selected. These are finite ledger and direct consumer
schedules; a separate model would duplicate those rules. Existing endpoint,
lease, navigation, browser and protected verification gates remain mandatory.
No OS delivery while every browser is closed is claimed by client announcements.

Review-repair cases cover lost creation or recreation replies followed by a
cleared cause, successful withdrawal with a lost reply followed by recurrence,
permanent refusal retired with one feed explanation, and answer read-back once.
Acknowledged-answer variants cover lost replies, process crashes and withdrawals
that never reached World. Pending recreation followed by a hold, scope removal or
head replacement retains its receipt without reading the old answer again.
Legacy superseded rows without receipts make no CLI call or feed entry; keyed
not_found cleanup never claims that the old occupant's question was withdrawn.
These bounded schedules consume the real watcher store and existing CLI seam.
The real CLI/ledger tests check self-scoped withdrawal by key without creation,
retained answered repeats and explicit human withdrawal output. A real projection
with six finishes checks shell-question priority, and the Town browser consumer
checks its bounded reception entry and single-action original-terminal route.

Placed, named and dismissed asks (#493) stay on the same ledger. A caller the
service cannot verify keeps an unverified actor, no cause keys and the shared
allowance; the service records its claimed pane's connection, runtime, terminal
and session only when exactly one local Herdr has that pane, so remote, unknown
and ambiguous claims stay in the question list. Owner dismissal is a closed
state beside answer and withdrawal: service, CLI and watcher cases check that
waits end, answers are refused, a keyed repeat returns it until the asker
withdraws, and the watcher does not re-ask a dismissed cause. The service asks
Herdr before its synchronous cause, allowance and insertion step, and a
slow-Herdr case checks concurrent keyed repeats and the shared allowance. Rail markup, pure
naming and the Town browser consumer check one unverified mark, Open agent, and
reception clearing on Dismiss without an answer. These are finite ledger states
in the existing consumers; no model or new authority is claimed.


### Browser startup and ask notification composition

Fresh-process coverage initializes browser storage, imports the asks model first,
and then requires application state and its saved notification preference to load.
The real `main.tsx` entry also runs through Vite in Chrome with isolated synthetic
proxy endpoints: uncaught startup errors, rejected imports and ErrorBoundary output
fail acceptance before the mounted shell is credited. Both checks reproduce the
reported initialization failure before repair. Late notifier installation on the
existing shared model retains quiet backlog loading and one announcement per new
ask; the existing notification-policy consumers retain runtime/session authority.
These are direct JavaScript/module and browser consumers, with no abstract-model
claim about arbitrary import graphs or live external runtimes.

### History input and mobile shell launches (Q09)

History Details Chat shares the terminal's in-memory runtime-qualified draft and
submission lock. AgentHistoryComposer DOM regressions cover image-path recovery,
IME, touch release, failure restoration and a separate busy-agent confirmation.
The AgentHistoryDrawer browser consumer deliberately gives the transport epoch
and admitted runtime different numbers: History must read the terminal draft,
send once to its captured pane, and refuse/restore after client retirement.
AgentLauncher DOM and TerminalView input-mode consumers cover target replacement,
per-connection saved commands, single-line validation, empty-draft admission,
exactly one command with Enter and recovery after failed sends in both input modes.
These direct native-input consumers extend Q09's accepted alternative; no abstract
shell-execution guarantee is added. Q25's conversation fingerprint, read-only Codex
inference and receipt boundaries remain mandatory for primary Chat.
