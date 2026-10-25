# Mobile resume — Phase 2 proposal

2026-10-25. Based on [the Phase 1 diagnosis](mobile-resume-diagnosis.md) and
read-only source checks in the main checkout at
`e5c45cf35b15dcc7336406d27d39bc57f7f6010f`. File names below are repository
relative. New modules and function names are proposed, not implemented.

Recommendation: ship L1 as a bounded bug fix, deliver L2 independently, and treat
L3 as a separate frontend lifecycle and restoration design. Neither L2 telemetry
nor reproducing an OS kill is a prerequisite for fixing the confirmed L1 paths.

## L1 — Bug fix (transport-teardown resilience)

**Outcome:** switching apps, losing the browser socket, and reconnecting to the
same runtime leaves the same Inspectors and terminal displays on screen. They
become visibly disconnected and non-actionable, then resume after fresh target
admission. The URL does not change and the application does not reload.

Keep presentation identity separate from operational authority. A window/renderer
belongs to its immutable connection ID, runtime generation and resource IDs.
A `ConnectionClient` additionally belongs to a browser transport epoch and must
still be replaced on every disconnect. Retaining a display must never make an
old client current, replay terminal input, or retry an uncertain mutation.
This preserves `openspec/specs/runtime-federation/spec.md`'s qualified-admission
and stale-observation requirements.

**Minimal complete changes:**

| Files / functions | Before | Proposed change |
| --- | --- | --- |
| `web/src/world/WorldFoundationApp.tsx`, Inspector-retention layout effect; `web/src/world/worldTerminalPresentation.ts`, `retainWorldInspectorConversations` | Any non-connected browser status supplies an empty lease list and deletes every conversation, dock and portal. | Skip destructive reconciliation while browser transport/catalogue admission is unavailable. Once `catalogueReady` represents a fresh catalogue, reconcile by connection ID and runtime generation. Keep a same-generation unavailable host's windows as stale. Close/retire only explicitly closed windows, confirmed removed owners, replaced generations, or confirmed missing resources. Keep the helper's exact-owner filter; change when and which authoritative owners are supplied. |
| `web/src/world/useWorldInspectorController.ts`, observation-reconciliation effect around line 700 | The second reconciliation path also removes conversations when `owner.state !== "ready"`; a connected status can precede fresh topology. | Apply the same presentation-retention rule here. Cached/missing observations and temporary unready state cannot prove removal. Require a current catalogue for owner removal/generation retirement and a newly completed qualified focused list for resource absence. Preserve its existing concurrent-update reconciliation. |
| `web/src/world/WorldTerminalPortalList.tsx`, `WorldTerminalPortalList` / `WorldInspectorTabTerminal` | Non-connected browser status or an unready owner returns `null`, unmounting terminal owners. | Keep an already admitted presentation mounted for the same owner/resource while offline. Use a stale/disconnected overlay and disable operational controls. Preserve exact-generation and terminal-ID checks; do not mount a new actionable terminal from stale data. Apply authoritative resource removal after fresh observation. |
| `web/src/visibleTabLayout.ts`, `useVisibleTabLayoutState`; `web/src/tabLayout.ts`; `web/src/store.ts`, `bridge.onStatus` | Disconnect calls `clearTabLayouts()`. Losing split geometry can change the pane subtree even after the portal gate is fixed. | Retain the last validated layout as presentation geometry, keyed by connection/runtime/workspace/tab, while keeping request identities bound to the transport lease. Remove the blanket geometry clear on ordinary browser disconnect, or split it from operational invalidation. Retire geometry on owner/runtime/resource replacement. Preserve the pane set and stable mount keys through the outage; refresh geometry after current observation. |
| `web/src/components/TerminalView.tsx`, terminal initialization effect, `connectionClient` binding and attach effect | The initialization effect captures a transport client. Status/attach-epoch changes replace that client, running `term.dispose()` and creating a fresh xterm. | Give xterm and `TerminalEndpointPresentation` a renderer lifetime tied to the mounted container and exact terminal identity. Separately rebind push subscriptions, attachment watchdogs, resize synchronization and current commands to each fresh client. Retire transport-bound work on disconnect while keeping the rendered buffer and viewport. Reattach and accept fresh frames after catalogue/target admission. |
| `web/src/components/TerminalView.tsx`, no-frame watchdog; `web/src/terminalRecovery.ts` | Three acknowledged attaches without frames can automatically reload the whole application after resume. | Remove the automatic page reload. Keep the existing bounded local attach retries, then show the last frame with “Terminal is not receiving output”, **Retry terminal**, and an explicit **Reload app** action. A retry obtains a current client for the same target and restarts its attach budget. Retire unused resume-window/reload-timestamp helpers and replace their tests with recovery behavior tests. |

