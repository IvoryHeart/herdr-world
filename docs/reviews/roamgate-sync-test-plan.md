# Roamgate integration acceptance plan

Frozen source target: `2b16e991eeb2e90f55c948e249acaef1497d5254`.
The three scoped parts target `agent/roamgate-integration`; the owner merges them.
Only the final ancestry part updates `UPSTREAM.md` and the cumulative disposition
ledger. The final integration-to-main PR requires an independent whole-system review.
No scoped unit result below implies complete synchronization or final acceptance.

## Exact-head gate and preview

1. Record the final candidate SHA, current main merge parent, Bun/Herdr/OpenSSH
   versions and test-only session identity in private evidence. Merge updated main
   into the integration branch as required; run all acceptance again on changed code.
2. Run `bun run check:delivery` on that exact head. Retain lane logs and behavioral
   manifests; require the complete main CI matrix, browser suites, verification and
   native reports to pass on the same candidate. Scoped checks never substitute.
3. Request a preview port from steward-main. Serve only the isolated integration
   build, without changing the installed release or main's service/configuration.
   The owner uses it for an agreed observation period and reports acceptance.
4. Capture five viewports using the maintained screenshot recipe, plus interaction
   traces/smoothness evidence for changed UI. Use synthetic host labels and content;
   retain receipts privately and publish only reviewed, redacted evidence.

## Isolated end-to-end exercise

Use a disposable `herdr --session roamgate-sync-review` and a disposable SSH target
with synthetic repository/files and explicit host-key trust. A fake HOME alone is
not runtime isolation. Record each row as passed, failed, blocked or pending with
its exact command/scenario, candidate SHA and evidence; never infer a pass from units.

| Area | Exercise and required observation | Execution state |
| --- | --- | --- |
| Local and SSH runtime ownership | Open colliding pane/workspace IDs on two hosts; act on the inactive host; stop/reconnect one and confirm its peer remains usable. | Pending integration build |
| Shared SSH command connection | Observe repeated file/Git/transcript commands using only their runtime's private master; stop it and verify bounded same-host read recovery with no mutation replay. | Pending integration build |
| Port forwarding | Open local and reverse forwards to disposable echo services, verify data in both directions, occupied-port failure, own-origin refusal, disconnect cleanup and generation replacement. Check default GatewayPorts behavior and document its override boundary. | Pending integration build |
| Stalls and recovery | Interrupt SSH transport and command-master processes, suspend the disposable peer and restore it; verify keepalive/deadline failure and fresh qualified reconnect. | Pending integration build |
| Claude, Codex and Pi | Start isolated agents, read Chat and History, resume sessions, exercise SSH lookup and long appended transcripts; reject stale/ambiguous session identities. | Pending integration build |
| Ranger | Configure each delivered driver with disposable workspace permission, send/queue/cancel, schedule then restart, confirm task scope and navigation actions retain runtime ownership. | Pending integration build |
| Worktrees | Create/open/remove with and without origin and with delivered repository settings; verify qualified Files/Changes and bounded untracked counts. | Pending integration build |
| Mobile | Confirm Town remains the default; exercise Chat/history input, navigation, PDF and uploads at phone/tablet widths. | Pending integration build |
| Frontend update chip | Change the served build version and observe a small Updated — reload chip; only its tap reloads. Hide/show and app switches neither trigger the chip by themselves nor reload. Exercise the browser regression. | Pending web part |
| Existing projections | Exercise Board notes/strings, Town windows/attention, Desk marks/reviewed state, Chat prompts/receipts, terminal focus and uploads across hosts. | Pending integration build |
| Smoothness | Trace changed interactions under the maintained dense fixtures and inspect drag, scroll, switch and input behavior at all required viewports. | Pending integration build |

## Scoped transport evidence

The first part includes upstream #522, #523, #525, #535, #545, #546, #547,
#548, #549 and the transport/browser-lane portion of #552. Browser display and
remaining badge/prefetch consumers stay in the final web part. Its PR body records
adopted/adapted/skipped decisions for these commits and the exact executed checks.
Runtime/forward security regressions cover wrong connection, obsolete generation,
replacement attempts, authenticated explicit runtime admission, queued command/upload
retirement, bounded recovery health checks and no destination-only master selection.
The later web part tests upstream's loopback-served-page forwarding visibility;
service consumers assert that peer addresses do not add a forwarding access gate.
Whole-system rows remain pending until actually exercised on the integration build.
