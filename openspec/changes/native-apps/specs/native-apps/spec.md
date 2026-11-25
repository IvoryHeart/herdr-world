## ADDED Requirements

### Requirement: The app wraps World at its own origin

The Herdr World app SHALL show a paired World by loading that World's own origin in
a web view, as a browser does. It SHALL NOT bundle, cache or serve a copy of World's
web app, SHALL NOT proxy or rewrite World's responses, and SHALL NOT require World
to configure Host allow-lists, Origin allow-lists or cross-origin CSP entries. The
app's only bundled page SHALL be its own World list, which SHALL NOT request any
World origin. Pages from a World origin SHALL get no native command access.
Navigation from a World page to another origin SHALL open in the system browser,
never inside the app's web view.

#### Scenario: Open a paired World

- **WHEN** the user opens a paired World in the app
- **THEN** the web view's page origin is that World's origin and every World request
  is same-origin, admitted by World's existing login and origin checks unchanged

#### Scenario: A link to another site

- **WHEN** the user follows a link in World to another origin
- **THEN** the system browser opens it and the app keeps showing World

#### Scenario: A World page tries a native command

- **WHEN** script on a World origin calls the app's native command interface
- **THEN** the call is refused; only the bundled World list may use native commands

### Requirement: Pairing keeps no credential

The app SHALL pair with a World from a QR code or a pasted login link of the form
`herdr-world url` prints, or a bare World origin. It SHALL accept only `http` or
`https` URLs with a host, whose only query parameter is `token`. It SHALL store the
World's origin and a display name, and SHALL NOT store the login token, a password
or a PIN. It SHALL hand the full link to the web view once, so World's existing
token login sets World's ordinary session cookie in the web view. The app SHALL let
the user keep several Worlds and choose which one to open, and SHALL refuse a second
entry for an origin already paired.

#### Scenario: Scan a QR code

- **WHEN** the user scans the QR code `herdr-world url --qr` prints
- **THEN** the app adds the World by origin, opens it signed in, and its stored list
  contains no token

#### Scenario: Paste an origin without a token

- **WHEN** the user pastes a World origin with no login token
- **THEN** the app adds it and World's own login page asks for the password or PIN;
  the app does not save what is typed

#### Scenario: Reject a foreign link

- **WHEN** the user pastes a URL with another scheme, a path other than `/`, or
  other query parameters
- **THEN** the app refuses it and stores nothing

### Requirement: Sign out and forget

The session SHALL live only in the app's web view storage for that World, and each
World SHALL have its own cookie and web storage, never shared with another World,
so two Worlds on one host at different ports keep separate sessions. Where the
platform cannot give a World its own store, the app SHALL refuse to pair a World
whose host already belongs to a paired World. Sign out SHALL call World's existing
logout from the app's native layer, without injecting script into World's page, and
delete the World's session cookie in its web view store, keeping the World in the
list. Forget this World SHALL sign out when World is
reachable, then delete the World's entry, its cookies, its web storage, its cache and
its notification settings from the app, and stop its connection, leaving every
other World's session in place. After Forget the app SHALL hold nothing that names
or authenticates that World.

#### Scenario: Two Worlds on one host

- **WHEN** the user pairs a World at `http://world.example:9001` and another at
  `http://world.example:9002`, then reloads the first and forgets the second
- **THEN** the first World stays signed in and its notifications keep arriving

#### Scenario: Same host without separate stores

- **WHEN** the device's web view cannot keep a separate store per World and the user
  pairs a second World on a host already paired
- **THEN** the app refuses it, names the World already on that host and stores nothing

#### Scenario: Forget the last World

- **WHEN** the user forgets their only paired World
- **THEN** the app shows the empty World list and its data folder holds no origin,
  cookie, storage or cache entry for that World

#### Scenario: Forget while World is unreachable

- **WHEN** the user forgets a World the device cannot reach
- **THEN** the app deletes everything it holds for that World and says that World's
  own sign-in record could not be revoked from here

### Requirement: App notifications follow World's decision

Each paired World with notifications on SHALL have one app connection to World's
notification stream, authenticated by the web view's session cookie for that World,
never by a stored token. The app SHALL show each streamed notification as an OS
notification with its title and body, replacing one with the same tag from the
same World. Tapping it
SHALL open that World at the notification's target through the
`#herdr-world-task=` link, bringing the app forward. The app SHALL NOT decide on its
own which agent states notify. When the stream is refused for lack of a session,
the app SHALL stop retrying that World and show one notification asking the user to
sign in again. A lost connection SHALL be retried with bounded backoff.

#### Scenario: An agent asks the user

- **WHEN** an agent on a paired World runs `herdr-world ask` while the app runs in the
  background
- **THEN** the device shows one notification for it, and tapping it opens that
  agent in World

#### Scenario: The session expires

- **WHEN** the stream is refused because the session cookie expired
- **THEN** the app shows one "Sign in again" notification for that World and does
  not reconnect until the user opens it

### Requirement: Android background connection

On Android the app SHALL hold paired Worlds' connections in a foreground service
while any World has background notifications on, showing the ongoing notification
Android requires, with a control to turn background notifications off. The service
SHALL stop when no World has them on. The app SHALL NOT use a push relay, Firebase
Cloud Messaging or UnifiedPush. While the device cannot reach a World, the app
SHALL back off instead of polling at a fixed short interval.

#### Scenario: Turn background notifications off

- **WHEN** the user turns background notifications off for every World
- **THEN** the foreground service and its ongoing notification stop, and
  notifications arrive only while the app is open

### Requirement: Desktop tray and launch at login

The desktop app SHALL show a tray or menu-bar item listing paired Worlds with Open,
Sign out and Quit. Closing the window SHALL hide it to the tray while notifications
continue; Quit SHALL end the app and its connections. Launch at login SHALL be off
until the user turns it on, and SHALL start the app hidden in the tray. A second
launch SHALL focus the running app.

#### Scenario: Launch at login

- **WHEN** the user turns on Launch at login and signs in to the computer again
- **THEN** the app starts hidden in the tray and its notifications work

### Requirement: Android share target

The Android app SHALL accept shared plain text and links and open the chosen World's
Find or act box with that text. It SHALL NOT accept shared files in this version.

#### Scenario: Share a link

- **WHEN** the user shares a web page link to Herdr World
- **THEN** the app opens the World and its Find or act box holds the link

### Requirement: Builds, smoke tests and signing

A workflow SHALL build the Android APK and the desktop packages on GitHub-hosted
runners and SHALL install each fresh and check that it starts and reaches a
synthetic test World over its login link. The release candidate SHALL attach only
packages whose smoke test passed in the same run. Test builds SHALL use keys made in
the run and discarded. Release signing SHALL use only owner-provided repository
secrets; nothing SHALL create, commit or upload a release key. When the Android
release key is absent, the release SHALL attach no APK rather than a test-signed one.

#### Scenario: A smoke test fails

- **WHEN** a package's fresh-install smoke test fails in the release candidate
- **THEN** the release is not sealed and no app package from that run is published

#### Scenario: No release key yet

- **WHEN** the release candidate runs without the owner's Android key secret
- **THEN** it attaches the unsigned desktop packages and no APK, and says so in the
  release notes
