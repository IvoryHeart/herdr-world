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
smoke-test the shipped bytes on GitHub runners.

Non-goals: store accounts, listings and upload; iOS builds; a push relay (Firebase,
APNs, UnifiedPush distributors); analytics or diagnostics; any change to World's
login, cookie, origin, CSP or listener policy; an app updater (v1 users download a
new version; the release page lists it).

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
| Size | Published desktop figures about 3–15 MB (`.deb`, `.dmg`, `.msi`); AppImage 70+ MB because it bundles WebKitGTK; this app's sizes are measured in spikes 1.1–1.2 | Electron installers about 85–270 MB; Capacitor APK a few MB |
| Engine updates | System web view, patched by the OS (WebView2 evergreen, WKWebView with macOS, WebKitGTK with the distro for `.deb`, Android WebView through the store). AppImage is the exception: its bundled WebKitGTK updates only when we ship a new AppImage | Electron ships its own Chromium; only the latest three majors (8-week cadence) are supported, so without an updater a v1 build is unsupported within about six months |
| Remote page access to native code | IPC is refused for a remote URL unless a capability names it (2.11.1+); we name none. Tauri still installs its framework IPC scripts in every web view it creates | Electron: none with `contextIsolation`, sandbox and no preload. Capacitor injects its bridge into the `server.url` origin, giving the World page every plugin, and documents `server.url` as live reload, "not intended for production" |
| Notifications | `tauri-plugin-notification` ≥ 2.6 reports desktop clicks to Rust (`on_action`); Android through the Kotlin plugin | Electron `Notification` click; Capacitor local-notifications |
| Tray, autostart | Built-in tray; official autostart plugin (Windows, macOS, Linux) | Tray built in; `setLoginItemSettings` lacks Linux |
| QR scan | Official barcode-scanner plugin (Android, iOS) | Capacitor community plugins |
| CI | `tauri-action` builds `.dmg`, `.msi`/`.exe`, `.AppImage`/`.deb`; `tauri android build --apk` on Ubuntu | electron-builder for desktop; Gradle for Android |
| Engine risk | WKWebView and WebKitGTK are WebKit: World already supports Safari for the PWA; WebKitGTK can fall back to slow canvas/WebGL and has NVIDIA DMABUF issues | Same Chromium World's browser tests use |

**Choice: Tauri 2, provisionally, as the better fit of the two compared.** It keeps
desktop and Android in one project and toolchain, its desktop packages are small,
most of its engines are patched by the OS (which matters because v1 has no updater
and the page it wraps can run shells), and remote pages get no native access by
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
- **Navigation** (desktop `on_navigation`, Android `shouldOverrideUrlLoading`), for
  top-level loads and redirects alike: allow only the exact paired origin (scheme,
  host and port) over `http`/`https`, and `blob:` URLs whose origin is that origin.
  Another `http`/`https` origin, including another paired World's, opens in the system
  browser and the app keeps showing the selected World; the selection never changes
  from inside a page. Everything else (`file:`, `data:`, `javascript:`, `intent:`,
  `tauri:`, `ipc:`, `asset:`, any custom scheme) is cancelled and never handed to the
  OS.
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
notification switch, added time and state (`signed-in`, `signed-out`, `forgetting`).
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
Both parsers run one shared fixture of stream frames.

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
| Process killed by the system | `START_STICKY`; the service restarts, reads `worlds.json` and reconnects with `Last-Event-ID` |
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
at login and Quit. Closing the window hides it; Quit ends connections. Launch at login
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
route and the fan-out, plus `workflow_dispatch` and `workflow_call(version)`. Each job
builds, signs (section 10), records the SHA-256 of each package, smoke-tests those
exact files and uploads them unchanged as the `native-packages` artifact.

| Job | Runner | Shipped package | Smoke |
|---|---|---|---|
| android | ubuntu-latest (KVM) | `herdr-world-app-<v>-android-arm64.apk` | install that APK on an x86_64 API 35 emulator image with ARM translation; if spike 1.1 finds translation unusable, the shipped APK becomes one universal APK (arm64 and x86_64) so the tested file is still the shipped file |
| macos-arm64 | macos-latest | `…-macos-arm64.dmg` | mount, copy to /Applications, launch |
| macos-x64 | macos-15-intel (until its 2027 retirement) | `…-macos-x64.dmg` | same |
| windows | windows-latest | `…-windows-x64.msi`, `…-windows-x64-setup.exe` | each in turn: silent install, smoke, uninstall |
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
5. Forget: forgetting the World leaves no file naming its origin or holding its cookie
   once clean-up completes (after a restart where the platform needs one).

**Release (#1374).** Mapped onto the release candidate contract in #1374:
- `release-candidate.yml` gains a job `native-apps` that calls `native-apps.yml` with
  the version, and `verify` lists it in `needs` and in its `if` like every other
  contract job. `scripts/release-seal.ts` adds `native-apps` to `CONTRACT_JOBS`, so
  the seal records its result and refuses anything but success (cancelled or skipped
  is not success).
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
- Package set without the Android key: the two `.dmg`, the `.msi`, the `-setup.exe`,
  the `.AppImage` and the `.deb`; the release notes say "No Android APK in this
  release: the release signing key is not set up yet". With the key, the `.apk` is
  added. `verify` adds each package's SHA-256 to the release checksum list before it
  seals.
- The app version is the World version, so channels never disagree. Until #1374
  merges, `native-apps.yml` runs on PRs and by hand only.

### 10. Signing

- Test builds: the Android job makes a throwaway keystore in the runner's temp folder
  and deletes it in an `always()` step; the APK is named `-test`. macOS builds are
  ad-hoc signed (`-`), Windows builds unsigned.
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

and one `memory` row for the stream replay ring (`notifications`, boot ID and
sequence, 32 events / 10 minutes). The install guide describes the same stores for
users.

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
- Without an updater, users stay on old versions; the AppImage's engine ages with it.
  Mitigation: OS-patched engines elsewhere, an AppImage per World release, and an
  updater later with signing.
- The stream is a new authenticated route. It is read-only, bounded, keeps only an
  in-memory replay ring and reuses the existing notification decision and session
  binding.

## Migration

None: new packages, one new read-only route and a refactor that moves Focus and
currency checks in front of Web Push without changing what Web Push sends. The PWA
and Web Push keep working.
