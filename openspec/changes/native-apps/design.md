## Context

World is one Bun service and a same-origin React web app. People reach it on their
home network or their own VPN and sign in with a login link, password or PIN; the
session is World's HttpOnly `herdr_world_auth` cookie (30 days, not refreshed).
`herdr-world url [--qr] [--address <host>]` prints the login link
`http(s)://<host>:<port>/?token=<token>`; World answers it with a 303 that drops the
token, sets the cookie and sends `Cache-Control: no-store`
(`server/src/http/auth.ts`). Browser admission
(`server/src/http/browser-admission.ts`) already admits originless native clients
under the normal login policy; a loopback listener refuses a non-loopback `Host`.

The signed cookie is a bearer credential until it expires or `herdr-world auth
rotate` changes the secret. Logout (`POST /api/logout` with
`x-herdr-world-logout: 1`) expires the browser's cookie and revokes that session's
Web Push enrolment; it does not invalidate a copy of the cookie held elsewhere. So
whoever holds the cookie bytes holds the session, whether World is reachable or not.

World decides OS notifications in one place, today inside `webPush.notify`
(`server/src/notifications/web-push.ts`), fed from `world-service.ts` by Herdr task
events (including the custom notification every `herdr-world ask` raises),
herdr-core runtimes and the assistant/bin. `notify` returns at once when Web Push
has no VAPID registry (no push subject configured), when Focus holds notifications,
or when the event is no longer current. `taskPushPayload` turns each event into
`{title, body, tag, target}`; the service worker opens
`/#herdr-world-task=<target JSON>` and `web/src/taskNotifications.ts` navigates to
the qualified target, refusing stale ones.

No system web view supports the Web Push or web Notification APIs (WKWebView,
Android WebView; WebView2 only through a host event). A wrapped page therefore
cannot notify by itself: the app needs its own connection and native notifications.
The PWA is unchanged.

Upstream Herdr Web has a Capacitor Android shell (`capacitor.config.ts`,
`android/`) that bundles `web/dist` and talks to the bridge across origins. That
model breaks World's one-origin rule; only its icons and manifest settings
(`allowBackup="false"`, `singleTask`) are worth keeping.

## Goals / Non-Goals

Goals: an Android APK and desktop installers that open the user's own World, pair by
QR code or login link, notify when an agent needs the user and open at that agent,
sit in the tray and launch at login, accept shared text on Android, and build and
smoke-test the shipped bytes on GitHub runners. The direct-download desktop packages
are also **all-in-one**: they carry the World service, so download, open, and World
runs on that computer (section 12). The client parts (shell, pairing, notifications,
World list) are shared; the all-in-one adds the local service.

Non-goals: store accounts, listings and upload; iOS builds; a push relay (Firebase,
APNs, UnifiedPush distributors); analytics or diagnostics; any change to World's
login, cookie, origin, CSP or listener policy; bundling or updating a Herdr runtime.
Store builds, when they come, are client-only: the Mac App Store sandbox forbids
starting shells, Herdr and agents. The build keeps a `client-only` switch that leaves
out the bundled service and section 12 so a store build is a configuration, not a
second app.

**Which package is which:**

| Package | Carries World | Client |
|---|---|---|
| `.dmg` macOS arm64 and x64 | yes | yes |
| Windows `-setup.exe` (NSIS) | yes | yes |
| Linux `.deb` and `.AppImage` | yes | yes |
| Android `.apk` | no | yes |
| Future store builds | no (`client-only`) | yes |

## Platform minimums

| Platform | Minimum | Why |
|---|---|---|
| Android | 8.0 (API 26), Android System WebView with `MULTI_PROFILE` and `DELETE_BROWSING_DATA` (androidx.webkit 1.13+ APIs) | one store per World, and Forget that completes (section 3) |
| macOS | 14 | `WKWebsiteDataStore(forIdentifier:)` and `remove(forIdentifier:)` back Tauri's `data_store_identifier` |
| Windows | 10 1809+ with WebView2 (the `.exe` bootstraps it) | Tauri 2 |
| Linux | WebKitGTK 4.1 (Ubuntu 22.04+, Debian 12+) | Tauri 2 |

On an Android device whose WebView lacks either feature, the app shows one screen:
"Update Android System WebView", with a button to its store page, and opens no World.
There is no shared-profile fallback: it could not keep two same-host Worlds apart or
forget one completely.

Android target SDK: 36 in v1. Android 17 blocks local-network access for apps that
target SDK 37+ unless they hold `ACCESS_LOCAL_NETWORK`; WebView traffic inherits the
app's state. Apps targeting 36 or lower keep implicit access through `INTERNET`, and
Android says they should not declare the new permission. Raising the target to 37
(store listings will need it) is its own change that adds the flow already designed
in section 8.

Tauri: 2.11.1 or later, pinned in `Cargo.lock`, and CI refuses an older one. 2.11.1
fixed remote-origin IPC requests skipping ACL checks when no `AppManifest` is set,
and `.localhost` handling that let remote sites pass as local on Windows and Android.

## Decisions

### 1. Framework: Tauri 2

| | Tauri 2 | Electron (desktop) + Capacitor (Android) |
|---|---|---|
| Codebases | One project: Rust core, one bundled list page, a Kotlin Android plugin that owns the World web view and background service. iOS would need its own Swift equivalent of that plugin | Two stacks: Electron (Node) and Capacitor/Android, iOS a third shell |
| Size | Published desktop figures about 3–15 MB (`.deb`, `.dmg`, `.msi`); AppImage 70+ MB because it bundles WebKitGTK; the all-in-one adds World's own executable (a compiled Bun binary of tens of MB, the same for any framework); this app's sizes are measured in spikes 1.1–1.3 | Electron installers about 85–270 MB; Capacitor APK a few MB |
| Engine updates | System web view, patched by the OS (WebView2 evergreen, WKWebView with macOS, WebKitGTK with the distro for `.deb`, Android WebView through the store). AppImage is the exception: its bundled WebKitGTK updates only when we ship a new AppImage | Electron ships its own Chromium; only the latest three majors (8-week cadence) are supported, so without an updater a v1 build is unsupported within about six months |
| Remote page access to native code | IPC is refused for a remote URL unless a capability names it (2.11.1+); we name none. Tauri still installs its framework IPC scripts in every web view it creates | Electron: none with `contextIsolation`, sandbox and no preload. Capacitor injects its bridge into the `server.url` origin, giving the World page every plugin, and documents `server.url` as live reload, "not intended for production" |
| Notifications | `tauri-plugin-notification` ≥ 2.6 reports desktop clicks to Rust (`on_action`); Android through the Kotlin plugin | Electron `Notification` click; Capacitor local-notifications |
| Tray, autostart | Built-in tray; official autostart plugin (Windows, macOS, Linux) | Tray built in; `setLoginItemSettings` lacks Linux |
| QR scan | Official barcode-scanner plugin (Android, iOS) | Capacitor community plugins |
| CI | `tauri-action` builds `.dmg`, `.exe`, `.AppImage`/`.deb`; `tauri android build --apk` on Ubuntu | electron-builder for desktop; Gradle for Android |
| Carrying World (section 12) | Sidecar (`bundle.externalBin`) ships an existing executable unchanged inside each desktop package; the official updater verifies a signature before installing (`.app` archive, NSIS, AppImage) | Electron `extraResources` plus electron-updater; Capacitor not applicable |
| Engine risk | WKWebView and WebKitGTK are WebKit: World already supports Safari for the PWA; WebKitGTK can fall back to slow canvas/WebGL and has NVIDIA DMABUF issues | Same Chromium World's browser tests use |

