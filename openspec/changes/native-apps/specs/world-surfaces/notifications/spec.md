## ADDED Requirements

### Requirement: App notification stream

World SHALL offer a read-only `GET /api/notifications/stream` behind its login
cookie, carrying the payloads its notification fan-out sends to Web Push devices,
after the same currency check and preference mapping. It SHALL persist nothing,
bound open streams, send a heartbeat and close a session's streams at its logout.
It SHALL NOT change World's login, cookie, origin or listener policy.

#### Scenario: One decision for every device

- **WHEN** an agent asks the user while a browser has Web Push enrolled and an app
  holds a stream
- **THEN** both receive the same notification payload once, from the same fan-out

#### Scenario: No session

- **WHEN** a request to the stream has no valid login cookie
- **THEN** World refuses it as it refuses other protected requests

#### Scenario: Logout

- **WHEN** the session that opened a stream logs out
- **THEN** World closes that stream and the same session's Web Push enrolment is
  revoked as today

### Requirement: A notification target after load

An already-loaded World page SHALL open a `#herdr-world-task=` target set after load
exactly as it opens one present at startup, clear the hash, and keep refusing stale
targets.

#### Scenario: Tap while World is open

- **WHEN** the app sets a notification target hash on a World page that is already open
- **THEN** the page opens that agent, or says it is no longer available, without reloading
