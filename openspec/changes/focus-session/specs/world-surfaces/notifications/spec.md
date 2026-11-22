## ADDED Requirements

### Requirement: Focus sessions hold interruptions

World SHALL let the user start a focus session of 25, 45 or 90 minutes or until
stopped, from the Town center ring, the Town status board, the Menu and the
command box. The service SHALL own one focus state (`world.focus.get`,
`world.focus.start`, `world.focus.end`), persist it before acknowledging or
publishing a change, raise its revision on every change and publish
`world_focus_changed`. While a session runs, every device SHALL hold chimes,
browser notifications, Web Push and the tab-title and app-badge count; Town,
marks and Needs you SHALL keep showing every item. A session SHALL end at its
own time without a client, recorded as expired at that time. Ending early SHALL
record it as ended. When a timed session expires, each open device SHALL play
the for-you motif once and show a recap headed "While you focused" with the
session's length, read by the Since you left model over the session's window;
each line SHALL open Needs you at its first item. Focus SHALL NOT change what
agents see or answer any item.

#### Scenario: Start

- **WHEN** the user starts a 45-minute session
- **THEN** the service saves a session ending 45 minutes later, publishes the
  new revision, and every device holds its interruptions and shows the time left

#### Scenario: Expire

- **WHEN** a session reaches its end with no client connected
- **THEN** the service records it as expired at its end time and publishes it,
  and a device that sees the expiry chimes once and shows the recap

#### Scenario: End early

- **WHEN** the user chooses End now
- **THEN** the service records the session as ended now, interruptions resume
  without a chime, and the recap shows

#### Scenario: Service restart

- **WHEN** the service restarts during a session
- **THEN** it reloads the saved session and keeps holding until its end, and a
  session whose end passed while the service was down is recorded as expired at
  that end

## MODIFIED Requirements

### Requirement: Notification projections and restoration preserve authority

The browser tab and supported app badge SHALL reflect the shared Needs you count,
including questions as separate items, except during a focus session, when they
SHALL show no count. Hidden-page title updates SHALL use that same count. Toast dismissal SHALL NOT answer or close the underlying durable item.
Notification restoration SHALL reconcile the saved preference, actual browser
permission and push subscription; passive restoration SHALL wait for a visible,
active document, and lack of permission SHALL NOT be shown as successful delivery.

#### Scenario: Repeated dismissal or permission refusal

- **WHEN** a toast is dismissed repeatedly or a browser refuses notification permission
- **THEN** durable Needs you work remains intact and the UI retains the actual
  notification state rather than fabricating successful enablement
