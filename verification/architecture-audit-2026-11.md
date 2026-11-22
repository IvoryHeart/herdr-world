# November 5–19 architecture audit

Audited `b425b2099`'s `origin/main` first-parent history, selecting every commit
whose **diff against its first parent** touches `server/src/` or `web/src/`, from
2026-11-05 00:00:00 UTC through 2026-11-19 23:59:59 UTC. There are **85** rows,
including fixture/test/documentation commits touching those trees; the issue's
approximate 76 product changes is not used as a filter. Merge commits are one
row each, squash commits one row each; constituent branch commits are not counted twice.

Spec keys: S = `world-surfaces`, F = `runtime-federation`, C =
`herdr-core-runtime`, U = `world-usage`, H = `world-harness-integration`,
D = `distribution-boundaries`, E = `world-effects`, A = `ask-answer-delivery`,
all under `openspec/specs/<key>/spec.md`. “Existing” means current specs on the
audited base already cover the contract; “added” names synchronization in this PR.
“none” means no new contract, not absence of existing tests or requirements.
O/W/A/R = ordering / ownership / authority / recovery. Unit/DOM tests are example
evidence unless explicitly called exhaustive; browser/platform names do not
claim those suites were rerun by this audit. Q IDs resolve in `coverage/`.

The audit found two real bugs: [offline connection lost updates (#1084)](https://github.com/IvoryHeart/herdr-world/issues/1084)
and [stale Claude tap publication (#1086)](https://github.com/IvoryHeart/herdr-world/issues/1086).
Both are `crew:ready`, with production traces. Neither is hidden by a new safety
claim or fixed by an out-of-scope protocol rewrite.

Subsequent repair #1086 replaces Q55's diagnostic with positive model and
real-filesystem conformance across eight live/dead writer schedules. Its original
counterexample remains a rejected fault control; the tables below retain the
audit-time findings. See [the current tap contract](contracts/claude-tap-lock.md).

| First-parent change | Contract added/changed, if any | Current spec coverage | O/W/A/R | What verifies it today |
| --- | --- | --- | --- | --- |
| `7e41a1dd3` Integrations v1: one registry and one Integrations screen (#1026) | Unified read-only integration registry and private vault | S: registry/vault (added) | W,A,R | Q58 direct unit: server/src/integrations/registry.test.ts, server/src/integrations/vault.test.ts; browser: web/src/configuration.browser.tsx |
| `c83c2af87` test: remove disk sync from churn and replay fixtures (#1058) | none — test durability fixtures only | n/a | none | unit fixture suites; no new product guarantee |
| `6e0b09a66` CI: reduce contention and report delivery health (#1032) | none — CI scheduling and fixture plumbing | n/a | none | unit: scripts/check-pr-body.test.ts; existing model replays |
| `46155de98` Core desks open on tap; New room offers recent folders; status chip is a popover (#1007) | Core desk opening, recent-folder choice, status popover | C,S (existing) | A | unit: server/src/herdr-core/operations.test.ts; browser: web/src/world/town/TownCanvas.browser.tsx |
| `b0782c15a` Hosts one tap away in the phone's corner menu (#1003) | none — phone entry for existing host controls | S: Native World shell (existing) | none | browser: web/src/world/HostsFilter.browser.tsx |
| `e5b82b7f8` Apply connection changes without restarting World (#1004) | CLI and Settings share live catalogue writer | F (existing + serialized failure/retry added) | O,W,A,R | model: Q54 connection-registry; exhaustive 48 service schedules; unit: server/src/service/connections-cli.test.ts; offline bug #1084 |
| `347a421a0` Research and design real IDE integrations for World Code view (#988) | none — IDE research/mock, no shipped integration | active world-code-view only | none | unit: web/src/testing/codeViewPrototype.test.ts |
| `176f1b841` fix(core): give new agents the shell environment (#984) | Account-shell environment; immutable tap-settings preparation | C,U (added) | O,W,R | alternative: Q56 before/after-publication retry; unit: server/src/herdr-core/shell.test.ts; real PTY: server/src/rpc/launcher-tap.test.ts |
| `97df6281a` Fix core-only first run and remove legacy World services (#986) | Core-only discovery and ownership-aware legacy uninstall | C,D (existing; discovery retry added) | W,A,R | alternative: Q56; unit: server/src/connections/first-run.test.ts, server/src/config/service-uninstall.test.ts; systemd installation acceptance |
| `9be515a61` Docs for 0.3.5: Herdr TUI and herdr-core support, simple and current (#972) | none — synchronize docs to coexisting runtimes | C,S,identity/storage/effects (existing) | none | spec validation; existing consumers unchanged |
| `57e2b2446` Town batch 2: time-of-day light, scale, atmosphere, overlays, notification sync (#954–#957, #965) | Notification restore/revocation ordering; Town decoration | S: notifications (added) | O,W,R | unit: web/src/taskPush.test.ts (held enroll then revoke), web/src/taskNotifications.test.ts; browser: web/src/world/town/TownCanvas.browser.tsx |
| `27222dd86` Town batch: quiet colour, phone layout, bus stops, post office PRs and fixes (#946–#953) | Core status/installation follow-ups; Town parcel and phone presentation | C (existing), S: projections (added) | A,R | model: Q52 core; unit: server/src/herdr-core/operations.test.ts; browser: web/src/world/town/TownCanvas.browser.tsx |
| `917c6c8aa` herdr-core: World's second runtime (#933) | Coexisting core authority, ordered mirror, kills, observe/typing, shared seen/pins | C (existing) | O,W,A,R | models: Q52 herdr-core-runtime, Q53 herdr-core-seen; framed/native/browser consumers; acceptance remains scoped |
| `f75be2561` Fix production snapshot negotiation in transport acceptance | none — production-context test negotiation repair | n/a | none | browser: web/src/world/ProductionContexts.browser.tsx |
| `b7d8cefbd` Keep the highest Claude limit reading per window; say installed vs updated vs current | Per-window Claude maxima and stale-lock recovery | U (added) | O,W,R | model/counterexample: Q55 claude-tap-lock; actual 20→23→22 trace, bug #1086; unit: server/src/usage/claude-tap.test.ts |
| `93f76ad0d` Board host label: a heading plus short summary lines | none — host summary label presentation | S: Board detail (existing) | none | DOM: web/src/world/board/BoardFacts.dom.test.ts |
| `fe761a180` fix: finish installer upgrades through the update path | Installer replacement completes update finalization | D (existing) | O,W,R | unit: scripts/install-herdr-world.test.ts, scripts/installer-upgrade.test.ts; Q36/Q41 platform boundary |
| `a751cc1c9` Fix stale usage stops after rapid local transcript rewrites | none — restores usage-stop cache freshness on rewrites | U,S (existing) | O | unit: server/src/agent/session-projection-cache.test.ts, server/src/agent/conversation-matrix.test.ts; Q25/Q38 source revalidation |
| `1815b0d9f` Keep Chat usable while the agent's worktree is re-read | none — retains Chat while worktree context refreshes | S: View-local continuity (existing) | O | unit: web/src/world/WorldInspectorChatWorktree.test.ts; creation/qualified-context consumers Q15/Q23 |
| `92100d451` site: herdr.world presents World 0.3.0 | none — site/asset presentation | n/a | none | unit: scripts/pages-content.test.ts; site browser captures |
| `84133779a` Prepare Herdr World 0.3.0-rc.1 | none — release identity and fixture updates | D (existing) | none | unit: server/src/service/shared-acquisition.test.ts; release checks |
| `090442d61` Snap fit: put a window on the left or right at its normal size | Window snap fit/restore preserves ordinary size | S: Fit and restore arrangements (existing) | W | unit: web/src/components/WorkspaceInspectorViewSelect.test.ts; browser: web/src/layerStack.browser.tsx; Q21 arrangement matrix |
| `c329d13e4` Show the Needs you count on the browser tab and app icon | Needs you count projected to tab/app badge | S: notifications (added) | W | unit: web/src/world/attentionBadge.test.ts; browser: web/src/world/NeedsYouCard.browser.tsx |
| `d811bbe25` Land #792 (command box) and #791 (search over lens) on main | none — command box/search uses existing navigation | S: Explicit destinations and command focus (existing) | A | DOM: web/src/commandBoxKey.dom.test.ts; browser: web/src/paneJump.browser.tsx |
| `f171332c0` World harness integration: Herdr-style World skill and Claude limits tap per harness (OpenSpec) | Per-harness World skills and chained Claude tap | H (existing) | W,A,R | unit: server/src/cli/integration.test.ts, server/src/cli/integration-claude.test.ts; Q35/Q38; SSH delta remains active |
| `efb291106` Let Town's Zoom in leave home when the whole town is barely wider | none — correct zoom bound at barely-overview size | S: Town zoom (existing) | none | unit: web/src/world/town/scene/townSceneCamera.test.ts |
| `7ce1bc6fa` Town expense boards: one short caveat line, explanations on hover | Town economy caveats and scope attribution | S: economy (added), U (existing) | W | unit: web/src/world/town/townExpenses.test.ts, web/src/world/town/townPlaceSummary.test.ts |
| `479f8f3f2` Fold each desktop view search into an icon | none — existing search under desktop icon | S: Search and summarize (existing) | none | DOM: web/src/world/board/useBoardSearch.dom.test.ts; browser: web/src/world/DeskView.browser.tsx |
| `15f0b14f5` fix: reconcile Town economy figures and UTC windows | none — correct UTC/scoped usage projection | U (existing), S: economy (added) | W | unit: server/src/usage/summary.test.ts, web/src/world/town/townEconomy.test.ts; Q38 numeric evidence |
| `11095a273` Agent context fill as a needs bar in Town | Uniquely attributed current context-fill observation | U: context fill (existing) | W,A | unit: server/src/usage/context.test.ts, web/src/world/agentContextFill.test.ts; Q38 exact-source tests |
| `03cdfb3d9` Town Master greets you when you come back (O1, first slice) | Once-per-visit Town Master greeting | S (existing); onboarding later slices active | O | unit: web/src/world/townMasterGreeting.test.ts, web/src/world/TownMasterCard.test.ts |
| `14f465c8e` Town: show agents stopped on their usage limit as out of fuel | Current usage-limit refusal becomes out-of-fuel state | U: usage-limit stop (added), S projections | W,A | unit: server/src/agent/usage-stop.test.ts, server/src/agent/conversation-matrix.test.ts; no inferred provider status |
| `156121342` Board: Town's room actions, Herdr order, Mark reviewed and peek | none — Board consumes room actions/order/review/peek | S: shared presentation (existing) | A | DOM: web/src/world/board/useBoardHerdrActions.dom.test.ts; unit: web/src/world/herdrOrder.test.ts |
| `07580afc3` Board: Town's lenses, Since you left and PR badges | Board shares lenses, return recap and source badges | S: projections/recaps (added) | W | DOM: web/src/world/board/BoardControls.dom.test.ts; mount: web/src/world/BoardView.mount.test.ts |
| `483595343` Town: City expenses board above the town center, boards kept clear, centred first view | City expenses board uses shared usage totals | S: economy (added), U (existing) | W | unit: web/src/world/town/townExpenses.test.ts, web/src/world/town/townBoardPlacement.test.ts |
| `ef91602b5` Town search shows what it finds on the map | Town search marks and frames qualified matches | S: fact projections (added) | A | unit: web/src/world/town/townSearch.test.ts; browser: web/src/world/HostsFilter.browser.tsx |
| `b211a4402` Town: a road down the left side of the town, matching the right | none — decorative left road | S: Town scene (existing) | none | unit: web/src/world/town/townLandscape.test.ts |
| `637e0e7b9` Town: a post office for your pull requests | Post office projects Sources PRs and existing card | S: economy/PR projections (added) | W,A | DOM: web/src/world/town/TownPostOffice.dom.test.ts; unit: web/src/world/town/townPost.test.ts |
| `b62d13622` Town: edge arrows to what needs you, and N for the next one | Offscreen attention and Next open qualified agents | S: fact projections (added) | A | browser: web/src/world/town/TownCanvas.browser.tsx; unit: web/src/world/town/townEdgeArrows.test.ts |
| `31e1620df` Town thought bubbles: see what every working agent is doing | Working-agent thought bubbles use current work | S: fact projections (added) | W | unit: server/src/agent/conversation-now.test.ts; scale browser consumer |
| `2bda61d80` Town lenses: see one fact across the whole map at a glance | Read-only fact lenses share missing-data semantics | S: fact projections (added) | W | unit: web/src/world/town/townLens.test.ts; DOM: web/src/world/town/TownLenses.dom.test.ts |
| `8f48fe986` Town: fix + Add room in place, just left of the bar | none — correct Add room placement | S: Creation/Town scene (existing) | none | browser: web/src/world/town/TownCanvas.browser.tsx |
| `a8c840f67` Show window minimize and mobile restore controls | none — existing minimize/restore controls become visible | S: Coordinated window presentation (existing) | W | unit/browser: web/src/world/windows/WindowFrame.test.ts, web/src/world/windows/WindowFrame.browser.tsx |
| `1ce6204d6` Town at full scale: scale scene, legibility report and two nameplate fixes | none — scale/nameplate legibility repairs | S: Town scene (existing) | none | unit: web/src/world/town/townNameplates.test.ts; scale browser acceptance |
| `a082fad2e` Generate Town's land around the buildings and fill the whole view | none — generated landscape and viewport fill | S: Town scene (existing) | none | unit: web/src/world/town/townLandscape.test.ts, web/src/world/town/townLandscapePaint.test.ts |
| `28cf18c3e` Town expenses boards: city billboard and a board per building | Host/city usage boards and scope limits | S: economy (added), U (existing) | W | unit: web/src/world/town/townExpenses.test.ts, web/src/world/town/townLimits.test.ts |
| `d810715b2` Town on phones: room Add, Expand and Fold get 40 px touch targets | none — existing room actions gain phone target size | S: Town scene (existing) | none | browser: web/src/world/town/TownCanvas.browser.tsx |
| `e86bbdd21` Town: a new agent arrives from the town center | none — visual arrival animation uses existing launch outcome | S: Honest agent startup (existing) | none | unit: web/src/world/agentStarts.test.ts, web/src/world/town/scene/townSceneActors.test.ts |
| `0aefe3b34` Stand the town center at the top, just across the first street | none — Town center placement | S: Town scene (existing) | none | unit: web/src/world/town/townLayout.test.ts |
| `2cb4bea3b` Town: replace New room with a + Add room slot in every building | none — per-room Add slot for existing creation action | S: Creation/Town scene (existing) | A | browser: web/src/world/SharedViewCreation.browser.tsx; Q17 creation-flow |
| `0cb453f1e` Town bus stops: everyone waiting lines up in a queue | Bounded visual waiting queue at scheduled bus | S: closure queues (added), E (existing) | O | unit: web/src/world/town/townBus.test.ts; durable effect consumers Q49 |
| `b8544ecfb` Town fuel: show a reading's age once it is over 15 minutes old | Limit gauge shows age after fifteen minutes | U: usage-limit display (added) | none | unit: web/src/world/town/townLimits.test.ts |
| `9e65d728c` Stand the town center on the first street among the buildings | none — Town center placement superseded by later layout | S: Town scene (existing) | none | unit: web/src/world/town/townLayout.test.ts |
| `9a39bef81` Keep Town whole while desks, rooms and hosts change | none — preserve admitted scene through topology churn | S: Stable Town placement (existing) | O | unit: web/src/world/town/scene/townSceneBake.test.ts; browser: web/src/world/town/TownCanvas.browser.tsx |
| `ba9d4d0ef` Town fuel: a Claude gauge from Claude Code's status line | Claude limits through per-launch chained tap | U (existing; settings transport added) | W,A | unit: server/src/usage/claude-tap.test.ts, server/src/usage/claude-fuel-board.test.ts; Q38/Q55 |
| `1069cee9c` Share one Town wall across a team's touching desks | none — joined desks project existing team membership | S: Stored Groups/shared presentation (existing) | W | unit: web/src/world/town/townJoinSeats.test.ts, web/src/world/town/townTeamActions.test.ts |
| `1ff6880e2` Needs you: attach files and screenshots to an answer | Answer attachments use qualified upload host and plain saved paths | A: attachments (added) | W,A | unit: web/src/world/askAttachments.test.ts, web/src/world/needsYouAttachments.test.ts, server/src/world/answer-dispatch.test.ts |
| `a5c5ea0c5` Town: Tidy rooms puts a building's rooms back in order | Tidy rooms and current-layout Undo | S: room placement (added) | O,W | unit: web/src/world/town/townRoomTidy.test.ts, web/src/world/town/TownTidyRooms.test.ts; existing Board conflict/storage consumers Q50 |
| `f1896276c` Let each Town reception choose which marks it takes | Shared per-host reception preferences; stale failure fencing | S: reception filters (added) | O,W,R | exhaustive 24 completion/publication schedules: web/src/world/town/townReceptionSetting.test.ts; filter unit/browser consumers |
| `a3fcf3d2e` Since you left: a return recap on the Town board | Cross-device sighting, browser-local return window and recap | S: return recaps (added) | O,W,R | unit: server/src/rpc/presence.test.ts, web/src/world/presence.test.ts, web/src/world/sinceYouLeft.test.ts; service clock is synchronous |
| `123f8a1d8` Keep healthy hosts fresh during terminal title activity | none — title churn must not starve healthy-host refresh | F (existing) | O | unit: server/src/connections/runtime.test.ts, server/src/world/snapshot-activity.test.ts; Q11 deterministic scheduling alternative |
| `86152b80d` Town agent moods: grumbling reception overflow, floor naps, confused unknown agents | none — moods visualize existing/unknown semantic state | S: Town agent locations (existing) | none | unit: web/src/world/town/townActors.test.ts, web/src/world/town/townBubbleKind.test.ts |
| `7ddaa633f` Town fuel gauges: Codex subscription limits | Codex subscription window observation and gauge | U (existing) | W,A | unit: server/src/usage/limits.test.ts, web/src/world/town/townLimits.test.ts; Q38 host/source limits |
| `67aad7758` Town: floating bin is a short drop on phones; per-view bin words; stop clock to the bus | none — bin positioning/wording and bus countdown presentation | E (existing), S: closure queues (added) | none | unit: web/src/world/bin/binStore.test.ts; browser: web/src/world/BoardView.browser.tsx |
| `ba908c0e2` Move whole rooms around in Town | Durable room pins keyed by qualified workspace card | S: room placement (added), storage (existing) | O,W,R | unit: server/src/storage/board-writer.test.ts, web/src/world/town/townMoves.test.ts; Q50 actual SQLite rollback/reopen |
| `33dd28729` Town center: a grand landmark at the top with a radial menu | none — Town center menu reuses common view actions | S: Common navigation (existing) | A | browser: web/src/world/BoardView.browser.tsx; unit: web/src/world/BoardView.test.ts |
| `453d1e40f` Give Chat Town's look inside Town's windows | none — Chat visual style in Town windows | S: Shared Chat presentation (existing) | none | browser: web/src/components/AgentChat.browser.tsx |
| `ba0e5fa98` Refresh Town goldens after bin/bus and summary board merges | none — golden assets only | n/a | none | browser golden comparisons |
| `dcc102a8b` Close agents with a bin and Town's scheduled bus | Durable scheduled close, cancellation and uncertain recovery | E (existing), S: closure queues (added) | O,W,A,R | model: Q49 effect-recovery; unit: server/src/world/bin.test.ts, server/src/world/bin-close.test.ts; actual SQLite effect/crash consumers |
| `a2a9c43e0` Town board counts the whole town; room and table summary cards | none — whole-town summary uses canonical attention counts | S: Town summary (existing) | W | browser: web/src/world/AnswerDeliveries.browser.tsx; unit: web/src/world/groups/GroupsSummary.test.tsx |
| `efd64d44d` Upgrade React 19 and fix development input stalls | none — React dependency and development input repair | n/a | none | unit: server/src/adapters/registry.test.ts; browser/renderer consumers |
| `f206391b5` Complete Board attention, appearance and pane moves | Shared Board attention, appearance and qualified pane moves | S (existing) | O,W,A | Q01/Q17/Q50 consumers; browser: web/src/world/BoardView.browser.tsx; unit: server/src/worktree/remove.test.ts |
| `fac6758d7` Merge reviewed Roamgate integration into main | SSH ownership/recovery, typed runtime routing, assistant contracts | F and workspace-assistant (existing) | O,W,A,R | models: runtime-control/drain, ranger-authority/recovery; actual SSH/runtime/assistant consumers Q03/Q26–28 |
| `2eebd2057` Show Claude's questions whole in Chat and answer folder trust before a session | Captured complete Claude questions and pre-session folder trust | S: Chat captured prompt choices (existing) | O,A | unit: server/src/agent/asked-questions.test.ts, server/src/agent/pending-prompt-captured.test.ts |
| `1ee9bf6f1` Offer Herdr setup on Town and fix the welcome copy (onboarding O0) | none — setup entry and welcome copy | C,D,S (existing) | A | browser: web/src/components/HerdrSetupCard.browser.tsx; unit: web/src/world/WorldStatus.test.ts |
| `1dfa8af41` Make main CI fixtures deterministic | none — deterministic test fixtures | n/a | none | unit: server/src/storage/world-storage.test.ts |
| `9794cd958` fix: keep repeated toast dismissal from closing Needs you items | none — toast dismissal must preserve durable attention | S: notifications (added clarification) | A | browser: web/src/updateNotification.browser.tsx |
| `cc4b8c5c4` Show one honest Starting line while an agent or window starts | none — honest Starting line for existing launch state | S: Honest agent startup (existing) | none | browser: web/src/components/AgentLaunch.browser.tsx |
| `a1000eee8` Keep agent startup outcomes visible and open pre-session windows on Terminal | Launch outcomes remain visible; pre-session Terminal selection | S: startup/creation completion (existing) | O,A | model: Q17 creation-flow; unit: server/src/agent/session-resolver.test.ts; browser launch controls |
| `7e8a01c2a` Complete harness command menus and composer keys in Chat | Captured command menus and composer keys | S: Shared Chat/command menus (existing) | O,A | unit: server/src/agent/command-menu.test.ts, server/src/agent/conversation-answer.test.ts; browser composer consumers |
| `af14eff84` Opening World never resizes a Herdr pane | Opening/hidden observation never resizes native TUI pane | S: observational terminal opening (added) | W,A | unit: server/src/bridge/endpoint-terminal-session.test.ts, web/src/terminalAttachSize.test.ts; browser: web/src/terminalHiddenAttach.browser.tsx |
| `7a6264479` Retire completion checks through a draining Desk review archive | Draining Desk review archive and durable terminal marks | identity, storage, S (existing) | O,W,A,R | Q51 direct source/compiled SQLite crash matrix; unit: server/src/rpc/review-retirement.test.ts, server/src/service/terminal-marks.test.ts |
| `6abcc69d0` Bound GitHub refresh history and preserve current PR evidence | Bounded source history, current PR priority, merged wins | S: Built-in sources (existing) | O,A,R | unit: server/src/sources/github-budget.test.ts, server/src/sources/github-completeness.test.ts; Q38 direct bounded-response tests |
| `01cf5c572` Read whole Needs you messages in place; compact phone counter | none — full durable question expansion and phone count | S: Needs you tab (existing) | none | browser: web/src/world/NeedsYouCard.browser.tsx |
| `55474cc44` Reject browser-normalized unsafe Markdown URLs (Roamgate #567) | Browser-normalized unsafe Markdown URL refusal | S: Safe rendered Markdown destinations (added) | A | unit: web/src/components/markdown.test.ts |

## Evidence decisions after deriving the requirements

| Group | Allowed and forbidden scenarios | Selected evidence and limits |
| --- | --- | --- |
| Live registry, Q54 | Either writer first, queued/late arrival, either save fails, retry on latest; forbid lost successful edit or default outside catalogue | New Quint exploration plus all 48 real-service/file configurations, larger retained-profile check, eager-snapshot model and compiled queue controls. Offline cross-process ownership is a separate demonstrated failure (#1084). |
| Open runtime move #990, Q57 | Quit before resume; destination-stop confirmation before rollback; identity/details retained or loss reported; never two live copies | Frozen `df398319a031f840668f7e6ea0dff765c5764c11`: actual 576-outcome controller matrix rerun, 9 tests/2,650 assertions. Serial awaits and per-conversation service locks remove internal completion permutations; native, metadata/persistence and browser consumers remain in #990. No cross-service crash atomicity claim. |
| Core launch/settings and first run, Q56 | Preparation before launch, saved/explicit choices win, failure before/after save and retry; no unsaved default or partial settings | Two publication failure boundaries, precedence matrix, equal-content subprocess cache writes, actual canonical PTY local/SSH and shell argv checks. Immutable equal-name contents commute; one initializer has only one asynchronous save. Core launch/retirement continues to consume Q17/Q52. Startup versus an independent offline writer remains #1084. |
| Claude limits writer, Q55 | Same-reset maxima survive either writer and stale-lock recovery; obsolete owner cannot publish | New Quint exploration and real filesystem trace expose 20→23→22 after stale reclaim between token check and rename (#1086). Pending repair: canonical diagnostic completion is explicitly not a safety pass. |
| Reception preferences | Two local save completions, either success/failure, and authoritative service publication in every order; a successful A is the rollback target if pending B fails | All 24 schedules drive the real preference module, with follow-up rollback checks after publication and a newer-success/older-acknowledgement regression. The audit exposed a discarded successful acknowledgement; fixed with a separate confirmed revision. Service publication fences older acknowledgements; no new ownership protocol. Other UI-setting file persistence retains Q35. |
| Push subscription ownership | Enroll may complete after revocation is requested; forbid late enablement after completed revocation | Existing `taskPush.test.ts` holds enrollment while queuing revocation, exercising the one serialized writer, and tests failure/retry. Passive hidden/inactive-document restoration and permission states have actual browser-API consumers. Browser/OS delivery itself remains platform evidence. |
| Integration registry/vault | Existing owners retain control authority; only supported secret names leave storage; atomic legacy migration and closure refusal | Registry fault-isolation and vault mode/unsafe-target/legacy/closed-owner tests exercise the actual modules. A registry is a read projection; one vault set is synchronous read/replace with no independently completing in-service writer. Cross-process filesystem/power-loss claims are excluded. |
| Bin/bus, Board/room pins, Desk retirement, Sources epochs and core ordered mirror | Existing identity, uniqueness, cancellation, qualified publication and crash recovery obligations | Existing effect/core/runtime models plus real SQLite crash, source-epoch, conditional Board and browser consumers named in the rows. No new contract is inferred merely from an animation or a new entry point. |

Q54/Q55 contracts record model variables, asynchronous boundaries, limits and
real adapters. Q52/Q53 were already modeled on the audited base; their pending
promotion is not silently converted into accepted proof here. The unfiltered gate
must run for this candidate; per-group added time is reported in the PR from the
complete run, rather than estimated from model size. No extra model time is added
for the exhaustive alternatives in Q56/Q57.

## Reconcile the nine active changes

| Active change at audit start | Decision | Evidence or unfinished requirement |
| --- | --- | --- |
| ask-answer-delivery | Archived with pinned CLI as `2026-11-20-ask-answer-delivery` | Current spec synchronized; #589 clean follow-up review 5721306688 and merged Delivery checks pass. Current real SQLite crash/dispatcher/attachment consumers rerun. No downstream exactly-once claim. |
| world-sources | Archived with pinned CLI as `2026-11-20-world-sources` | All implementation tasks delivered and current Sources contracts synchronized. Original missing-head finding is actually fixed and regression-tested; current Sources/detail/action suites rerun. Historical partial review is not called clean; #653 history acceptance and this audit's independent PR review remain distinct. |
| harness-usage | Retained | Base numeric-reader acceptance is narrower than later limits/context/tap additions. Q55/#1086 is a real unresolved contract failure; explicit repair and acceptance tasks added. |
| agent-profiles | Retained | Delivered profile/launcher/readiness contracts already current; profile CLI and launcher spawned-by follow-ups remain unchecked. Existing CLI stamp does not complete launcher provenance. |
| chimes | Retained | Delivered chimes/live interest current; message-ledger sender and subagent-class evidence still absent. |
| town-master-onboarding | Retained | Greeting delivered/current; lesson path, question marks, highlight and Guidebook remain planned. |
| world-harness-integration | Retained | Local skills/tap/discovery current; qualified SSH and remaining upgrade refresh stay in active delta/tasks. |
| world-protocol-identity | Retained | Delivered v1, bindings, verbs and terminal settings already synchronized. Cross-restart persisted captures/cursors, remaining ID families and gated v2 subscription work remain unfinished. |
| world-code-view | Retained | Research/mock/proposal only; real IDE lifecycle/trust/provider and resource gates are unfinished. No open feature PR other than #990 is audited as delivered. |

This PR updates current requirements, the two archived records, the usage follow-up,
coverage/consumer contracts, knowledge navigation and model-selection guidance.
README, FEATURES and learner steps already describe the shipped controls; no new
control or first-run instruction is introduced. Existing accurate specs are retained.
