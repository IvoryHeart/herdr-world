## Context

World is one Bun service and a same-origin React web app. People reach it on their
home network or their own VPN and sign in with a login link, password or PIN; the
session is World's HttpOnly `herdr_world_auth` cookie (30 days, not refreshed).
`herdr-world url [--qr] [--address <host>]` prints the login link
`http(s)://<host>:<port>/?token=<token>`; World answers it with a 303 that drops the
token and sets the cookie (`server/src/http/auth.ts`). The bridge-access contract
already admits originless native clients under the normal login policy.

World decides OS notifications in one place: `webPush.notify` in
`server/src/service/world-service.ts`, fed by Herdr task events (including the
custom notification every `herdr-world ask` raises), herdr-core runtimes and the
assistant/bin. `taskPushPayload` (`server/src/notifications/web-push.ts`) turns
each into `{title, body, tag, target}`; the service worker opens
`/#herdr-world-task=<target JSON>` and `web/src/taskNotifications.ts` navigates to
the qualified target, refusing stale ones.

No system web view supports the Web Push or web Notification APIs (WKWebView,
Android WebView; WebView2 only through a host event). A wrapped page therefore
cannot notify by itself: the app needs its own connection and native
notifications. The PWA is unchanged.

Upstream Herdr Web has a Capacitor Android shell (`capacitor.config.ts`,
`android/`) that bundles `web/dist` and talks to the bridge across origins. That
model breaks World's one-origin rule; only its icons and manifest settings
(`allowBackup="false"`, `singleTask`) are worth keeping.

## Goals / Non-Goals

Goals: an Android APK and desktop installers that open the user's own World,
pair by QR code or login link, notify when an agent needs the user and open at
that agent, sit in the tray and launch at login, accept shared text on Android,
and build and smoke-test on GitHub runners.

Non-goals: store accounts, listings and upload; iOS builds; a push relay
(Firebase, APNs, UnifiedPush distributors); analytics or diagnostics; any change
to World's login, cookie, origin, CSP or listener policy; an app updater (v1
users download a new version; the release page lists it).

## Decisions

### 1. Framework: Tauri 2

| | Tauri 2 | Electron (desktop) + Capacitor (Android) |
|---|---|---|
| Codebases | One: Rust core, one bundled list page, a Kotlin Android plugin; iOS from the same project later | Two stacks: Electron (Node) and Capacitor/Android, iOS a third shell |
| Size | Desktop installers about 3–15 MB (`.deb`, `.dmg`, `.msi`); AppImage 70+ MB because it bundles WebKitGTK; a real Tauri APK is about 40 MB, a wrapper should be well under (measure in 1.1) | Electron installers about 85–270 MB; Capacitor APK a few MB |
| Engine updates | System web view, patched by the OS (WebView2 evergreen, WKWebView with macOS, WebKitGTK with the distro, Android WebView through the store) | Electron ships its own Chromium; only the latest three majors (8-week cadence) are supported, so without an updater a v1 build is unsupported within about six months |
| Remote page access to native code | None unless a capability names the remote URL; we grant none | Electron: none with `contextIsolation`, sandbox and no preload. Capacitor injects its bridge into the `server.url` origin, giving the World page every plugin, and documents `server.url` as live reload, "not intended for production" |
| Notifications | `tauri-plugin-notification` ≥ 2.6 reports desktop clicks to Rust (`on_action`); Android through the Kotlin plugin | Electron `Notification` click; Capacitor local-notifications |
| Tray, autostart | Built-in tray; official autostart plugin (Windows, macOS, Linux) | Tray built in; `setLoginItemSettings` lacks Linux |
| QR scan | Official barcode-scanner plugin (Android, iOS) | Capacitor community plugins |
| CI | `tauri-action` builds `.dmg` (arm64 and cross-compiled x64 on Apple Silicon), `.msi`/`.exe`, `.AppImage`/`.deb`; `tauri android build --apk` on Ubuntu | electron-builder for desktop; Gradle for Android |
| Engine risk | WKWebView and WebKitGTK are WebKit: World already supports Safari for the PWA; WebKitGTK can fall back to slow canvas/WebGL and has NVIDIA DMABUF issues | Same Chromium World's browser tests use |