The terminal effect change is more than deleting `connectionClient` from its
dependency array. Existing event callbacks and derived callbacks would otherwise
retain a permanently retired client. Bind synchronous input/resize handlers to
the current client at invocation, and capture that client plus attempt identity
for asynchronous work. Every completion checks the captured client/attempt;
consulting a newer ref must not validate an older response. Dispose the renderer
on genuine identity change, resource closure or component removal. Keep
`Bridge.handleDisconnect`, epoch invalidation and uncertain-outcome rejection.

Use the existing browser connection status in the application menu and a small
terminal/Inspector stale indicator. Per-host recovery remains a distinct action:
`ConnectionRecoveryBanner.reconnectCachedHost()` restarts a managed host profile,
so it must not become the automatic response to a browser socket outage.

| Retain through a transient transport outage | Rebuild or revalidate |
| --- | --- |
| Inspector membership, active/docked window, z-order, geometry, selected resource view and currently rendered read-only content | Qualified operational clients, catalogue admission, in-flight reads and mutation outcomes |
| Same-terminal xterm buffer, local scrollback, scroll position, split geometry and viewport; selection where it still refers to the retained frame | Terminal attachment, negotiated endpoint advertisement, push subscriptions, resize synchronization and link/action tokens |
| Browser-local workspace/tab/pane selection and same-runtime composer drafts in their existing memory scope | Fresh topology and layout observations; resource/session fingerprints; active IME/paste dispatch and any pending input permission |
| Last aggregate snapshot, visibly stale and non-actionable | Aggregate freshness after a newly admitted `world.snapshot`; never infer freshness from socket open alone |

Reconciliation does not revive drafts or displays belonging to a replaced
runtime. Logout invalidates operation authority immediately and follows the
existing login flow. Update completion, failed lazy imports and user-triggered
setup keep their separate navigation policies; removing the terminal watchdog
reload does not silently change those behaviors.

**Acceptance:** exercise the production React tree, not only retention helpers.
Open two hosts' Inspectors, a split terminal, scrollback and an unsent composer
draft; close the browser transport; verify the same window/renderer identities
and last frames remain, controls cannot dispatch, and no navigation occurs.
Reconnect to the same runtime and verify fresh attachments without input replay
or duplicate listeners. Inject old frames/replies and replace just one runtime:
only its old target retires, with no cross-host fallback. Confirm a fresh list
can close a genuinely removed tab, while an incomplete catalogue cannot. Three
no-frame watchdog failures must leave the application running with local retry;
only the explicit reload action may reload.

Extend `WorldFoundationApp.test.ts`, `WorldTerminalHandoff.browser.tsx`,
`mobileTerminal.browser.tsx`, `visibleTabLayout.test.ts` and recovery tests as
needed. Check catalogue-before-topology and delayed-close sequences. Preserve
Q06/Q07/Q08 consumers in `verification/coverage.json`; direct browser evidence
is necessary for renderer lifetime and event timing, beyond the existing
ownership models. Update the current frontend guide and mobile/recovery steps
in `docs/TUTORIAL.md` and `FEATURES.md`, with a changelog fragment.

## L2 — Observability (lifecycle telemetry)

**Deliverable:** a bounded per-tab lifecycle record that survives an ordinary
reload and is visible after the next load. It observes events without deciding
when the transport reconnects. It can ship before or after L1.

Add `web/src/browserLifecycle.ts` with proposed
`initializeBrowserLifecycle()`, `recordLifecycleEvent()`,
`recordNavigationIntent()` and `readBrowserLifecycleReport()` functions.
Initialize once from `web/src/main.tsx` before rendering the lazy application.
Make initialization/disposal idempotent for development reloads.

- At each document boot, read the previous record before appending the new boot.
  Record a random document-lifetime ID, app version, normalized navigation type,
  initial visibility, and `wasDiscarded: true | false | null`. `null` means the
  browser does not expose the property; it must not be reported as false.