**Choice: Tauri 2, provisionally, as the better fit of the two compared.** It keeps
desktop and Android in one project and toolchain, its desktop packages are small,
most of its engines are patched by the OS (which matters because the page it wraps
can run shells, and Android and `.deb` builds have no in-app updater), its sidecar
carries the release's own `herdr-world` executable unchanged, and remote pages get no
native access by
default. Capacitor's main value, a JS bridge into bundled web content, is what this
design must not use. Other wrappers exist (for example a plain Kotlin app plus a
separate desktop shell); nothing here shows they would make the session and
background-service work smaller, because that work is platform code under any
framework. Costs accepted: substantial Kotlin for Android (the plugin owns the World
web view, section 3), Linux WebKitGTK quirks (the install guide documents
`WEBKIT_DISABLE_DMABUF_RENDERER=1` and recommends the `.deb`), the AppImage's
engine updates being ours to ship (every World release rebuilds it, and the guide
says so), and Rust build time in CI. iOS is a future platform integration, not
reuse that already exists. If the spikes show Tauri cannot meet a requirement here,
the design returns for review before the build continues.

Sources: Tauri capabilities (v2.tauri.app/security/capabilities), Tauri 2.11.1
release notes, `WebviewBuilder` (`data_directory`, `data_store_identifier`,
`on_navigation`, `on_new_window`) and cookies (docs.rs/tauri), notification plugin
2.6.0 notes, autostart plugin, AppImage (v2.tauri.app/distribute/appimage), Linux
graphics, CI (v2.tauri.app/distribute/pipelines/github), Electron timelines and
security, Capacitor config and issue ionic-team/capacitor#5745, WKWebView Web Push
(developer.apple.com/forums/thread/760767), WebView2 `NotificationReceived`,
androidx.webkit `ProfileStore` and `WebStorageCompat`, Android local network
permission, foreground service types and Doze (developer.android.com), GitHub
`macos-13` retirement (github.blog changelog 2025-09-19).

### 2. One origin and the hostile-page policy

The app shows a World by loading that World's origin in a web view. It bundles no
copy of World's web app, proxies nothing and needs no World setting.

- **World view.** Desktop: a Tauri web view labelled `world-<id>` with
  `WebviewUrl::External(<origin>)`. Android: a plain `android.webkit.WebView` owned
  by the Kotlin plugin (section 3), with no `addJavascriptInterface` and no Tauri
  bridge, so World pages there are unbridged.
- **Scripts.** The app adds no script of its own to World pages. On desktop, Tauri
  installs its framework IPC and plugin initialisation scripts in every web view it
  creates, including World's; that is framework initialisation, not application
  injection, and every call it carries from a World origin is refused because no
  capability names a remote URL. Plugins whose scripts are not needed in World views
  are not registered on them.
- **Commands.** The only capability targets the web view labelled `list` (the bundled
  World list) and names its commands explicitly. Every custom command is declared in
  `build.rs` through `AppManifest`, so the ACL covers custom commands as well as plugin
  commands. A hostile-page test (section 9) proves World pages are refused.
- **Navigation**, for top-level loads and redirects alike: allow only the exact
  paired origin (scheme, host and port) over `http`/`https`, and `blob:` URLs whose
  origin is that origin. Another `http`/`https` origin, including another paired
  World's, opens in the system browser when the navigation is a `GET`, and the app
  keeps showing the selected World; the selection never changes from inside a page.
  A navigation with another method (a form `POST`) to another origin is refused, not
  handed to the browser, because its body cannot be passed on safely. Everything
  else (`file:`, `data:`, `javascript:`, `intent:`, `tauri:`, `ipc:`, `asset:`, any
  custom scheme) is cancelled and never handed to the OS.
  - Desktop: `on_navigation` sees every top-level navigation the engine starts,
    including form `POST`s and server redirects (WebView2 `NavigationStarting`,
    WKWebView `decidePolicyFor navigationAction`, WebKitGTK `decide-policy`); spike
    1.2 proves each engine calls it for a cross-origin `POST` and for a `307`.
  - Android is enforced in three layers, because `shouldOverrideUrlLoading` is not
    called for `POST` requests:
    1. `shouldOverrideUrlLoading` applies the policy to the navigations it sees
       (links, script navigation, `GET` redirects).
    2. `shouldInterceptRequest` sees every request, `POST` included. For a request
       with `isForMainFrame()` whose origin is not the World's exact origin it
       returns a local empty `403` response with `Content-Security-Policy: sandbox`,
       so no request leaves the device and nothing from that origin loads. It makes
       no network request of its own and never touches World-origin requests, so
       World's responses are not proxied. This layer fails closed: any main-frame
       request it cannot classify is refused.
    3. `onPageStarted` and `doUpdateVisitedHistory` check the main frame's URL; if it
       is not the World's origin (the case of a World-origin response redirecting a
       `POST` with `307`/`308` elsewhere, a hop layer 2 is not told about), the view
       stops loading, loads the World's origin and clears its history. World itself
       sends no cross-origin redirect, so this needs a server flaw; spike 1.1 checks
       whether any script of the redirected page runs first (a beacon in the fixture)
       and, if it does, the design returns for review.
- **New windows** (desktop `on_new_window`, Android `setSupportMultipleWindows(false)`
  plus the same check): the app never creates a web view for a page. A same-origin
  `window.open` or `target=_blank` loads in the current World view; another
  `http`/`https` origin goes to the system browser; anything else is refused.
- **Native requests** (stream and logout) carry only the cookie read for that exact
  origin, never follow redirects, and treat a redirect as a failure.