**Choice: Tauri 2.** It is the only option with one codebase for Android, desktop
and later iOS; its packages are small; the OS keeps its engine patched, which
matters because v1 has no updater and the page it wraps can run shells; and its
default denies native access to remote pages, which is exactly the one-origin
rule. Capacitor's main value, a JS bridge into bundled web content, is what this
design must not use. Its costs are accepted: Linux WebKitGTK quirks (the smoke
test opens Town; the install guide documents `WEBKIT_DISABLE_DMABUF_RENDERER=1`
and recommends the `.deb`), a Kotlin plugin for Android background work, and Rust
build time in CI.

Sources: Tauri capabilities (v2.tauri.app/security/capabilities), Webview cookies
(docs.rs/tauri, added in 2.4.0), notification plugin release notes 2.6.0
(v2.tauri.app/release/notification), autostart (v2.tauri.app/plugin/autostart),
AppImage size (v2.tauri.app/distribute/appimage), Linux graphics
(v2.tauri.app/develop/debug/linux-graphics), CI (v2.tauri.app/distribute/pipelines/github),
Electron timelines and security (electronjs.org/docs), Capacitor config
(capacitorjs.com/docs/v3/config) and issue ionic-team/capacitor#5745, WKWebView Web
Push (developer.apple.com/forums/thread/760767), WebView2 `NotificationReceived`
(learn.microsoft.com), GitHub `macos-13` retirement (github.blog changelog
2025-09-19).

### 2. One origin

The main window loads `WebviewUrl::External(<World origin>)` (on Android, the
plugin's World web view; see section 3). The app grants no
capability with `remote.urls`, so World's page cannot call native commands.
Navigation outside the World's origin is cancelled in the navigation handler and
opened in the system browser. The app does not inject scripts into World pages.
It appends `HerdrWorldApp/<version> (<platform>)` to the web view's user agent; the
page uses that only to say, in Settings, that the app delivers notifications.

The app's own bundled page is the World list (pairing, choose, sign out, forget,
per-World notification switch). It is the only page with native commands and
never fetches a World origin: pairing hands the link to the web view, not to
`fetch`. It is not a copy of World's web app.

The app never relaxes World's server: requests from the web view are ordinary
same-origin browser requests, and the app's notification connection is an
originless native client the bridge-access contract already admits.

### 3. Pairing and where the session lives

- Input: Android scans the QR code with the official barcode-scanner plugin
  (CameraX and the bundled ML Kit model, no Google Play services). Every platform
  accepts a pasted link or origin. Accepted: `http`/`https`, a host, path `/`, at
  most one query parameter, `token`. Anything else is refused before it is stored.
- Stored, in the app's data folder (`worlds.json`): a random app ID per World (it
  names the World's web view store), origin, display name (the
  host, editable), per-World notification switch, added time. Never the token, a
  password or a PIN. The link with its token goes only to the web view's first
  navigation; World's 303 strips it, so it stays out of history, and the response
  is `no-store`. Form-data saving is off in the web view.
- Session: World's own cookie in that World's own web view store, nothing else.
  Cookies are scoped by host, not port (RFC 6265 section 8.5), and every World
  names its cookie `herdr_world_auth` with `Path=/`, so two Worlds on one host
  (`world.example:9001` and `world.example:9002`) would overwrite each other's
  session in a shared store. The app therefore never shares a store between Worlds:
  - Desktop: each World gets its own web view data folder (`data_directory` on
    Windows and Linux, `data_store_identifier` on macOS).
  - Android: each World gets its own WebView profile (`androidx.webkit`
    `ProfileStore.getOrCreateProfile("world-<id>")`, `<id>` a random ID kept in
    `worlds.json`), with its own `CookieManager`, web storage and service workers.
    `WebViewCompat.setProfile` has to run before the web view loads anything, so on
    Android the Kotlin plugin owns the World web view (one activity, recreated when
    the user switches World) and Tauri's web view shows only the World list. That
    also keeps Tauri's command bridge out of World pages on Android.
  - Android without profiles (`WebViewFeature.MULTI_PROFILE` unsupported, an old
    WebView): Worlds share the default profile, and the app refuses to pair a World
    whose host already belongs to a paired World, naming that World. Each host then
    holds at most one World's cookie.
  World's login model is unchanged: the separation is entirely in the app.
- Several Worlds: the list shows each with its name and origin; opening one swaps
  the window's web view. A second pairing of an origin already listed is refused.
