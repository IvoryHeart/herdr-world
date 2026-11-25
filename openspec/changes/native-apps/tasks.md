# Tasks

Design approved before any task starts (#1400). Each task lands with its tests.

## 1. Prove the risky parts first

- [ ] 1.1 Spike in `apps/native/`: Tauri 2 app that loads a synthetic World origin with no remote capability; on Android, prove a plugin-owned World web view with its own `androidx.webkit` profile per World (two synthetic Worlds on one host, different ports, keep separate sessions; deleting one profile leaves the other signed in), that the profile's `CookieManager` returns World's HttpOnly cookie, the same-host refusal when `MULTI_PROFILE` is unsupported, a `remoteMessaging` foreground service holds a stream with the activity closed, and measure the arm64 APK size. Record results here before 2.x.
- [ ] 1.2 Desktop spike: per-World `data_directory` / `data_store_identifier`, `cookies_for_url` and single-cookie deletion on all three OSes, two same-host Worlds on different ports keep separate sessions, notification `on_action` opening a hash.

## 2. World service and web (small)

- [ ] 2.1 `GET /api/notifications/stream` beside `/api/notifications/push`: second sink in `webPush.notify`, preferences, heartbeat, bound, logout closes; route tests for no cookie, cross-origin browser request, logout, currency, bound. Shared frame fixture in `apps/native/fixtures/`.
- [ ] 2.2 `taskNotifications.ts`: handle `hashchange` targets; `#herdr-world-find=` opens Find or act; Settings line for the app user agent. Unit and DOM tests.
- [ ] 2.3 Storage catalog: confirm no persisted World data is added; list the app's own `worlds.json` in the app's docs, not World's catalog.

## 3. The app

- [ ] 3.1 Bundled World list page: add (paste, QR on Android), validate links, refuse a same-host pairing where sessions cannot be separated, choose, rename, sign out, forget, per-World notifications; no World fetch. Tests for link validation and storage holding no token.
- [ ] 3.2 Window: external World origin, navigation to other origins to the system browser, user agent suffix, form-data saving off, swap web view per World.
- [ ] 3.3 Desktop notifications client (Rust): cookie, stream, backoff, 401 → sign-in notification, `on_action` deep link. Fixture tests.
- [ ] 3.4 Desktop tray, close-to-tray, autostart (off by default, `--hidden`), single instance, `--pair`.
- [ ] 3.5 Android Kotlin plugin: foreground service, cookie, stream, per-World profiles, native logout and cookie deletion, notification channels and tap intents with IDs namespaced by World, share target, Back to the World list, forget clean-up. JVM tests on the fixture.

## 4. Builds, smoke tests and docs

- [ ] 4.1 `.github/workflows/native-apps.yml`: Android, macOS arm64 and x64, Windows, Linux packages; throwaway test keys made and deleted in the run.
- [ ] 4.2 `scripts/native-smoke/`: real World on loopback with cleared `HERDR_*`, recording proxy, pass rules; fresh-install smoke job per OS.
- [ ] 4.3 `workflow_call(version)` and the release candidate hook once #1374 is merged; no APK without the owner's key secret.
- [ ] 4.4 Battery measurement on one Android phone (8 hours, `dumpsys batterystats`), recorded in the guide.
- [ ] 4.5 `docs/native-apps.md` install guide (unsigned warnings, pairing, sign out, forget, Linux WebKitGTK note, Doze), `native-apps` notes, notifications notes Code list, changelog fragment and help entry.
- [ ] 4.6 Ask in Needs you for the Android release key when the first signed release is due.
