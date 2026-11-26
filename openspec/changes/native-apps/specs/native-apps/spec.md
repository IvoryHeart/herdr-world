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
app only for that World's exact origin; a `GET` to another `http` or `https` origin,
including another paired World's, SHALL open in the system browser without changing
the selected World, a navigation with another method (such as a form `POST`) to
another origin SHALL be refused without sending it, and every other scheme SHALL be
refused. Enforcement SHALL cover navigations the platform's URL-loading hook does not
report, and SHALL fail closed. The app SHALL NOT create a
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

#### Scenario: A form posts to another origin

- **WHEN** a World page submits a form with method `POST` to another origin, on any
  platform including Android
- **THEN** the request is not sent, nothing from that origin loads in the World view,
  and the app keeps showing the same World

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
the last event it received, also after the app's process restarts; the app SHALL keep
only that event's identifier, never its content.

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
continue; Quit SHALL end the app and its connections and SHALL NOT stop a World
service or any agent. Launch at login SHALL be off
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
notification and refuses a hostile page. For every package that carries World, the
fresh install SHALL also start World on a clean account, pass the agent walk (or, where
the release walk does not run, an agent's question notifying and opening that agent)
and connect to an existing World instead of starting a second one. Desktop packages
SHALL carry World's executable taken unchanged from the release's own tested
archives. The release candidate SHALL make that
workflow a contract job recorded in its seal, SHALL publish only the packages it
sealed, and SHALL reuse them unchanged on a rerun. Test builds SHALL use keys made in
the run and discarded. Release signing SHALL use only owner-provided repository
secrets passed by name to each workflow that needs them; nothing SHALL create, commit
or upload a release key, including the app updater's key. When the Android release
key is absent, the release SHALL attach no APK rather than a test-signed one; when
the updater key is absent, release builds SHALL have no updater.

#### Scenario: A smoke test fails

- **WHEN** a package's fresh-install smoke test fails in the release candidate
- **THEN** the release is not sealed and no package from that run is published

#### Scenario: No release key yet

- **WHEN** the release candidate runs without the owner's Android key secret
- **THEN** it attaches the desktop packages and no APK, and says so in the release
  notes

### Requirement: Desktop packages carry World

Every direct-download desktop package (macOS `.dmg`, Windows installer, Linux `.deb`
and `.AppImage`) SHALL carry World's service as the release's own `herdr-world`
executable for that platform, byte for byte, and SHALL be able to start World on that
computer through World's existing `service install`, so World runs as the user's
background service. Android and store builds SHALL NOT carry or start World. The app
SHALL start, stop and remove World only through World's own `service` commands, and
quitting, updating or stopping World from the app SHALL NOT stop Herdr, herdr-core or
any agent; stopping World SHALL ask first. The app SHALL NOT ship, install over or
update a Herdr runtime; a computer without one SHALL be offered World's existing
confirmed herdr-core installation.

#### Scenario: Download, open, World runs

- **WHEN** the user installs the desktop app on a computer with no World and chooses
  "Start World on this computer"
- **THEN** World starts as the user's background service, the app shows Town signed
  in, and World keeps running after the app quits and after the user signs in again

#### Scenario: Quit while agents run

- **WHEN** agents are running and the user quits the app
- **THEN** the app closes without asking, and World and every agent keep running

### Requirement: One World per computer

At every start, the desktop app SHALL detect a World already on the computer (a
listening World for the default data folder, a World service definition, or another
installation from the installer, Homebrew or npm) and SHALL connect to it as a client
instead of starting its own. The app SHALL NOT run a second World service, SHALL NOT
run World over a data folder another World holds, and SHALL NOT edit or remove another
installation. Switching which installation runs World SHALL be an explicit choice
that keeps the one data folder, and the app SHALL refuse to run its World over data
from a newer World version.

#### Scenario: Homebrew World already running

- **WHEN** the user installs the desktop app on a computer where a Homebrew World
  service runs
- **THEN** the app opens that World signed in, starts no service and leaves the
  Homebrew installation and its data folder unchanged

### Requirement: World on this computer starts loopback-only

When the app starts World on its computer for the first time, World SHALL listen on
loopback only, and the app SHALL sign in with World's own login link read from World's
CLI without showing, storing or logging the token. Letting other devices reach that
World SHALL be an explicit choice in the app that says what it allows, and SHALL be
reversible. World's login, origin and listener policy SHALL be unchanged.

#### Scenario: First run is not on the network

- **WHEN** World was started by the app's first run
- **THEN** a connection to the computer's network address is refused until the user
  chooses to let other devices reach World

### Requirement: App and World update together

A desktop app that runs World SHALL update the app and its World as one package, and
SHALL install an update only after verifying its signature against a public key built
into the app; the update SHALL be one the release sealed. After the update, World's
service SHALL run the new executable, and the update SHALL NOT change a Herdr runtime.
`herdr-world update` and World's web update SHALL refuse to replace an app-managed
executable and point to the app. Packages whose format the updater cannot install
SHALL say a new version exists and link the release.

#### Scenario: Update with agents running

- **WHEN** the user installs an app update while an agent runs
- **THEN** World restarts on the new version and the agent's terminal is still there