- Register document `visibilitychange`, `freeze` and `resume`, plus window
  `pagehide` and `pageshow`. Record `persisted` on both page transition events.
  Record normalized bridge status and numeric socket close code from
  `web/src/api.ts`; omit free-form close reasons and RPC payloads.
- Before the known application navigations, record a reason enum: terminal
  watchdog if L2 ships first, update completion (`store/updates.ts`), lazy import
  recovery (`lazyWithReload.ts`), setup (`HerdrSetupCard.tsx`), and logout/login
  redirect (`api.ts` / `store/updates.ts`). Keep their behavior unchanged in L2.
  Expire a pending intent if navigation does not occur, so a later browser
  reload is not misattributed to an old attempted navigation.
- Store a versioned record through `worldSessionStorage` in
  `web/src/browserStorage.ts`, under `lifecycle.v1`. Keep current and previous
  boot summaries, at most 128 events and 32 KiB total, with a 24-hour TTL.
  Write small synchronous snapshots on lifecycle transitions, especially hidden
  and pagehide; do not depend on unload or a final asynchronous write.
  Quota/security/storage errors fall back to memory without interrupting startup.

Add a small `web/src/components/BrowserLifecycleDiagnostics.tsx` section reachable
from `web/src/components/ConfigMenu.tsx` beside the version/connection summary.
Show **Previous load**, **Current load**, last foreground return and whether
browser discard was observed, unsupported, or unknown. Provide **Copy diagnostics**
for the sanitized record and **Clear** for this tab's record. Keep it separate
from `OfficeObservabilityDialog.tsx`, which configures Prometheus cost metrics.
No automatic upload, user identifier, URL, hostname, file path, terminal content,
cookie, token or exception text belongs in this log.

