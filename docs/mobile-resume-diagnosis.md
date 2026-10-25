# Mobile background/resume diagnosis — Phase 1

Date: 2026-10-25. Source: main checkout, branch `main`, commit
`e5c45cf35b15dcc7336406d27d39bc57f7f6010f`. All `file:line` references below
are relative to that checkout. The fix-306 worktree was not used for evidence.
This is diagnosis only; the brief's Phase 2 proposal is outside this assignment.

**Finding:** A real page reload is not required to explain the reported loss of
context. A browser transport interruption removes every open World Inspector,
unmounts its terminals, and recreates remaining terminal instances. Separately,
the application has an explicit, conditional page reload after failed terminal
recovery following background suspension. These are confirmed source paths,
not proof of which path occurred on the owner's device. The initial socket loss
and any OS discard remain unobserved.

| Hypothesis | Verdict | Principal evidence |
| --- | --- | --- |
| a. Browser/OS discards or freezes the page, causing a true reload | **Unknown for the incident.** Freeze and discard must be distinguished. | No discard/bfcache telemetry; existing return handlers: `web/src/store.ts:1064`, `web/src/components/TerminalView.tsx:3487`. |
| b. Page survives, but transport recovery loses UI state | **Confirmed for Inspectors and terminal presentation.** A wholesale snapshot/route reset is ruled out. | `web/src/world/WorldFoundationApp.tsx:208`, `web/src/world/worldTerminalPresentation.ts:105`, `web/src/world/WorldTerminalPortalList.tsx:65`, `web/src/components/TerminalView.tsx:391`, `web/src/components/TerminalView.tsx:3218`. |
| c. Auth expires while backgrounded and forces login/reload | **Ruled out as a short inactivity timeout.** An already expired/revoked cookie remains possible, unobserved. | Thirty-day absolute expiry: `server/src/http/auth.ts:12`, `server/src/http/auth.ts:182`, `server/src/http/auth.ts:212`; startup login redirect: `web/src/store.ts:1084`. |
| d. Application or service worker explicitly reloads/navigates | **Confirmed application reload path; incident occurrence unknown. Service-worker update reload ruled out in current source.** | Terminal watchdog reload: `web/src/components/TerminalView.tsx:3394`; policy: `web/src/terminalRecovery.ts:15`; notification worker: `web/public/task-notifications-sw.js:1`. |
| e. An unload handler/open socket blocks bfcache | **Unknown for actual browser eligibility; application unload-handler explanation ruled out.** It does not directly explain an ordinary tab/app switch. | `web/src/systemBack.ts:184`, `web/src/api.ts:605`, `web/src/components/TerminalView.tsx:3533`; no socket retirement on pagehide/freeze. |

**a. Page lifecycle and true reload**

The store listens for visible `visibilitychange`, `focus`, and `online`, then
probes the socket and refreshes metadata (`web/src/store.ts:1064–1080`). The
terminal records hidden duration, repaints on return, and retries an unattached
terminal; it also listens to `pageshow` and `focus`
(`web/src/components/TerminalView.tsx:3487–3540`). The history guard toggles its
departure flag on `pagehide`/`pageshow` (`web/src/systemBack.ts:184–190`).

Searches of `web/src`, `web/public`, and `web/index.html` found no
`document.wasDiscarded`, `pageshow.persisted`/`.persisted`,
`notRestoredReasons`, or registered `freeze`/`resume` lifecycle handlers.
Consequently, these source paths cannot identify an OS kill or distinguish a
new document from a bfcache restoration. A missing hidden event is even accepted
as sufficient to arm terminal recovery (`web/src/terminalRecovery.ts:37–42`);
that heuristic is not evidence of an actual OS freeze.