- The app appends `HerdrWorldApp/<version> (<platform>)` to the web view's user agent;
  the page uses that only to say, in Settings, that the app delivers notifications.

The bundled World list (pairing, choose, re-sign-in, sign out, forget, per-World
notification switch) never fetches a World origin: pairing hands the link to the
World view, not to `fetch`. It is not a copy of World's web app.

Requests from World views are ordinary same-origin browser requests; the
notification connection is an originless native client, which browser admission
already accepts. World's server is unchanged apart from section 4.

### 3. Pairing, the session and its lifecycle

**Input.** Android scans the QR code with the official barcode-scanner plugin
(CameraX and the bundled ML Kit model, no Google Play services). Every platform
accepts a pasted link or origin. Accepted: `http`/`https`, a host, path `/`, at most
one query parameter, `token`. Anything else is refused before anything is stored.
The desktop binary also accepts `--pair -`, reading one link from standard input so
the token never shows in the process list; the smoke test uses it. There is no URL
scheme for pairing, so a website cannot pair the app with a hostile World.

**The list.** `worlds.json` in the app's data folder holds, per World: a random app
ID (it names the World's store), origin, display name (the host, editable),
notification switch, added time, state (`signed-in`, `signed-out`, `forgetting`), the
last stream event ID (section 4) and, for the World on this computer, which
installation runs it (section 12).
A separate `pendingStoreDeletes` list holds only random store IDs awaiting removal
(below). Never a token, password, PIN or cookie value.

**One store per World.** Cookies are scoped by host, not port (RFC 6265 section
8.5), and every World names its cookie `herdr_world_auth` with `Path=/`, so two
Worlds on one host would overwrite each other's session in a shared store. Every
World gets its own engine store: desktop `data_directory` (Windows, Linux) or
`data_store_identifier` (macOS 14+); Android an `androidx.webkit` profile
`world-<id>`, set with `WebViewCompat.setProfile` before the view loads anything.
Because that must run before the first load, on Android the Kotlin plugin owns the
World web view (one activity, recreated when the user switches World) and Tauri's web
view shows only the World list.

**Pairing keeps the token out of history and saved state.** The link reaches the
engine only as the first navigation of a single-use pairing view, created on that
World's store. On Android the link passes to the World activity through an
in-process holder, never an `Intent` extra (which recents can retain). After the 303
lands on the bare origin with the cookie set, the app destroys the pairing view and
opens a fresh World view on the same store at the bare origin, so no back/forward
list, including Android's `getOriginalUrl`, ever held the token in the view the user
keeps. The app never calls `WebView.saveState`/`restoreState`, keeps no web view
state in `onSaveInstanceState`, and restores a World only from its stored origin.
Form-data saving is off. The smoke test greps the whole app data folder and profile
for the token after pairing and again after restart (section 9).

**Adding an origin already listed** signs that entry in again instead of adding a
second one: the link runs through the same pairing view on that World's existing
store, the entry keeps its ID and returns to `signed-in`, and its stream restarts.
The "Sign in again" notification and the list both offer "Sign in with a link"
(scan or paste) or "Open World" (World's own login page).

**Sign out** (the app's action), in order:
1. Mark the World `signed-out`; stop its stream and cancel its reconnect timer.
2. Discard the cookie header the native client captured.
3. Send `POST <origin>/api/logout` with `x-herdr-world-logout: 1` and that cookie, from
   Rust (desktop) or Kotlin (Android) as an originless native request, with a 5 s
   timeout; no script runs in the page. World expires its cookie, revokes that
   session's Web Push enrolment and closes its streams.
4. Delete the cookie from the World's store whether or not step 3 reached World:
   Tauri's cookie API on desktop (or clearing that World's store where one cookie
   cannot be deleted; spike 1.2), the profile's `CookieManager` on Android.
5. Reload the World view, which now shows World's login page. The World stays listed.

**Sign out inside the page** (World's own button): World closes the stream with a
final `logout` frame (section 4); the client marks the World `signed-out` without a
"Sign in again" notification. **Signing in inside the page** is noticed without
injection: after every top-level page load at the World's origin while it is
`signed-out`, the native layer reads the store's cookie and, if one exists, opens the
stream once; success marks it `signed-in`.

**Forget this World** completes, or it is retried until it does; the entry leaves the
list only after its data is gone:
1. Mark the entry `forgetting` (it disappears from the list at once), stop its stream
   and timers, cancel every notification it posted, and from now on reject taps whose
   World ID is `forgetting` or unknown (the app opens the World list instead).
2. Sign out (steps 2–4 above) if World answers within 5 s.
3. Close every web view of that World and drop the app's references to it.
4. Delete the store:
   - Android: `WebStorageCompat.deleteBrowsingData(profile.getWebStorage(), …)`
     (network cache, cookies and JavaScript-readable storage of that profile only),
     then the profile's `CookieManager.removeAllCookies` and flush, waiting for both
     callbacks. A profile loaded in this process cannot be deleted, so its ID moves to
     `pendingStoreDeletes`; at the next process start, before any profile is loaded,
     the app calls `ProfileStore.deleteProfile` for each pending ID and drops it when
     that succeeds. Spike 1.1 checks service-worker registrations are gone after both
     steps.
   - macOS: release the World's web views, then
     `WKWebsiteDataStore.remove(forIdentifier:)`; on success the ID is dropped; on an
     error (a view still alive) the ID goes to `pendingStoreDeletes` and is removed at
     next start before any World view is created.
   - Windows and Linux: release the views, then delete the World's `data_directory`.
     WebView2 can hold files until its browser process exits; a failed delete moves
     the ID to `pendingStoreDeletes`, removed at next start before any view is
     created.
5. Delete the World's Android notification channel, then remove the entry from
   `worlds.json`.

The pending list holds random IDs only, so it names no World; on Android and macOS the
session cookie is already gone before an ID is queued. If the store is still pending
the list says "Finishing clean-up next time the app starts". If World was
unreachable, the app says World's own record of that session could not be revoked:
any copy of the cookie stays valid until it expires (30 days) or until
`herdr-world auth rotate`. Reachable logout does not revoke a copy either; Forget
deletes the app's copy, which is what makes sign-out effective on the device.

### 4. Notifications

**One decision, independent sinks.** The policy now inside `webPush.notify` moves to
a small notification fan-out (`server/src/notifications/fanout.ts`): it drops an
event when Focus holds notifications (held, not queued, as today: the Focus recap
lists it) or when it is not current, then hands it to each sink. The Web Push sink is
the existing queue and sends only when a VAPID registry exists; the stream sink sends
whether or not Web Push is configured. Each sink applies the same
`notificationPreference` mapping to its own subscriber's switches, and both re-check
currency and Focus before sending. A route test proves stream delivery on a World
with no push subject.

**Server route.** `GET /api/notifications/stream` (`text/event-stream`) beside
`/api/notifications/push`, behind the same admission and login cookie. Query
`completed=0|1&blocked=0|1` sets the stream's switches (a message for the user
follows the completed switch, as for Web Push). Each event is `taskPushPayload(...)`
JSON with an SSE id `<boot id>:<sequence>`.
- Heartbeat: a comment every 45 s. The route calls `server.timeout(req, 120)` so Bun's
  default 10 s idle timeout does not cut the stream.
- Bounds: at most 64 open streams (oldest closed first) and a 32-frame write queue per
  stream; a stream that falls behind is closed and its client reconnects.
- Replay: an in-memory ring of the last 32 events or 10 minutes, whichever is
  smaller. A reconnect with `Last-Event-ID` from the same boot gets the events it
  missed that are still current and allowed by Focus, so a short gap (Doze, a VPN
  blip, a Wi-Fi handover) delays notifications instead of losing them. Nothing is
  persisted; a gap longer than the ring or across a World restart loses those
  notifications, and Needs you still holds every ask.
- Logout sends a final `logout` frame and closes every stream bound to that session
  (the binding Web Push uses); a credential change makes the next request fail.

**Client.** Desktop: a Rust task per signed-in World reads the cookie with
`cookies_for_url` (async on Windows), opens the stream with `reqwest` (redirects off)
and shows notifications with `tauri-plugin-notification`; `on_action` opens the World
at `<origin>/#herdr-world-task=<target JSON>` and focuses the window. Android: the
Kotlin service reads the cookie from the World's profile `CookieManager` (Tauri's
cookie API returns nothing on Android) and holds the stream; a tap intent carries
the World ID and target. Notification IDs join the World ID and payload tag, because
tags hold World-local runtime identities. Backoff: 2 s doubling to 5 min, reset on a
network change. A 401 marks the World `signed-out`, stops retries and posts one "Sign
in again" notification; a `logout` frame does the same without the notification.
Both clients save each World's last event ID (`<boot id>:<sequence>`, never the event)
in `worlds.json` at most once a minute and on shutdown, so a restart after process
death or a reboot resumes from it; a different boot ID means World restarted and the
replay has nothing for it. Both parsers run one shared fixture of stream frames.

**Web.** `taskNotifications.ts` also handles a `hashchange` to
`#herdr-world-task=`, so a tap reaches an already-open page; stale targets keep
today's refusal. World still decides what notifies; the app only displays it.

### 5. Android background connection

**Service type: `specialUse`**, with
`PROPERTY_SPECIAL_USE_FGS_SUBTYPE` = "Holds a connection to the user's own
self-hosted Herdr World on their network or VPN to show alerts when an agent needs
them; no push service is involved." `remoteMessaging` is documented for moving text
messages between a user's devices, which this is not; `dataSync` is capped at 6 hours
a day on Android 15 and cannot start at boot. The service runs while any signed-in
World has background notifications on (default on after the notification permission
is granted). Its ongoing notification is silent, low priority, shows each World's
state ("Connected", "Waiting for network", "Signed out") and offers "Turn off".

| Condition | Behaviour |
|---|---|
| Screen off, not yet in Doze | Streams stay open; heartbeats keep NAT and VPN paths alive |
| Doze, no battery exemption | Android suspends the app's network; the stream drops and reconnects in maintenance windows with `Last-Event-ID`, so events inside the replay window arrive late and older ones are lost |
| Battery exemption granted | The per-World background switch offers it with an explanation and opens `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`; with it, network stays available in Doze and delivery is near real time. Never required |
| Process killed by the system | `START_STICKY`; the service restarts, reads `worlds.json` and reconnects with the saved `Last-Event-ID` (events since the last save that are still in the ring arrive; spike 1.1 kills the process to prove it) |
| Reboot | A `BOOT_COMPLETED` receiver starts the service when any World has background notifications on and the notification permission is granted |
| Force stop | Android allows nothing to run until the user opens the app; the guide says so; opening the app resumes |
| VPN or Wi-Fi lost | A `NetworkCallback` pauses attempts while no network can reach the World and resumes on `onAvailable` or a link change; the ongoing notification says "Waiting for network" |

UnifiedPush is not used: World would have to post each notification through a
distributor server, a push relay this item excludes. Firebase is excluded for the
same reason and because it requires Google Play services. Desktop needs neither: it
receives directly while its process runs, the machine is awake and World is
reachable.

**Battery: measured, not borrowed.** A 45 s heartbeat is about 1,920 frames per World
per connected day before reconnections and VPN keepalives. Task 4.4 measures on one
current physical phone, screen off for 8 hours each, with `dumpsys batterystats`:
the app installed with background off (baseline); one World on Wi-Fi, without and
with the battery exemption; one World over a VPN. The guide records the measured
differences and the notification delays seen in Doze. If the cost is high, the
heartbeat interval is the first thing to tune.

### 6. Desktop tray and launch at login

The tray (menu bar on macOS) lists paired Worlds with Open and Sign out, plus Launch
at login and Quit. Closing the window hides it; Quit ends the app's connections and
never stops World or an agent: a World on this computer is the user's background
service (section 12) and keeps running, and agents run inside Herdr or herdr-core,
which are not children of World or the app. Stopping World is a separate tray item
for the World on this computer, with a confirmation that says agents keep running in
their runtime and notifications stop until World starts again. Launch at login
uses the official autostart plugin (Launch Agent on macOS, registry on Windows,
`~/.config/autostart` on Linux), off by default, starting with `--hidden`. The
single-instance plugin focuses the running app. On Linux the tray needs
libayatana-appindicator; without a tray host, closing the window quits instead.

### 7. Android share target

An `ACTION_SEND` filter for `text/plain` opens a chooser of signed-in Worlds (skipped
when there is one) and loads `<origin>/#herdr-world-find=<text>`. The page opens Find
or act with that text and clears the hash. Files are out of v1: an upload needs a
terminal target and confirmation, which is more than small.

### 8. Reaching World

Exactly as the PWA: the home network or the user's own VPN. The app never offers to
expose World, never uses a relay and needs no World setting. Android allows cleartext
HTTP because World's LAN address is chosen at run time and a network security config
cannot list arbitrary IPs; the guide recommends HTTPS (see `docs/DEPLOYMENT.md`) and
the list marks HTTP Worlds "Not encrypted". Cleartext permission only allows the
scheme; reachability on Android 17 depends on the target SDK (Platform minimums).

Local network permission, for when the target SDK reaches 37: the app declares
`ACCESS_LOCAL_NETWORK`, asks for it when the user pairs a World, and if it is denied
or later revoked the list shows "Local network access is off" with a button to the
app's settings, and the service shows "Waiting for permission" instead of retrying.
v1 (target 36) does not declare it. Acceptance runs on a current physical Android
device reaching a World by LAN address and over a VPN (task 4.4 and Try it).

### 9. Builds and smoke tests

`.github/workflows/native-apps.yml`, path-filtered to `apps/native/**`, the stream
route and the fan-out, plus `workflow_dispatch` and `workflow_call(version)`. Each
desktop job first takes World's executable for its platform from the release
archive (section 12: `verified-archives` in a release, the same `package-release.sh`
archive built once per platform on PRs), checks it against the archive's checksum
list, and places it as the sidecar. Each job then builds, signs (section 10), records
the SHA-256 of each package, smoke-tests those exact files and uploads them unchanged
as the `native-packages` artifact.

| Job | Runner | Shipped package | Smoke |
|---|---|---|---|
| android | ubuntu-latest (KVM) | `herdr-world-app-<v>-android-arm64.apk` | install that APK on an x86_64 API 35 emulator image with ARM translation; if spike 1.1 finds translation unusable, the shipped APK becomes one universal APK (arm64 and x86_64) so the tested file is still the shipped file |
| macos-arm64 | macos-latest | `…-macos-arm64.dmg` | mount, copy to /Applications, launch |
| macos-x64 | macos-15-intel (until its 2027 retirement) | `…-macos-x64.dmg` | same |
| windows | windows-latest | `…-windows-x64-setup.exe` (NSIS; the format whose install hooks can stop and start World's task, section 12) | silent install, smoke, uninstall |
| linux | ubuntu-22.04 | `…-linux-x86_64.AppImage`, `…-linux-amd64.deb` | each in turn under Xvfb with a session bus |

**Smoke World.** A real World from the same commit on loopback, with a temporary data
folder, every `HERDR_*` variable cleared, a generated token, no push subject (so the
stream is shown working without Web Push), and one isolated herdr-core runtime with
its own state folder and one scratch terminal. A small recording proxy
(`scripts/native-smoke/`, test tooling) passes requests through unchanged. Android
reaches it through `adb reverse tcp:<port> tcp:<port>`, so the app uses
`http://127.0.0.1:<port>` and the loopback `Host` check passes unchanged; nothing goes
through the emulator's alias for the host machine.

**Pass, per package:**
1. Pairing: the token link is answered with the cookie; afterwards no file in the app
   data folder or Android profile contains the token, also after a restart.
2. Town is visible: the OS accessibility tree (UiAutomator on Android, UI Automation
   on Windows, AX on macOS, AT-SPI on Linux) shows Town's labelled region. This reads
   the shipped bytes without a test build or debugging port. A screenshot is kept as
   an artifact.
3. Notification: the scratch terminal runs `herdr-world ask`; the OS shows the
   notification. Clicking it is automated on Android (UiAutomator in the notification
   shade), Linux (a test notification server on the session bus records it and sends
   `ActionInvoked`) and Windows (the toast through UI Automation); the accessibility
   tree then shows that agent open. macOS CI cannot grant notification permission
   without a person, so there it checks only that the app requested it; the macOS
   click is accepted by hand (Try it) until a signed build can be pre-authorised.
4. Hostile page: the app is paired with a fixture "World" origin serving a page that
   calls Tauri IPC directly, opens `window.open` to `file:`, `intent:`, `tauri:` and a
   custom scheme, navigates to another paired World's origin and answers the stream
   with a redirect. Pass: no command ran (the app's command log), the World view
   stayed on its origin, only `http`/`https` reached the system-browser opener (an
   OS-level stub: `BROWSER` on Linux, a registered handler on Windows and macOS), and
   no cookie left its origin.
   The fixture page also auto-submits a `<form method="post">` to another origin and
   posts to its own origin, which answers `307` to another origin. Pass: the
   cross-origin `POST` never reaches the other origin's recorder and the view stays
   on its World; after the `307` the view is back on its World with no history entry
   for the other origin, and the fixture's beacon shows whether that page's script
   ran (it must not, or the design returns for review).
5. Forget: forgetting the World leaves no file naming its origin or holding its cookie
   once clean-up completes (after a restart where the platform needs one).

**All-in-one, per desktop package**, on a fresh runner account with no World, no
Herdr and every `HERDR_*` variable cleared (desktop runners are disposable):
6. The app is started with `--start-local-world` (the same action as the first-run
   button): it installs World's service from the bundled executable through
   `service install --host 127.0.0.1`, World listens on loopback only (a connection
   to the runner's LAN address is refused), the app pairs through `url --json`, and
   Town is visible. No token is left on disk, as in step 1.
7. Agent walk: on Linux and macOS, `scripts/release-walk.ts` runs its journeys
   against that installed service (a new `--service-installed-by-app` mode that skips
   its own archive install), with herdr-core installed the way World's UI does it;
   on Windows, where the release walk does not run today, an isolated herdr-core
   runtime, a scratch agent and `herdr-world ask` must notify and open that agent.
8. One World per machine: a second app start finds the running World and starts
   nothing; with a standalone World installed first from the same archive, the app
   connects to it and leaves its service definition and data folder untouched.
9. Update, on every desktop package (both `.dmg`, the `-setup.exe`, the AppImage and
   the `.deb`), whether or not the owner's updater key exists: each job also builds
   the same commit at a lower test version `<v>-smoke`, with a throwaway updater
   key's public half (section 10), and installs that first with its World started
   and a scratch agent. The update then installs this job's package: through the
   updater for `.dmg`, `-setup.exe` and AppImage, from a test `app-update.json`
   naming the updater file built with the package (`.app.tar.gz`, `-setup.exe`,
   `.AppImage`) and a test signature beside it (bytes unchanged; the test signature
   and the `-smoke` build are never uploaded); through `apt install ./<package>.deb`
   and an app start for the `.deb`. Two cases, each from a fresh install:
   - World running: the app's log shows stop, replace, finish and start in that
     order (the `.deb`: replace, finish with its restart); World answers on its
     port with the new version, a new process ID in `instance.lock` and the
     definition naming the new executable (AppImage: the new `world/<version>/`
     copy, the old folder gone); the scratch agent's terminal is still there.
   - World stopped from the tray first: after the update and after a second app
     start World is still stopped, the definition names the new executable, and
     the marker is gone.
   The app's unit tests (task 3.7) cover the same sequence on a fake service
   manager for every platform, plus a failed stop (nothing replaced), a crash
   between each pair of steps (resumes at Finish), a failed replacement (old
   version started again) and a refused or silent start (message shown).
10. Quit leaves the service running; `herdr-world service uninstall` through the
    tray removes it; the uninstaller removes the app and keeps World's data folder.

**Release (#1374).** Mapped onto the release candidate contract #1374 merged:
- `release-candidate.yml` gains a job `native-apps` that calls `native-apps.yml` with
  the version, and `verify` lists it in `needs` and in its `if` like every other
  contract job. `scripts/release-seal.ts` adds `native-apps` to `CONTRACT_JOBS`, so
  the seal records its result and refuses anything but success (cancelled or skipped
  is not success).
- `native-apps` needs `archives` too: its desktop jobs take World's executable from
  the `verified-archives` artifact, so the app carries the exact bytes the `package`
  job built and tested and the release walk walked. World is never built a second
  time for the app.
- `verify` downloads `native-packages` into `candidate/github/`, so the app packages
  are inside the sealed `verified-release` artifact, are what `publish` uploads from
  `candidate/github/*`, and are compared byte for byte against an existing release
  like every other asset.
- A rerun of `release.yml` that finds a valid seal reuses those retained bytes and
  skips the candidate, so packages are neither rebuilt nor signed again.
- Secrets are forwarded by name at each hop: `release.yml` passes
  `ANDROID_RELEASE_KEYSTORE`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`,
  `ANDROID_RELEASE_KEY_ALIAS` and `ANDROID_RELEASE_KEY_PASSWORD` to the candidate;
  `release-candidate.yml` declares them under `workflow_call.secrets` (optional) and
  passes them to `native-apps.yml`, which declares them too and exposes them only to
  the Android signing step. No `secrets: inherit`.
- Package set without the Android key: the two `.dmg`, the `-setup.exe`, the
  `.AppImage` and the `.deb`; the release notes say "No Android APK in this
  release: the release signing key is not set up yet". With the key, the `.apk` is
  added. With the owner's updater key (section 10) the updater files are added: the
  signed `.app.tar.gz` per macOS architecture, the `.sig` beside the `-setup.exe` and
  the `.AppImage`, and `app-update.json` naming them. `verify` adds each package's
  SHA-256 to the release checksum list before it seals, so updater files are sealed
  and published like every other asset and a rerun reuses them.
- Release secrets forwarded the same way: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, exposed only to the step that signs updater
  files.
- The app version is the World version, so channels never disagree. #1374 is merged
  (`release-candidate.yml`, `scripts/release-seal.ts`); the hook lands with task 4.3,
  and until then `native-apps.yml` runs on PRs and by hand only.

### 10. Signing

- Test builds: the Android job makes a throwaway keystore in the runner's temp folder
  and deletes it in an `always()` step; the APK is named `-test`. macOS builds are
  ad-hoc signed (`-`), Windows builds unsigned. The update smoke (section 9, step
  9) uses, in every run, a throwaway updater key pair made in the run (its public key
  built into that run's `-smoke` test app only) and deleted in an `always()` step.
- Updater key: Tauri's updater checks a signature made with a key pair whose public
  half is built into the app. That key is a release key and belongs to the owner, like
  the Android key: the crew never creates, commits or uploads it. Until its secret
  exists, release builds are made without the updater, the app's "Check for updates"
  opens the release page, and the build asks in Needs you when the first updatable
  release is due. A key made later cannot update apps built before it existed, so
  those users download one new version by hand; the install guide says so.
- Release: the Android job signs only when the owner's key secrets exist (section 9);
  otherwise the release attaches no APK, because a test-signed APK cannot later be
  updated by a release-signed one. The keystore is written to the runner's temp folder
  only for the signing step and deleted after it. Apple Developer ID and Windows code
  signing plug into the same jobs, through the same forwarding, when the owner has
  them. Nothing in the repository or workflow creates, commits or uploads a release
  key; the build asks in Needs you when the first signed APK is due.
- Install guide (`docs/native-apps.md`): macOS needs System Settings → Privacy &
  Security → Open Anyway for an unsigned app; Windows SmartScreen needs More info →
  Run anyway; Android needs "Install unknown apps" for the browser or file manager.
  The all-in-one `.dmg` is meant to be notarized; until the owner's Developer ID
  exists it ships ad-hoc signed, and spike 1.3 checks whether launchd may run the
  bundled World from a quarantined, unnotarized app after Open Anyway. If it may not,
  the guide gives the one `xattr` step, or the `.dmg` waits for notarization and the
  release notes say so.

### 11. Storage owned by the app

The storage catalog (`server/src/storage/catalog.ts`) gains an `app` store kind and
lists, with owner `native-apps`:

| Location | Meaning | Identity | Role | Limit and clean-up |
|---|---|---|---|---|
| `worlds.json` | Paired Worlds: app ID, origin, name, notification switch, added time, state | app ID | source | none: the user forgets a World |
| `worlds.json#pendingStoreDeletes` | Store IDs awaiting removal | store ID | derived | emptied at next start |
| World store: desktop `data_directory`, macOS data store identifier, Android profile `world-<id>` | World's session cookie, web storage and cache, written by World's page | app ID | cache | engine quota; deleted by Forget |
| Android notification channel `world-<id>` | Per-World notification settings | app ID | source | deleted by Forget |
| Launch at login entry (Launch Agent, registry value, autostart file) | Start hidden at login | one per install | source | removed when turned off |
| `worlds.json#lastEventId` per World | Where the stream resumes (boot ID and sequence, no content) | app ID | derived | overwritten; removed with the World |
| `worlds.json#local` | Which installation runs the World on this computer (`app`, or the path and kind of another installation) and the World version the app last ran | one per install | derived | rewritten at each start by detection (section 12) |
| `worlds.json#update` | An app update in progress: target version and whether World was running and must be started again (12.5) | one per install | derived | removed when the update's start step ends or fails |
| AppImage only: extracted World executable `world/<version>/herdr-world` in the app data folder | The executable World's service runs, at a stable path | version | cache | the previous version is deleted after an update succeeds |
| `herdr-world` command link (`~/.local/bin` on macOS and Linux, user `PATH` entry on Windows) | Lets agents and the user run `herdr-world ask` | one per install | source | created only when no `herdr-world` exists; removed when the app's World is removed |

World's own data folder, service definition and service environment file are not new:
they are World's existing stores, written only by World's own `service install`, and
the app never writes them directly.

and one `memory` row for the stream replay ring (`notifications`, boot ID and
sequence, 32 events / 10 minutes). The install guide describes the same stores for
users.

### 12. All-in-one desktop: World on this computer

Every direct-download desktop package carries World's service. The client parts above
are unchanged; this section adds how the app finds, starts, keeps and updates a World
on the same computer. Android and future store builds leave it out.

**12.1 What ships, per platform.** The release already builds and tests one
`herdr-world` executable per platform (`package` job, `herdr-world-v<v>-<platform>.tar.xz`)
and walks it (`release-walk`). The app ships that file unchanged as a Tauri sidecar
(`bundle.externalBin`), beside the archive's `VERSION` file:

| Package | Where World's executable lives | Service definition points at |
|---|---|---|
| `.dmg` (arm64 from `darwin-arm64`, x64 from `darwin-x64`) | `Herdr World.app/Contents/MacOS/herdr-world`, covered by the app's signature | that path; the app re-runs `service install` at start if the app was moved |
| Windows `-setup.exe` (from `windows-x64`) | the per-user install folder `…\Programs\Herdr World\herdr-world.exe` | that path |
| `.deb` (from `linux-x64`) | `/usr/lib/herdr-world-app/herdr-world`, not on `PATH` (spike 1.3 checks Tauri's default sidecar placement and moves it if it lands in `/usr/bin`) | that path |
| `.AppImage` (from `linux-x64`) | inside the image, whose mount path changes at every start | a copy the app extracts to `world/<version>/herdr-world` in its data folder after checking its SHA-256 against the one built into the app |

No package builds World from source; the sidecar's SHA-256 must equal the archive's
checksum entry or the build fails. Linux and Windows arm64 apps are not in this
version (the archives exist; the app runners and smoke tests come later).

The app does not supervise World itself: it starts and stops World only through World's
existing service commands (12.3).

**12.2 One World per machine.** At every start, before offering anything, the app
detects, in this order, using only read-only checks:
1. A World listening for the default data folder: `instance.lock` in World's data folder
   names a live process and its loopback address.
2. A World service definition for this user (systemd user unit, launchd LaunchAgent or
   Windows task carrying World's generated marker, as `service status` finds it) and the
   executable it runs.
3. Another `herdr-world` installation without a service: on `PATH`, in the standalone
   installer's folder, Homebrew's prefix or npm's global folder. A `herdr-world`
   link the app made to its own executable (12.7) counts as the app's.

| Found | What the app does |
|---|---|
| 1 or 2, run by another installation (installer, Homebrew, npm) | Connects to it as a client: gets the login link with that installation's `herdr-world url --json`, pairs it (section 3; when World gives no token link, for example with a fixed password, the app opens World's login page) and lists it as "This computer (Homebrew)" and so on. Its bundled World stays unused. Updates stay with that installation's channel |
| 1 or 2, run by this app's executable | Connects to it |
| 2 stopped | Offers "Start World", which runs that executable's `service restart` (an older installation may lack `service start`) |
| 3 only | Offers "Start the installed World" (that executable's `service install --host 127.0.0.1`) or "Use this app's World" |
| nothing | First run screen: "Start World on this computer" (12.3) or "Connect to another World" (section 3) |

Two services never share a data folder: every installation uses the same service label
(`dev.herdr-world`), so installing one service replaces the other's definition, and
World's instance lock already refuses a second listener on a folder. Both installed:
whichever installation last ran `service install` runs World; the data folder is the
same, so Town, boards and settings carry over and nothing is copied. Moving from the
app to Homebrew: `brew install` and `herdr-world service install`; the app notices at
its next start and becomes a client. Moving back: the tray's "Run World from this app"
asks, refuses when the other installation is a newer version than the app's World
(an older World is not run over newer data; update the app first), and runs the
bundled `service install`. Removing the app's World ("Remove World from this
computer") runs `service uninstall`, which keeps the data folder. The app never
uninstalls or edits another installation.

**12.3 Service lifetime: World's existing service manager.** "Start World on this
computer" runs the bundled executable's `service install --host 127.0.0.1` (12.6): a
systemd user service, launchd LaunchAgent or Windows logon task, exactly what the
standalone installer sets up. World therefore runs in the background from then on,
starts at login whether or not the app does, and keeps running when the app quits.
There is no "only while the app is open" mode: it would make the app a second
supervisor, and quitting would stop World. The tray offers Stop World (asks first, as
section 6 says), Start World and Remove World from this computer. World's `service`
command gains `start` and `stop` (today it has install, status, restart, reload,
uninstall, logs); they call the same systemd, launchd and Task Scheduler operations
`restart` and `uninstall` already use. Quitting the app,
updating it or stopping World never stops Herdr, herdr-core or an agent.
Uninstalling: the Windows uninstaller and the `.deb`'s `prerm` run `service uninstall`
for the current user when the service runs this app's executable; on macOS, dragging
the app to the Bin leaves a LaunchAgent pointing at a missing file, so the guide says
to choose Remove World from this computer first, and any later `service install` from
another installation replaces the stale definition.

**12.4 Runtimes.** The app does not ship or update herdr-core or Herdr. A fresh
computer has neither; World's existing first-run flow covers that: World's UI probes
the computer and, after the user confirms, installs herdr-core with World's reviewed
copy of core's installer (`server/src/herdr-core/install.ts`,
`scripts/herdr-core-install.sh` and `.ps1`), which verifies the release checksum, sets
core to start at login, and never replaces, updates or removes an installed core or
Herdr. Core updates itself through its own channel. The app's update path (12.5) skips
`herdr upgrade`, so updating the app never touches a runtime; World's UI already says
when a runtime is older than it supports, and the user upgrades it.

**12.5 Updates.** App and World update together, as one signed package:
- The app checks `app-update.json` on the release (at most daily and from the tray),
  shows the version, and installs only after Tauri's updater verifies the signature
  against the public key built into the app (`.dmg` builds: the `.app.tar.gz`;
  Windows: the NSIS `-setup.exe`; AppImage: the image). Nothing downloaded is run
  before that check.
- Around the install the app runs one sequence: stop → replace → finish → start.
  It cannot rely on `update --finish-install` to bring World back: that command's
  restart (`restartServiceUsing`, `server/src/cli/update-finish.ts`) succeeds
  without starting an installed service that is not running, and World is stopped
  at that point. So the app starts World itself, explicitly:
  1. *Record.* The bundled executable's `service status --json` (new) reports
     `installed`, `active` and `ownedByApp`: the definition runs an executable
     inside this app (the same definition check `restartServiceUsing` makes,
     against the app's executable path, or on AppImage any `world/<version>/`
     copy in the app's data folder). The app writes `worlds.json#update` =
     `{to, restart}` before anything stops; `restart` is true only when the
     service is installed, active and owned by the app. A service the user
     stopped, or one another installation owns (12.2), gives `restart: false`.
  2. *Stop.* When `restart` is true, the app runs `service stop`. `start` and
     `stop` are ownership-checked like `restartServiceUsing`: they act only when
     the definition runs the executable invoking them (AppImage: any copy in the
     app's `world/` folder), and otherwise exit non-zero and change nothing. If
     the stop fails, the update is abandoned before anything is replaced, the
     marker is removed and World keeps running.
  3. *Replace.* The updater installs the verified package and restarts the app.
     On Windows the NSIS pre-install hook also runs the installed executable's
     `service stop`, which is a no-op after step 2 and ends the task when someone
     runs the installer by hand over a running World (a running `.exe` cannot be
     replaced). The hook never starts World.
  4. *Finish.* At the first start after the update the app finds the marker. When
     the app's World is installed (running or stopped) it runs the new bundled
     executable's `update --finish-install` with `HERDR_WORLD_SKIP_HERDR=1`
     (integration sync; runtimes left alone; its restart step finds World stopped
     and does nothing). The AppImage first extracts the new version, checks its
     SHA-256 and repoints the definition with `service install --no-start` (new:
     writes and enables the definition without starting it, and keeps the
     environment file), so a stopped World is not started by the repoint.
  5. *Start.* Only when `restart` is true, the app runs the new executable's
     `service start`, then waits up to 30 s for World to answer on the port in
     its `instance.lock`. Success removes the marker (and, on AppImage, the old
     version's folder). If the start is refused or World does not answer, the app
     shows "World did not start after the update" with Start World and the
     service log, and removes the marker.
  When `restart` is false, nothing is started and the user's stopped World stays
  stopped. The marker makes the sequence survive the app's own restart and a
  crash or power loss between steps: the next start resumes at Finish. If the
  replacement failed (the app starts on its old version with a marker naming a
  newer one), the app runs its own executable's `service start` when `restart` is
  true, removes the marker and reports that the update did not install.
- The `.deb` has no in-app updater (Tauri's updater does not install `.deb`): the app
  says a new version exists and links the release page. An apt repository can come
  with the store work. The user installs the new `.deb` with apt; Linux replaces the
  executable's file while the old process keeps running, so no stop is needed, and
  the `.deb`'s `prerm` runs `service uninstall` only on removal (`remove`), never on
  `upgrade`. The app records in `worlds.json#local` the World version it last ran;
  at its next start (launch at login or by hand), a bundled version that differs
  runs the same Finish step, and `update --finish-install`'s own restart then moves
  a running World onto the new file and leaves a stopped one stopped. Until the
  app next starts, World keeps running the old version.
- `herdr-world update` and World's web update refuse an app-managed executable already:
  the `VERSION` file beside it marks it as package-managed
  (`updateInstallationBlockReason`). The build changes that message to "Update through
  the Herdr World app" when an app marker file sits beside it. The retained seal and
  rerun rules (section 9) cover the updater files, so an update installs only bytes
  the release sealed. Without the owner's updater key there is no updater (section 10).

**12.6 Security defaults.** First run listens on loopback only: the app passes
`--host 127.0.0.1` to `service install`, a new flag that writes `HOST` into World's
service environment file (today a new file gets `HOST=0.0.0.0`; an existing file is
otherwise kept as today). World's login policy is unchanged: the app takes the login
link from `herdr-world url --json` over a pipe, opens it only in the pairing view
(section 3), and never shows, stores or logs it. Letting other devices reach World is
an explicit choice in the World list ("Let my phone and other devices on this network
reach World"): it says what that allows, then re-runs `service install --host
0.0.0.0`, and shows World's QR code from `url --json` so the phone app can pair. The
switch back runs `--host 127.0.0.1`. World stays on the home network or the user's VPN
(section 8); nothing exposes it to the internet.

**12.7 The `herdr-world` command.** Agents call `herdr-world ask`, so the command must
exist. When no `herdr-world` is on `PATH`, starting the app's World links
`~/.local/bin/herdr-world` to the bundled executable (macOS, Linux; on Linux the
AppImage's extracted copy), or the NSIS installer adds the install folder to the
user's `PATH` (Windows). When one exists, it is another installation (12.2) and the app
does not start its own World. Removing the app's World removes only a link the app
made.

## Names

Test builds: app name "Herdr World", identifier `dev.herdrworld.app` (store names
later, under the organisation). The bundled list page reuses World's icons.

## Risks / Trade-offs

- WebKit engines differ from the Chromium World tests on. Mitigation: smoke tests show
  Town on each OS; macOS already matches Safari, which the PWA supports.
- Tauri's Android support is younger than its desktop support, and the Kotlin plugin
  owns everything Android-specific. Spike 1.1 proves profiles, Forget, the service and
  APK size before the rest is built; failure returns the design to review.
- Requiring `MULTI_PROFILE` and `DELETE_BROWSING_DATA` excludes devices with an old
  WebView until it updates from the store.
- Doze without the battery exemption delays notifications and can lose those older
  than the replay window. Needs you keeps every ask.
- Battery: a persistent connection costs some battery; it is visible, switchable per
  World and measured against a baseline.
- Until the owner's updater key exists, and always for Android and `.deb`, users
  update by downloading; the AppImage's engine ages with it. Mitigation: OS-patched
  engines elsewhere, an AppImage per World release, and the signed updater once the
  key exists.
- All-in-one: an unnotarized macOS app may not be allowed to run its bundled World
  under launchd (spike 1.3); then the `.dmg` waits for notarization or the guide gives
  the manual step. Windows locks a running executable, so updates end World's task
  first; spike 1.3 proves the NSIS hooks. A user who deletes the macOS app without
  removing its World leaves a stale LaunchAgent until another `service install`
  replaces it.
- Two installations on one computer share one data folder by design. The app refuses
  to run its World over data from a newer World, but an older standalone installation
  started by hand over newer data is outside the app's control, as it is today.
- The stream is a new authenticated route. It is read-only, bounded, keeps only an
  in-memory replay ring and reuses the existing notification decision and session
  binding.

## Migration

None: new packages, one new read-only route, a refactor that moves Focus and
currency checks in front of Web Push without changing what Web Push sends, and three
additions to World's `service` command (`--host`, `start`, `stop`) that leave existing
service definitions and environment files as they are. The PWA, Web Push and every
existing installation keep working; an app installed beside them uses them (12.2).
