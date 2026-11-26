## ADDED Requirements

### Requirement: One notification decision for every sink

World SHALL decide once whether an event notifies, holding it while Focus is on and
dropping it when it is no longer current, then hand it to Web Push and to app streams
independently, each applying its subscriber's preferences. App streams SHALL work
whether or not Web Push is configured.

#### Scenario: No Web Push configured

- **WHEN** an agent asks the user on a World with no push subject and an app holds a
  stream
- **THEN** the app's stream receives the notification

#### Scenario: Focus holds notifications

- **WHEN** an agent asks the user while Focus is on
- **THEN** neither Web Push devices nor app streams receive it

### Requirement: App notification stream

World SHALL offer a read-only `GET /api/notifications/stream` behind its login
cookie, carrying the payloads it sends to Web Push devices. It SHALL persist nothing,
bound open streams and their queues, send a heartbeat within its idle timeout, replay
recent current events after a short reconnect from a bounded memory window, and end
a session's streams at its logout. It SHALL NOT change World's login, cookie, origin
or listener policy.

#### Scenario: One decision for every device

- **WHEN** an agent asks the user while a browser has Web Push enrolled and an app
  holds a stream
- **THEN** both receive the same notification payload once, from the same decision

#### Scenario: A short reconnect

- **WHEN** an app's stream drops and reconnects within the replay window with the last
  event ID it received
- **THEN** it receives the current events it missed, once each

#### Scenario: No session

- **WHEN** a request to the stream has no valid login cookie
- **THEN** World refuses it as it refuses other protected requests

#### Scenario: Logout

- **WHEN** the session that opened a stream logs out
- **THEN** World ends that stream with a logout event and the same session's Web Push
  enrolment is revoked as today

### Requirement: A notification target after load

An already-loaded World page SHALL open a `#herdr-world-task=` target set after load
exactly as it opens one present at startup, clear the hash, and keep refusing stale
targets.

#### Scenario: Tap while World is open

- **WHEN** the app sets a notification target hash on a World page that is already open
- **THEN** the page opens that agent, or says it is no longer available, without reloading