Browser freezing alone suspends execution; discarding destroys the document
and requires loading it again. `wasDiscarded` can help where supported, while
`pageshow.persisted` identifies bfcache restoration. These distinctions are
documented in the [Chrome Page Lifecycle API guide](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
No device/browser trace was collected, so an OS discard remains **unknown**.
Desktop viewport emulation would not establish an iOS background kill.

**b. Transport interruption and state loss without navigation**

The same-origin socket uses a 10-second heartbeat with a 6-second response
timeout (`web/src/api.ts:292–297`, `web/src/api.ts:683–710`). Foreground probing
detects a silently closed socket or sends an immediate ping
(`web/src/api.ts:719–727`). A generic close retires the transport, invalidates
clients, publishes `disconnected`, rejects requests, and schedules reconnect
after the default 1.5 seconds; it does not navigate
(`web/src/api.ts:434–438`, `web/src/api.ts:645–655`,
`web/src/api.ts:760–795`).

The destructive steps are in consumers of that status:

- **Open Inspectors:** `WorldFoundationApp` supplies an empty runtime lease list
  whenever status is anything other than `connected`, then filters conversations
  and clears their docking and portal entries
  (`web/src/world/WorldFoundationApp.tsx:208–233`).
  `retainWorldInspectorConversations` keeps only owners present in that list, so
  an empty list removes every conversation
  (`web/src/world/worldTerminalPresentation.ts:105–120`). Reconnection applies
  the filter to the now-empty list; the old conversations are no longer there.
  Inspector identity starts in React state as `[]`
  (`web/src/world/WorldFoundationApp.tsx:116–127`).
- **Inspector terminals:** even before conversation filtering, the portal list
  returns `null` while browser status is not `connected`, unmounting terminal
  owners (`web/src/world/WorldTerminalPortalList.tsx:65–74`).
- **Other mounted terminals:** `connectionClient` is recreated when status or
  `terminalAttachEpoch` changes
  (`web/src/components/TerminalView.tsx:391–402`). The terminal initialization
  effect depends on that client (`web/src/components/TerminalView.tsx:3227–3240`),
  disposes the endpoint presentation and xterm during cleanup
  (`web/src/components/TerminalView.tsx:3112–3138`,
  `web/src/components/TerminalView.tsx:3218–3225`), and allocates a fresh xterm
  (`web/src/components/TerminalView.tsx:1179`). Thus local terminal scrollback,
  viewport and selection are not preserved across that recreation. The
  same-terminal buffer-preservation comment at
  `web/src/components/TerminalView.tsx:3321–3326` only helps while an xterm
  instance survives; it cannot preserve a disposed instance.

The underlying store does **not** clear all topology on ordinary browser
disconnect: it clears endpoint availability, runtime client leases, relay/layout
caches and queued keys, then re-observes and rearms attachments after catalogue
admission (`web/src/store.ts:968–1043`). The aggregate World store retains its
last connections and snapshots as stale/non-actionable
(`web/src/world/runtimeStore.ts:411–415`,
`web/src/world/runtimeStore.ts:659–675`). Snapshot refresh publishes reconciled
data rather than issuing navigation (`web/src/world/runtimeStore.ts:519–606`).

Focused session topology and browser selection are preserved when the runtime
generation remains the same; a changed/missing owner or generation invalidates
the relevant session (`web/src/store/sessions.ts:146–195`). Browser-local
refresh projects remembered selection into fresh observations
(`web/src/store/refresh.ts:164–173`, `web/src/browserNavigation.ts:35–111`).
Therefore the strongest source-supported diagnosis is **presentation teardown on
transport status changes**, not an indiscriminate re-snapshot wiping everything.

**c. Auth/session expiry**

Authentication uses an HttpOnly, SameSite=Lax cookie with a 30-day Max-Age and
signed absolute `exp`; validation compares that expiry with wall-clock time
(`server/src/http/auth.ts:11–12`, `server/src/http/auth.ts:182–225`). There is
no activity-based expiry in this validator. Valid reauthentication does not
renew the token (`server/src/http/auth.ts:198–200`). A normal restart with the
same credential fingerprint reuses the signing secret; credential changes rotate
it (`server/src/config/session-secret.ts:188–217`).

HTTP requests and socket upgrades require authentication
(`server/src/index.ts:1434–1456`). Initial frontend health checking redirects
on 401 (`web/src/store.ts:1084–1089`). Explicit logout closes the matching
session's sockets with code 4001 (`server/src/index.ts:1398–1416`), which the
client handles by clearing the cookie and navigating to login
(`web/src/api.ts:645–652`). Ordinary resume does not repeat that startup health
check, and a rejected reconnect upgrade follows generic reconnect handling.
Thus a freshly valid session does not expire because of a short app/tab switch.
An old expired cookie, logout elsewhere, credential rotation, or cookie loss
cannot be excluded without incident evidence, but none is established here.

**d. Explicit reloads and PWA/service-worker behavior**

The terminal contains a concrete automatic reload:

1. A visible return after at least 30 seconds hidden, or an unmeasured hidden
   transition, arms recovery (`web/src/terminalRecovery.ts:29–42`,
   `web/src/components/TerminalView.tsx:3491–3501`).
2. An acknowledged `terminal.attach` that produces no matching frame starts a
   watchdog (`web/src/components/TerminalView.tsx:3348–3383`). Each watchdog is
   4–20 seconds, scaled by attach round-trip time
   (`web/src/terminalResize.ts:292–308`); matching frames satisfy it
   (`web/src/terminalResize.ts:251–268`).
3. After the third such timeout, if within 90 seconds of the armed resume and
   no automatic reload was recorded in the preceding 10 minutes, the code
   records a sessionStorage timestamp and calls `window.location.reload()`
   (`web/src/components/TerminalView.tsx:3390–3418`,
   `web/src/terminalRecovery.ts:15–21`, `web/src/terminalRecovery.ts:45–60`,
   `web/src/terminalRecovery.ts:63–96`). An attach RPC rejection instead shows
   an error (`web/src/components/TerminalView.tsx:3422–3436`).

This confirms an application-initiated full reload is possible after resume.
It does not establish that this watchdog fired on the owner's device; a quick
switch alone does not satisfy its measured hidden-duration condition.

Other explicit navigation paths are failed lazy imports (once per component
guard, any import rejection: `web/src/lazyWithReload.ts:8–22`), a pending
in-app update after verifying the expected server version
(`web/src/store.ts:1045–1046`, `web/src/store/updates.ts:180–217`), successful
user-triggered Herdr setup (`web/src/components/HerdrSetupCard.tsx:67–84`),
and the auth paths above. These are conditional paths, not a general reconnect
reload handler.

The notification service worker uses `skipWaiting()`/`clients.claim()`
(`web/public/task-notifications-sw.js:1–6`), but contains no asset cache/fetch
handler or update-triggered navigation. Notification clicks focus/message an
existing app window or open one (`web/public/task-notifications-sw.js:93–126`).
Registration waits for activation (`web/src/taskNotifications.ts:98–143`);
the controller-change listener only sends chime policy
(`web/src/chimes/chimeHost.ts:50–68`). An automatic service-worker update reload
is therefore **ruled out in current source**. The PWA manifest starts a fresh
launch at `/` (`web/public/manifest.json:7`); PWA installation provides no
independent client-state restoration mechanism here.

**e. bfcache and navigation restoration**

No `unload`/`beforeunload` handler was found in the application-owned frontend
sources or HTML. The observed history hooks use `pagehide`/`pageshow`
(`web/src/systemBack.ts:184–190`), not unload. The socket lifecycle
(`web/src/api.ts:605–795`) has no pagehide/freeze close and pageshow/resume
reconnect pair; terminal pageshow handling only repaints/retries, without
examining `persisted` (`web/src/components/TerminalView.tsx:3489–3535`).

An open socket is not proof of bfcache exclusion: this is browser/version
dependent. Current [browser guidance](https://web.dev/articles/bfcache) says
Chrome from version 149 and Safari do not block solely on open WebSockets,
while some other browsers do. Actual eligibility needs a navigation test and
restoration evidence. bfcache concerns document back/forward traversal; ordinary
tab switching and same-document SPA history do not depend on it. **Actual
bfcache failure is unknown, and it is not needed to explain finding b.**

**Current retention boundaries relevant to the symptom**

The top-level view already survives ordinary reload through its canonical URL
(`web/src/world/worldViewRouting.ts:10–15`,
`web/src/world/worldViewRouting.ts:50–51`,
`web/src/world/WorldFoundationApp.tsx:253–285`). Workspace/tab/pane navigation
is browser memory (`web/src/browserNavigation.ts:3–13`); Inspector membership
is React memory, though window geometry is read from localStorage
(`web/src/world/useWorldInspectorWindows.ts:105–135`). Terminal composer
drafts are deliberately memory-only because input can contain secrets
(`web/src/terminalComposer.ts:3–15`), scoped to connection/generation/pane
(`web/src/terminalComposer.ts:60–71`). Current runtime scopes are retained and
retired scopes cleared (`web/src/App.tsx:1062–1071`,
`web/src/terminalComposer.ts:202–235`); a browser reconnect must not be assumed
to change the server runtime generation. All memory-only drafts disappear on
a true reload. Board's explicitly kept conflict drafts have a storage mechanism
and are documented to survive reload when storage succeeds
(`web/src/world/board/boardDrafts.ts:4–12`,
`web/src/world/board/boardDrafts.ts:83–111`); saved Board data is fetched from
the service (`web/src/world/board/boardDocument.ts:206–217`). Claims that all
drafts or all state disappear are therefore too broad. No persistence change
or permission to store terminal content is implied by this diagnosis.

**Verification and remaining uncertainty**

Read-only source inspection was supplemented by the existing tests:

`bun test ./web/src/terminalRecovery.test.ts ./web/src/terminalConnection.test.ts ./web/src/terminalComposer.test.ts ./web/src/world/WorldFoundationApp.test.ts`

Result: **73 passed, 0 failed, 280 assertions**. These verify recovery policy,
runtime ownership, draft scopes, and view/Inspector helpers; they do not reproduce
mobile OS behavior or the complete React reconnect lifecycle. Existing source
also contains mocked silent-socket-close and frozen-resume teardown regressions
(`web/src/api.test.ts:2161–2179`, `web/src/api.test.ts:2207–2215`); those were
inspected, not executed in this run.

A separate in-memory call to the production Inspector retention helper used one
synthetic Inspector and the shell's connected → empty → same-runtime lease
sequence. Counts were **1 → 0 → 0**. This directly demonstrates why restoring
the transport lease cannot restore the deleted conversation. No test files were
added or modified.

No live instance, browser debugging port, device, authentication state, GitHub
object, tracked source or configuration was modified. No Chrome was launched.
The main checkout remained clean and at the same commit after the checks.

To attribute a specific incident, the discriminating evidence is: document boot
identity/navigation entry and supported `wasDiscarded`; lifecycle ordering and
`pageshow.persisted`; WebSocket close/status plus runtime generation; the
terminal recovery timestamp/reload call; and HTTP 401 or logout code 4001.
A surviving document with a transient disconnected status already explains the
confirmed Inspector/terminal loss. A new document requires separating the
conditional application reload from browser discard or an explicit navigation.
The source establishes those branches, but does not establish why the owner's
mobile socket stopped or which branch that incident took.
