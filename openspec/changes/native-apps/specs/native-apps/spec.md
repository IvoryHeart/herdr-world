## ADDED Requirements

### Requirement: The app wraps World at its own origin

The Herdr World app SHALL show a paired World by loading that World's own origin in
a web view, as a browser does. It SHALL NOT bundle, cache or serve a copy of World's
web app, SHALL NOT proxy or rewrite World's responses, SHALL add no script of its own
to World pages, and SHALL NOT require World to configure Host allow-lists, Origin
allow-lists or cross-origin CSP entries. The app's only bundled page SHALL be its own
World list, which SHALL NOT request any World origin and is the only page granted
native commands; every custom command SHALL be covered by the permission model.
Top-level navigation, redirects and new windows from a World page SHALL stay in the
app only for that World's exact origin; another `http` or `https` origin, including
another paired World's, SHALL open in the system browser without changing the
selected World, and every other scheme SHALL be refused. The app SHALL NOT create a
web view for a page-opened window. Native requests to a World SHALL carry only that
origin's cookie and SHALL NOT follow redirects.

#### Scenario: Open a paired World

- **WHEN** the user opens a paired World in the app
- **THEN** the web view's page origin is that World's origin and every World request
  is same-origin, admitted by World's existing login and origin checks unchanged

#### Scenario: A link to another site

- **WHEN** the user follows a link or a `window.open` in World to another origin
- **THEN** the system browser opens it and the app keeps showing the same World

#### Scenario: A hostile World page

- **WHEN** script on a World origin calls the app's native command interface, opens a
  `file:`, `intent:` or custom-scheme URL, or redirects a native request elsewhere
- **THEN** the command is refused, the URL is not opened, the request fails and no
  cookie leaves the World's origin

### Requirement: Pairing keeps no credential

The app SHALL pair with a World from a QR code or a pasted login link of the form
`herdr-world url` prints, or a bare World origin. It SHALL accept only `http` or
`https` URLs with a host, path `/` and no query parameter other than `token`. It
SHALL store the World's origin and a display name, and SHALL NOT store the login
token, a password, a PIN or a cookie value. It SHALL hand the link only to a
single-use pairing view on that World's store, and after World's login lands SHALL
show the World in a fresh view, so the token is in no navigation history, saved view
state or file the app keeps. The app SHALL let the user keep several Worlds and choose
which one to open. A link for an origin already listed SHALL sign that entry in again
instead of adding a second one.

#### Scenario: Scan a QR code

- **WHEN** the user scans the QR code `herdr-world url --qr` prints
- **THEN** the app adds the World by origin and opens it signed in, and neither its
  list, its web view history nor any file it keeps contains the token, also after the
  app restarts

#### Scenario: Paste an origin without a token

- **WHEN** the user pastes a World origin with no login token
- **THEN** the app adds it and World's own login page asks for the password or PIN;
  the app does not save what is typed

#### Scenario: Reject a foreign link

- **WHEN** the user pastes a URL with another scheme, a path other than `/`, or other
  query parameters
- **THEN** the app refuses it and stores nothing

#### Scenario: Sign in again with a new link

- **WHEN** the session for a listed World has expired and the user scans or pastes a
  new login link for that origin
- **THEN** the same entry is signed in again, no second entry appears, and its
  notifications resume

### Requirement: Sign out and forget

Each World's session SHALL live only in that World's own web view store, never
shared with another World, so two Worlds on one host at different ports keep
separate sessions; where the device's web view cannot give a World its own store and
delete it, the app SHALL open no World and SHALL ask the user to update the web view.
Sign out SHALL stop that World's connection and retries, discard any cookie the
native layer captured, call World's existing logout from the native layer without
script in World's page, and delete the session cookie from the World's store even
when World is unreachable, keeping the World listed. A sign-out or sign-in done inside
World's page SHALL be followed by the app's connection. Forget this World SHALL
remove the World from the list at once, cancel its notifications, refuse taps on
them, sign out when World is reachable, and delete its entry, store and notification
settings, finishing any deletion the platform defers before it opens a World at the
next start. Afterwards the app SHALL hold nothing that names or authenticates that
World, and every other World's session SHALL remain.

#### Scenario: Two Worlds on one host