- **Sign out**: the app's native layer (Rust on desktop, Kotlin on Android) sends
  `POST <origin>/api/logout` with `x-herdr-world-logout: 1` and the cookie read
  from that World's store. It is an originless native request, which the logout
  route already accepts, so no script is injected into World's page. World revokes
  that session's Web Push enrolment as today and closes its streams (section 4).
  Logout does not invalidate the signed cookie on the server, so the app then
  deletes it from that
  World's store: an expired `herdr_world_auth` cookie through the profile's
  `CookieManager` on Android, and on desktop Tauri's cookie API, or clearing that
  World's own data folder where it cannot delete one cookie (spike 1.2 checks).
  The World stays listed. World's own Sign out inside the page keeps working.
- **Forget this World**: sign out when reachable, stop the connection, delete the
  entry, the web view data folder (desktop) or the profile with
  `ProfileStore.deleteProfile` (Android; with no profile support, that host's
  cookies, `WebStorage.deleteOrigin` data and the WebView cache), and the
  notification channel. No other World's data is touched. If World is unreachable
  the app says the World's own session could not be revoked; the cookie it cannot
  reach expires in 30 days and `herdr-world auth rotate` revokes every session at
  once.

### 4. Notifications

**Server (small, read-only).** A new `GET /api/notifications/stream`
(`text/event-stream`) beside `/api/notifications/push`, behind the same
admission and login cookie. Each event is exactly `taskPushPayload(...)` JSON;
`webPush.notify` gains a second sink that writes to open streams, after the same
`isCurrent` check. Query `completed=0|1&blocked=0|1` maps onto the existing
`PushPreferences` through the same `notificationPreference` mapping Web Push
uses (a message for the user follows the completed switch, as today). A comment
heartbeat every 45 s keeps NAT and VPN paths open. Logout closes streams bound to
that session (the same binding Web Push uses); a credential change makes the next
request fail. Streams are bounded (64 open, oldest closed first) and keep no
history and no storage: missing a notification while offline is acceptable
because Needs you keeps the durable item. No new persisted data.

