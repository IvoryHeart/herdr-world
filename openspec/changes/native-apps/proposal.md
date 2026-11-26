## Why

People want Herdr World as an app they download and install: an Android APK and
desktop installers for macOS, Windows and Linux. Today World is a website and an
installable PWA. In a browser tab, notifications need Web Push, which needs a
secure page (HTTPS or localhost), a browser push service and, on iPhone, an
installed web app. On a home network over plain HTTP the PWA cannot notify at all.

This change designs the apps. Store accounts and listings come later, under an
organisation; this change builds direct downloads only.

**Design first.** The build starts only after this design is approved (#1400).

## What Changes

- Add **Herdr World apps**: one Tauri 2 codebase in `apps/native/` that builds an
  Android APK and desktop installers (`.dmg` for macOS arm64 and x64, `.msi` and
  `.exe` for Windows, `.AppImage` and `.deb` for Linux). iOS would be a later
  platform integration in the same project.
- **Platform minimums:** Android with a current Android System WebView (per-World
  profiles that can be deleted), macOS 14, Windows 10 with WebView2, Linux with
  WebKitGTK 4.1.
- The app **wraps the user's own World** at World's own origin, exactly as a
  browser opens it. It bundles no copy of World's web app, adds no cross-origin
  bridge, adds no script of its own and needs no Host, Origin or CSP
  configuration. Its only bundled page is its own small World list, which never
  talks to a World and is the only page with native commands. Other origins open
  in the system browser; other schemes and page-opened windows are refused.
- **Pairing:** scan World's QR code (Android) or paste a login link from
  `herdr-world url` (every platform). The app keeps a list of Worlds by origin and
  name. It never stores the login token or a password: the session is World's
  ordinary login cookie, held only in that World's own web view store. The token
  never reaches web view history or saved state. A new link for a listed World
  signs it in again. Sign out and Forget this World are explicit; Forget deletes
  everything the app holds for it, finishing at the next start where the platform
  requires.
- **Notifications:** the app keeps its own connection to each paired World and
  shows an OS notification when World decides a notification is due (an agent is
  blocked, finished or asks the user). Tapping it opens World at that agent
  through the existing `#herdr-world-task=` link. World adds one read-only,
  login-protected event stream, `/api/notifications/stream`. World's notification
  decision (Focus, currency) moves in front of Web Push and feeds both sinks
  independently, so the stream works without Web Push configured. A small
  in-memory replay window covers short reconnects. No push relay.
- **Android background:** a `specialUse` foreground service, on by default and
  switchable per World, holds the connection, restarts after reboot and process
  death, and waits while no network reaches World. Doze behaviour and battery cost
  are measured on a real phone. UnifiedPush is not used because it needs World to
  post through a distributor server, which is a push relay.
- **Desktop:** a tray or menu-bar item and launch at login (off until the user
  turns it on). Closing the window keeps the app in the tray.
- **Android share sheet:** text and links shared to the app open World's existing
  Find or act box with that text. Files are not part of v1.
- **Builds:** a `Native apps` workflow builds every package on GitHub runners and
  smoke-tests each shipped file on its OS against a synthetic test World: pairing,
  Town visible, a notification and a hostile page. The release candidate contract
  (#1374) makes it a sealed contract job and publishes only the sealed packages.
- **Signing:** test builds use throwaway keys made inside the run and discarded.
  The owner's Android release key and later Apple and Windows certificates are
  used only from repository secrets the owner adds; nothing creates, commits or
  uploads a release key. Install docs say how to open unsigned builds.

## Capabilities

### New Capabilities

- `native-apps`: installable World apps: one-origin wrapping, pairing and
  session storage, sign out and forget, native notifications, Android background
  connection and share, desktop tray and launch at login, builds, smoke tests and
  signing boundaries.

### Modified Capabilities

- `world-surfaces/notifications`: World's notification fan-out also feeds a
  read-only event stream for the apps; the page opens a notification target that
  arrives after it has loaded.

## Impact

- New `apps/native/` (Tauri 2: Rust, a Kotlin Android plugin, the bundled World
  list page) with its own lockfile; World's Bun service and web build stay as
  they are and never import it.
- Server: one new GET route beside `/api/notifications/push` and a notification
  fan-out in front of Web Push, using the same login cookie and admission. No
  change to World's login, origin, cookie or CSP model.
- Storage catalog: the app's own stores (World list, per-World web view stores,
  Android notification channels, launch-at-login entry) and the stream's
  in-memory replay ring.
- Web: `taskNotifications.ts` also reacts to a `#herdr-world-task=` hash set after
  load; a `#herdr-world-find=` hash opens Find or act with shared text; Settings
  explains that the app delivers notifications when the page is inside it
  (detected from the app's user agent suffix).
- CI: `.github/workflows/native-apps.yml`, path-filtered to the app, plus a
  `workflow_call` entry for the release candidate, which also forwards the
  signing secrets by name.
- Docs: an install guide for the apps (unsigned-build warnings, pairing, sign out,
  forget) and `native-apps` notes.
- Out of scope: store accounts, listings, privacy labels and upload; iOS builds;
  a push relay; analytics; changes to World's server security, origin or login.