- **WHEN** the user pairs a World at `http://world.example:9001` and another at
  `http://world.example:9002`, then reloads the first and forgets the second
- **THEN** the first World stays signed in and its notifications keep arriving

#### Scenario: A web view without separate stores

- **WHEN** the device's web view cannot keep and delete a separate store per World
- **THEN** the app opens no World and asks the user to update the web view

#### Scenario: Sign out while World is unreachable

- **WHEN** the user signs out of a World the device cannot reach
- **THEN** the app stops its connection and deletes the session cookie from its store,
  and the World stays listed

#### Scenario: Forget the last World

- **WHEN** the user forgets their only paired World and the clean-up has completed
- **THEN** the app shows the empty World list and its data holds no origin, cookie,
  storage or cache entry for that World

#### Scenario: Tap a notification of a forgotten World

- **WHEN** the user taps a notification that a forgotten World posted
- **THEN** the app opens its World list and loads nothing from that World

#### Scenario: Forget while World is unreachable

- **WHEN** the user forgets a World the device cannot reach
- **THEN** the app deletes everything it holds for that World and says that a copy of
  the session elsewhere stays valid until it expires or World's credentials rotate

### Requirement: App notifications follow World's decision

Each signed-in World with notifications on SHALL have one app connection to World's
notification stream, authenticated by the session cookie in that World's store, never
by a stored token. The app SHALL show each streamed notification as an OS
notification with its title and body, replacing one with the same tag from the same
World. Tapping it SHALL open that World at the notification's target through the
`#herdr-world-task=` link, bringing the app forward. The app SHALL NOT decide on its
own which agent states notify. When the stream is refused for lack of a session, the
app SHALL stop retrying that World and show one notification asking the user to sign
in again; when World ends the stream for a logout, it SHALL stop without that
notification. A lost connection SHALL be retried with bounded backoff, resuming from
the last event it received.

#### Scenario: An agent asks the user

- **WHEN** an agent on a paired World runs `herdr-world ask` while the app runs in the
  background
- **THEN** the device shows one notification for it, and tapping it opens that agent
  in World

#### Scenario: The session expires

- **WHEN** the stream is refused because the session cookie expired
- **THEN** the app shows one "Sign in again" notification for that World and does not
  reconnect until the user signs in

### Requirement: Android background connection

On Android the app SHALL hold signed-in Worlds' connections in a foreground service
of type `specialUse`, with a declared reason, while any World has background
notifications on, showing each World's connection state and a control to turn
background notifications off. The service SHALL stop when no World has them on,
SHALL restart after the system ends its process and after a reboot, SHALL pause
attempts while no network can reach a World, and SHALL NOT require a battery
optimisation exemption. The app SHALL NOT use a push relay, Firebase Cloud Messaging
or UnifiedPush. While the device cannot reach a World, the app SHALL back off instead
of polling at a fixed short interval. Its battery cost SHALL be measured against a
baseline and published in the install guide.

#### Scenario: Turn background notifications off

- **WHEN** the user turns background notifications off for every World
- **THEN** the foreground service and its ongoing notification stop, and notifications
  arrive only while the app is open

#### Scenario: The phone restarts

- **WHEN** the phone restarts with background notifications on for a World
- **THEN** the service starts again without the app being opened and notifications
  from that World arrive

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
runners, and SHALL install every shipped package file fresh and check, on those exact
bytes, that it pairs with a synthetic test World, shows Town, shows a World
notification and refuses a hostile page. The release candidate SHALL make that
workflow a contract job recorded in its seal, SHALL publish only the packages it
sealed, and SHALL reuse them unchanged on a rerun. Test builds SHALL use keys made in
the run and discarded. Release signing SHALL use only owner-provided repository
secrets passed by name to each workflow that needs them; nothing SHALL create, commit
or upload a release key. When the Android release key is absent, the release SHALL
attach no APK rather than a test-signed one.

#### Scenario: A smoke test fails

- **WHEN** a package's fresh-install smoke test fails in the release candidate
- **THEN** the release is not sealed and no package from that run is published

#### Scenario: No release key yet

- **WHEN** the release candidate runs without the owner's Android key secret
- **THEN** it attaches the desktop packages and no APK, and says so in the release
  notes