**Client.** Desktop: a Rust task per World reads the cookie with
`cookies_for_url` (async on Windows), opens the stream with `reqwest`, and shows
notifications with `tauri-plugin-notification`; `on_action` opens the World at
`<origin>/#herdr-world-task=<target JSON>` and focuses the window. Android: the
Kotlin plugin's service reads the cookie from that World's profile
`CookieManager` (Tauri's cookie API returns nothing on Android) and holds the
stream; a notification's tap intent carries origin and target. Native notification
IDs join the World's app ID and the payload tag, because tags hold World-local
runtime identities and two Worlds can send the same tag. Same backoff everywhere:
2 s doubling to 5 min, reset on network change. A 401 stops that World and posts one "Sign in again" notification.
Both parsers run one shared fixture of stream frames.

**Web.** `taskNotifications.ts` also handles a `hashchange` to
`#herdr-world-task=`, so a tap reaches an already-open page; stale targets keep
today's refusal. No other web change: World still decides what notifies, and
the app only displays it.

### 5. Android background connection

A foreground service of type `remoteMessaging` holds the streams while any World
has background notifications on (default on after the notification permission is
granted). `dataSync` is ruled out: Android 15 caps it at 6 hours a day and forbids
starting it at boot. `remoteMessaging` has no timeout and may start at boot; its
store-review fit is a question for the later store listing, where `specialUse`
with a written reason is the fallback. The ongoing notification is silent and low
priority, and offers "Turn off".

UnifiedPush is not used: World would have to post each notification through a
distributor server, a push relay this item excludes. Firebase is excluded for the
same reason and because it requires Google Play services.

Battery cost: one idle TCP connection per World with a 45 s heartbeat. ntfy, which
uses the same model, says it "consumes additional battery"; reports range from
under 1 % a day on Wi-Fi to more on mobile data. While World is unreachable the
backoff keeps attempts to at most one per 5 minutes. The build measures it
(task 4.4) on one phone over 8 hours with `dumpsys batterystats` and records the
number in the install guide. Doze can delay delivery; the guide says how to exempt
the app.

### 6. Desktop tray and launch at login

The tray (menu bar on macOS) lists paired Worlds with Open, Sign out, and Launch
at login, Quit. Closing the window hides it; Quit ends connections. Launch at login
uses the official autostart plugin (Launch Agent on macOS, registry on Windows,
`~/.config/autostart` on Linux), off by default, starting with `--hidden`. The
single-instance plugin focuses the running app. On Linux the tray needs
libayatana-appindicator; without a tray host, closing the window quits instead.

### 7. Android share target

An `ACTION_SEND` filter for `text/plain` opens a chooser of paired Worlds (skipped
when there is one) and loads `<origin>/#herdr-world-find=<text>`. The page opens
Find or act with that text and clears the hash. Files are out of v1: an upload
needs a terminal target and confirmation, which is more than small.

### 8. Reaching World

Exactly as the PWA: the home network or the user's own VPN. The app never offers
to expose World, never uses a relay and needs no World setting. Android allows
cleartext HTTP because World's LAN address is chosen at run time and a network
security config cannot list arbitrary IPs; the guide recommends HTTPS (see
`docs/DEPLOYMENT.md`) and the World list marks HTTP Worlds "Not encrypted".

### 9. Builds and smoke tests

`.github/workflows/native-apps.yml`, path-filtered to `apps/native/**` and the
stream route, plus `workflow_dispatch` and `workflow_call(version)`:

| Job | Runner | Output | Smoke |
|---|---|---|---|
| android | ubuntu-latest (KVM) | `herdr-world-<v>-arm64.apk`, x86_64 APK for the emulator | install on an API 35 emulator, paste the link, wait for Town |
| macos-arm64 | macos-latest | `.dmg` (aarch64) | mount, copy to /Applications, launch with `--pair` |
| macos-x64 | macos-15-intel (until 2027) | `.dmg` (x86_64) | same |
| windows | windows-latest | `.msi`, `.exe` (WebView2 download bootstrapper) | silent install, launch |
| linux | ubuntu-22.04 | `.AppImage`, `.deb` | `apt install ./*.deb` and AppImage under Xvfb |

The smoke World is a real World from the same commit on loopback, with a
temporary data folder, every `HERDR_*` variable cleared, a generated token and no
runtimes. A small recording proxy in front of it (test tooling in
`scripts/native-smoke/`) passes the app's requests through unchanged and records
them. Pass means: the token link was answered with the cookie, an authenticated
`GET /` and the web app's `/ws` came from the app's user agent, and the stream
opened with 200. The desktop binary accepts `--pair <link>`, the same as pasting
(a local command line is as trusted as the user's keyboard); there is no URL
scheme for pairing, so a website cannot pair the app with a hostile World.

**Release (#1374).** Once the release candidate contract is merged, its tag
workflow calls `native-apps.yml` with the release version. The packages are
uploaded as that run's artifacts and become part of the sealed set only when every
native smoke job succeeded (cancelled or skipped is not success, as for the other
channels). The GitHub release step attaches them. The app version is the World
version, so channels never disagree. Until #1374 merges, the workflow runs on PRs
and by hand only.

### 10. Signing

- Test builds: the Android job makes a throwaway keystore in the runner's temp
  folder and deletes it; the APK is marked test. macOS builds are ad-hoc signed
  (`-`), Windows builds unsigned.
- Release: the Android job signs only when `ANDROID_RELEASE_KEYSTORE` and its
  password secrets exist (added by the owner); otherwise the release attaches no
  APK and its notes say so, because a test-signed APK cannot later be updated by a
  release-signed one. Apple Developer ID and Windows code signing plug into the
  same jobs through `tauri-action` secrets when the owner has them. Nothing in the
  repository or workflow creates, commits or uploads a release key; the build
  asks in Needs you when the first signed APK is needed.
- Install guide (`docs/native-apps.md`): macOS 15 needs System Settings → Privacy
  & Security → Open Anyway for an unsigned app; Windows SmartScreen needs More
  info → Run anyway; Android needs "Install unknown apps" for the browser or file
  manager.

## Names

Test builds: app name "Herdr World", identifier `dev.herdrworld.app` (store names
later, under the organisation). The bundled list page reuses World's icons.

## Risks / Trade-offs

- WebKit engines differ from the Chromium World tests on. Mitigation: smoke tests
  open Town on each OS; macOS already matches Safari, which the PWA supports.
- Tauri's Android support is younger than its desktop support; the Kotlin plugin
  owns everything Android-specific. A first spike (task 1.1) proves cookie access,
  the foreground service and the APK size before the rest is built.
- Per-World Android profiles need a WebView with `MULTI_PROFILE` (androidx.webkit
  1.9+ API, a recent WebView from the store). Older WebViews fall back to one World
  per host, which is refused at pairing rather than broken later.
- Battery: a persistent connection costs some battery; it is visible, switchable
  per World and measured.
- Without an updater, users stay on old versions. Mitigated by the OS-patched
  engine; an updater can follow with signing.
- The stream is a new authenticated route. It is read-only, bounded, keeps no data
  and reuses the Web Push decision and session binding.

## Migration

None: new packages and one new read-only route. The PWA and Web Push keep working.
