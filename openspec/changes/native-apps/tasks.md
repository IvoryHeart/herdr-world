# Tasks

Design approved before any task starts (#1400). Each task lands with its tests. If a
spike shows the design cannot hold, the design returns for review before 2.x.

## 1. Prove the risky parts first

- [ ] 1.1 Android spike in `apps/native/` (Tauri ≥ 2.11.1, target SDK 36): plugin-owned World web view on its own `androidx.webkit` profile per World; two synthetic Worlds on one host at different ports keep separate sessions; the profile's `CookieManager` returns World's HttpOnly cookie; Forget with `deleteBrowsingData` + `removeAllCookies`, then `deleteProfile` at the next process start, leaves the other World signed in and no cookie, storage, cache or service worker of the forgotten one; the "Update Android System WebView" screen when `MULTI_PROFILE` or `DELETE_BROWSING_DATA` is missing; pairing view replaced by a fresh view, then `copyBackForwardList` (URL and original URL) and the data folder hold no token, also after restart; a `specialUse` service holding a stream with the activity closed, after process death and after reboot; the signed arm64 APK installs and runs on an x86_64 API 35 emulator image with ARM translation (else switch to a universal APK); APK size. Record results here before 2.x.
- [ ] 1.2 Desktop spike (Windows, macOS 14, Linux): per-World `data_directory` / `data_store_identifier`; `cookies_for_url` and single-cookie deletion; two same-host Worlds keep separate sessions; Forget removes the store (`remove(forIdentifier:)` on macOS, folder delete after releasing WebView2/WebKitGTK) or defers it to next start; pairing view replacement leaves no token in history or the data folder; capability scoped to the `list` web view and custom commands in `AppManifest`, World pages refused; `on_navigation` and `on_new_window` policy; notification `on_action` opening a hash; installer sizes.

## 2. World service and web (small)

- [ ] 2.1 Notification fan-out (`server/src/notifications/fanout.ts`): Focus and currency checks move in front of independent Web Push and stream sinks; Web Push sends exactly what it sends today. Tests: stream delivery with no push subject; Focus holds both sinks; preferences per sink.
- [ ] 2.2 `GET /api/notifications/stream`: preferences, event IDs, 45 s heartbeat with `server.timeout(req, 120)`, 64-stream and 32-frame bounds, in-memory replay ring (32 events / 10 min, current and Focus-allowed only), `logout` frame and close on logout. Route tests for no cookie, cross-origin browser request, logout, currency, bounds, slow reader, replay. Shared frame fixture in `apps/native/fixtures/`.
- [ ] 2.3 `taskNotifications.ts`: handle `hashchange` targets; `#herdr-world-find=` opens Find or act; Settings line for the app user agent. Unit and DOM tests.
- [ ] 2.4 Storage catalog: add the `app` store kind and the rows in design section 11 (`worlds.json`, pending store deletions, per-World web view stores, Android notification channels, launch-at-login entry) plus the `memory` row for the replay ring.

## 3. The app

- [ ] 3.1 Bundled World list page: add (paste, QR on Android), validate links, sign in again on an existing origin, choose, rename, sign out, forget (with "Finishing clean-up" state), per-World notifications and battery exemption explanation; no World fetch. Tests for link validation, re-sign-in and storage holding no token or cookie.
- [ ] 3.2 Window: external World origin, navigation, redirect and new-window policy, single-use pairing view, no saved view state, user agent suffix, form-data saving off, swap web view per World, capability limited to `list`, `AppManifest` commands.
- [ ] 3.3 Desktop notifications client (Rust): cookie, stream with `Last-Event-ID`, redirects off, backoff, 401 → sign-in notification, `logout` frame, sign-in detection on page load, `on_action` deep link, cancel and refuse taps for forgotten Worlds. Fixture tests.
- [ ] 3.4 Desktop tray, close-to-tray, autostart (off by default, `--hidden`), single instance, `--pair -` from standard input, pending store deletion at start.
- [ ] 3.5 Android Kotlin plugin: per-World profiles, WebView feature gate, in-process pairing handoff, `specialUse` service with boot receiver, `START_STICKY` and `NetworkCallback`, cookie, stream, native logout and cookie deletion, Forget sequence and pending profile deletion at start, notification channels and tap intents with IDs namespaced by World, share target, Back to the World list. JVM tests on the fixture.

## 4. Builds, smoke tests and docs

- [ ] 4.1 `.github/workflows/native-apps.yml`: Android, macOS arm64 and x64, Windows, Linux packages; throwaway test keys made and deleted in the run; Tauri version floor check; SHA-256 recorded before smoke.
- [ ] 4.2 `scripts/native-smoke/`: real World on loopback with cleared `HERDR_*`, no push subject, isolated herdr-core runtime with one scratch terminal, recording proxy, `adb reverse` for Android, hostile fixture origin; per package: pairing and no token on disk, Town visible through the accessibility tree, `herdr-world ask` notification and click (Android, Linux, Windows), hostile page, Forget.
- [ ] 4.3 Release candidate hook once #1374 is merged: `native-apps` contract job in `release-candidate.yml` and `CONTRACT_JOBS`, packages into `candidate/github/` and the checksum list, signing secrets forwarded by name through `release.yml` and `release-candidate.yml`, rerun reuses sealed packages, no APK without the owner's key secret.
- [ ] 4.4 On one current physical Android phone: LAN and VPN reachability; 8-hour screen-off battery runs (baseline, Wi-Fi without and with battery exemption, VPN) with `dumpsys batterystats`; Doze delivery delays; results in the guide.
- [ ] 4.5 `docs/native-apps.md` install guide (platform minimums, unsigned warnings, pairing, sign in again, sign out, forget, where data lives, Linux WebKitGTK and AppImage engine notes, Doze and battery exemption, force stop), `native-apps` notes, notifications notes Code list, changelog fragment and help entry.
- [ ] 4.6 Ask in Needs you for the Android release key when the first signed release is due.