**How this resolves hypothesis a:** same document ID with freeze/resume proves a
surviving frozen page; `pageshow.persisted === true` identifies bfcache restore;
a new document with `wasDiscarded === true` identifies browser discard where
supported. A new boot with a matching application navigation intent explains
an application reload. A new document after hidden state with no such evidence
remains **unknown**, particularly on Safari or after lost storage. No event is
guaranteed to run at OS kill, and the proposal must not claim otherwise.
This closes the instrumentation gap independently of L1, while retaining honest
platform limits. See the [Page Lifecycle API guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
and [sessionStorage lifetime](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage).

**Acceptance:** deterministic event-sequence tests cover new load, same-document
freeze/resume, persisted pageshow, discard support true/false/absent, stale
navigation intents, bounded storage, unavailable storage and no secret-bearing
fields. Add a browser test for the next-load display and copy/clear controls.
An own-instance Chromium freeze/discard exercise can verify supported signals;
actual iOS background termination remains a device check. Document the diagnostic
control in current user guidance. These are shipping checks for L2, not gates
before L1 work starts.

## L3 — Resume-not-reset reconnect design

**Outcome:** foreground return resumes observation and exact-target operations;
a real document reload can restore safe per-tab UI intent. This changes frontend
lifecycle policy and persisted UI behavior, beyond the L1 bug fix.

**One lifecycle coordinator.** Add `web/src/browserResume.ts`, initialized once
from `main.tsx`, and proposed `Bridge.suspendForPageLifecycle()` /
`Bridge.resumeFromPageLifecycle()` entry points in `web/src/api.ts`. Keep browser
visibility/page-suspension intent separate from the existing user pause flag and
logout state. Reuse L2's observations if installed, without depending on its
diagnostic UI or stored history.

| Event | Transport and observation behavior |
| --- | --- |
| Becomes hidden | Stop application heartbeat probes and automatic reconnect scheduling; suppress focused and aggregate polling. An existing socket may remain until freeze/pagehide or an actual close. Keep displays and memory buffers. A hidden close retires its clients but does not start retry timers. Suspend terminal no-frame budgets so timer throttling does not consume visible recovery attempts. |
| `pagehide`, regardless of `persisted`; or `freeze` | Flush safe UI metadata, synchronously retire the socket and invalidate pending clients/observations, cancel reconnect/probe timers, and request close. Do not wait for a close acknowledgement or mutate a remote connection profile. Retain presentation via L1. Close any IndexedDB connection as well. |
| `pageshow`, `resume`, visible `visibilitychange`, foreground focus/online | Reconcile through one idempotent foreground path. If still hidden, defer work. If user-paused or logged out, preserve that decision. Otherwise connect once if retired; probe once if apparently live. Coalesce overlapping events and clear any expired hidden-period probe before creating a fresh one. |
| Successful hello | Obtain the fresh catalogue, then independently re-observe and attach each open exact target. Same owner resumes; a changed/removed owner retires its old operation context. Refresh aggregate snapshots with existing fair scheduling; one slow host must not block other hosts' qualified operations. |

Concrete integration points: `Bridge.startHeartbeat`, `probeConnectionNow`,
`handleDisconnect` and reconnect timer admission in `api.ts`; the store's
`refreshOnReturn` and polling lifecycle in `store.ts`; `WorldRuntimeStore.start`,
fallback timer and `refresh()` admission in `world/runtimeStore.ts`; and the
terminal return/watchdog handlers in `components/TerminalView.tsx`. The coordinator
must replace competing transport triggers, rather than add another independent
reconnect loop. `systemBack.ts` retains its same-document history guard.

Retiring on pagehide improves bfcache compatibility where open connections matter;
it does not guarantee bfcache admission and does not make an ordinary tab switch
a history traversal. Use `pageshow.persisted` and supported restoration reasons
to test actual behavior. Keep unload/beforeunload handlers absent. Current
[bfcache guidance](https://web.dev/articles/bfcache) documents browser differences.

**State placement and restoration:**

| State | Location and policy |
| --- | --- |
| Route / top-level view | Keep canonical `/town`, `/board`, `/desk`, `/spaces` URLs using `world/worldViewRouting.ts` and `WorldFoundationApp` history handling. An explicit shareable selection may use allowlisted opaque target IDs; never put text, paths or credentials in the URL. URL-specified intent takes priority over saved tab state. |
| Open windows, active/docked Inspector, resource tab, z-order, bounds, selected workspace/tab/pane, pane zoom, canvas/reader scroll offsets | A versioned `resume-ui.v1` record in `worldSessionStorage`, implemented by proposed `web/src/browserResumeState.ts`. Persist only opaque target IDs, numeric geometry/offsets and enum choices. Integrate shell state in `WorldFoundationApp.tsx`, `browserNavigation.ts`, `world/useWorldInspectorWindows.ts` and `world/windows/useWindowManager.ts`; readers expose only their scroll offsets. Debounce frequent changes and flush bounded metadata on hidden/pagehide. |
| Terminal renderer, current frame, local scrollback, live selection, terminal composer text and annotation drafts | Memory during the document lifetime. L1 keeps those buffers through transport recovery. Arbitrary terminal input/output and free-form drafts can contain secrets and are not silently written to sessionStorage or IndexedDB. After a true reload, recreate the terminal and retrieve current authoritative output/history where supported; an old numeric terminal scroll offset alone cannot reconstruct its buffer. |
| Eligible non-sensitive scrollback/history cache | IndexedDB, through a proposed `web/src/terminalHistoryCache.ts`, only if an explicitly enabled source can establish that its content is non-sensitive. Key by origin, per-tab namespace, exact resource and verified session identity; bound to 1 MiB per terminal, 16 MiB total and a 24-hour TTL. Use transactional eviction and treat quota/eviction as a cache miss. Generic shell output has no such guarantee, so this cache is disabled by default and raw xterm serialization is ineligible. |
| Existing shared preferences and Board documents | Retain existing localStorage preferences and service-owned Board persistence; do not duplicate those documents into the tab-resume record. Existing explicitly kept Board drafts retain their documented behavior. |
| Cookies, access tokens, SSH credentials, RPC clients, runtime leases and pending input/mutations | Never serialize into resume records or content caches. Auth remains in its existing HttpOnly cookie; operational authority is rebuilt from the World service. |

Use schema validation, a 128 KiB metadata budget, viewport-clamped geometry and
a 24-hour TTL. Storage limits bound persistence, not how many windows the user
may open; oversized records can omit oldest restoration hints. Treat missing,
corrupt, unavailable or evicted storage as normal. A browser may copy initial
sessionStorage into a newly opened tab, so identify document boots separately
and do not assume its namespace guarantees unique execution ownership.

On a new load, render saved window descriptors as restoring placeholders. Admit
the fresh catalogue and focused resource lists, then bind only verified targets
to new clients. A saved generation number is a hint, not proof of continuity
across a World process restart; verify current resource/session identity before
using content caches. Discard an unverifiable cache and show an unavailable
window for a removed target rather than selecting another host. Restore scroll
only after matching content/layout is present; preserve user's newer interactions
over late hydration. Aggregate cached topology remains non-actionable until a
newly admitted observation, just as it does today.

**Privacy decision:** the trusted-single-user model authorizes powerful local
operations; it does not make browser storage secret-safe. Same-origin scripts
can read sessionStorage and IndexedDB, and IndexedDB is shared across tabs on
that origin. Provide explicit cache opt-in/clear controls and purge resume/content
records on logout, with cross-tab notification so other tabs cannot immediately
recreate them. Namespace isolation and client-side encryption do not make
arbitrary terminal output eligible under “never secrets”. Redaction alone cannot
prove that arbitrary output is safe. Therefore the recommended initial L3 ships
metadata restoration with memory-only terminal content; durable scrollback is a
separately scoped extension for a defined non-sensitive source, not an empty
cache framework or a promise of unrestricted terminal restoration.

**Acceptance:** test hidden timers, silent socket death, freeze/resume and
pagehide/pageshow in different orders, repeated foreground events, user pause,
logout and late replies. Verify one socket/attach per target and zero input
replay. Test back/forward restoration in an owned browser and separately test a
true reload: URL intent, per-tab windows and safe scroll restore after admission,
while secrets and retired targets do not. Cover storage corruption/quota,
duplicate-tab initialization, changed viewport, server restart and independent
host recovery. Any IndexedDB extension adds expiry/eviction, cross-tab clearing,
non-sensitive-source admission and “old session never painted as current” tests.
Update current specs for the new restoration contract, the relevant verification
consumer mapping, `docs/TUTORIAL.md`, `FEATURES.md` and the frontend guide.

## Scope and size estimate

These are changed-file and added/deleted-line ranges for implementation, tests,
current documentation and a changelog fragment. Shared files overlap between
levels, so counts should not be added to predict unique files. Estimates assume
the existing Bun service, protocol and browser renderer remain in place.

| Level | Estimated files | Estimated changed lines | Risk | Independent delivery |
| --- | --- | --- | --- | --- |
| L1: transport-teardown resilience, local recovery, no automatic terminal reload | 14–20 | 850–1,400: roughly 400–650 production and 450–750 tests/docs | Medium: renderer lifetime is coupled to callbacks, layout and client epochs; stale authority or duplicate subscriptions are the main regression risks. | Yes. Ship as a complete bug fix after production-tree outage/reconnect tests; no telemetry or durable storage dependency. |
| L2: bounded lifecycle record and next-load diagnostic UI | 12–17 | 600–950: roughly 250–400 production and 350–550 tests/docs | Low: bounded synchronous storage and listener lifecycle; records must remain sanitized and best-effort. | Yes, before or after L1. It supplies evidence for a; it does not delay fixing b/d. |
| L3: lifecycle coordinator, visibility/bfcache policy and safe per-tab UI restoration | 15–23 | 1,400–2,300: roughly 650–1,100 production and 750–1,200 tests/docs | Medium–high: event ordering, restoration admission, resource identity, auth clearing and browser storage behavior. | Separate from L2; builds on L1's retained presentation. Foreground policy and metadata restoration can be reviewed as two functional increments of the same design. |
| L3 optional extension: eligible non-sensitive IndexedDB history cache | Additional 4–7 | Additional 500–850 | High for content eligibility/privacy; medium for bounded storage mechanics. | Yes, after a concrete non-sensitive content contract exists. It is excluded from the recommended initial L3 and must not enable arbitrary terminal persistence. |

L1 restores expected behavior within a surviving document. L3 establishes new
foreground/background policy and a durable UI-restoration contract; it is
frontend design work, not a necessary prerequisite for the confirmed bug fix.
L2 is a separate diagnostic deliverable. OS/browser discard itself cannot be
prevented by retaining a WebSocket; L3 can restore eligible UI intent after it.

During implementation, run the appropriate focused unit/browser suites followed
by the required repository delivery gate, including Q06/Q07/Q08 obligations and
the full behavioral gate where required. Tutorial/site updates require
`bun run build:site`. This proposal does not claim new test results: Phase 1's
73 passing tests remain evidence about existing behavior. No implementation,
specification change, dependency installation, live-instance action or GitHub
write was performed for this proposal.
