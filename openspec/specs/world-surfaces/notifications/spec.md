# World notifications

## Purpose

Define the user-facing notifications contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Return recaps use observed history

After at least thirty minutes away, World MAY show Since you left in Town and
Board.
The away window SHALL use the most recent known owner sighting across
this browser and the service's in-memory sightings from other devices; after
service restart or failure, browser-local history SHALL remain the fallback.

#### Scenario: Return recaps use observed history acceptance rules

- **WHEN** World observes attention or presents notifications and sound
- **THEN** Recap lines SHALL derive only from timestamped asks, blocked/finished work,
  review records and merged PR observations within that window.
  Opening items or
  dismissing a recap SHALL be browser-local and SHALL NOT answer asks or review work.

#### Scenario: Another browser was recently active

- **WHEN** this browser returns after thirty minutes but the service saw the owner recently elsewhere
- **THEN** it does not invent an away interval covering that recent activity

#### Scenario: A waiting item is answered or reviewed

- **WHEN** an item in the recap is resolved through its ordinary action
- **THEN** its waiting recap count disappears without rewriting source history

### Requirement: Notification projections and restoration preserve authority

The browser tab and supported app badge SHALL reflect the shared Needs you count,
including questions as separate items, and show none during focus.
Hidden-page title updates SHALL use that count. Toast dismissal SHALL NOT
answer or close its durable item.
Notification restoration SHALL reconcile the saved preference, actual browser
permission and push subscription; passive restoration SHALL wait for a visible,
active document, and lack of permission SHALL NOT be shown as successful delivery.

#### Scenario: Repeated dismissal or permission refusal

- **WHEN** a toast is dismissed repeatedly or a browser refuses notification permission
- **THEN** durable Needs you work remains intact and the UI retains the actual
  notification state rather than fabricating successful enablement

### Requirement: Qualified notification navigation across hosts

Opening an agent or task notification SHALL resolve the exact owning connection and current
resource/session identity before opening a context.

#### Scenario: Qualified notification navigation across hosts acceptance rules

- **WHEN** World observes attention or presents notifications and sound
- **THEN** An admitted target outside the host filter SHALL
  open with an outside-filter label and an explicit reveal action, without silently changing the
  filter or retiring unrelated contexts. Reveal SHALL intentionally expand the filter to include its
  host and expose the qualified target. Stale, removed or replaced targets SHALL explain why they
  cannot be opened without resolving to a colliding entity on another runtime or session.

#### Scenario: Open an out-of-filter notification
- **WHEN** a notification names a currently admitted agent outside the host filter
- **THEN** its context opens under its own host with a reveal action while the filter and other
  windows remain unchanged

#### Scenario: Follow a stale notification
- **WHEN** a notification's runtime generation or agent session has been replaced
- **THEN** World reports the original target as unavailable and does not open its replacement

### Requirement: Agent interest

Each agent SHALL have Default (from groups), explicit Watch, Muted or Focused,
chosen from a button beside the agent's name in its Inspector header in
every view.

#### Scenario: Agent interest acceptance rules

- **WHEN** World observes attention or presents notifications and sound
- **THEN** Interest SHALL belong to the agent's terminal on its host, without
  the runtime generation, so it follows the terminal through moves and an agent
  restarted in that terminal keeps it, and each agent in a multi-pane tab has its
  own. The World service SHALL save it with Board's layout, the same on every
  device, and SHALL NOT write it to Herdr. When a complete pane listing from a
  host's current runtime no longer shows a terminal, World SHALL drop that
  terminal's interest; it SHALL NOT drop interest on a failed, stale or partial
  listing. Interest SHALL only gate chimes: a muted agent SHALL NOT chime, and
  while a focused agent's terminal is shown on a ready host only focused agents
  and the Town master's needs-you SHALL chime; a focus World cannot reach SHALL
  NOT silence other agents, and SHALL apply again when its host is back. A
  watched agent's control SHALL say when it is quiet because another agent is
  focused. Interest SHALL NOT keep any item out of reception or change needs-you
  counts. An explicit agent choice SHALL override group claims; otherwise Group
  Focus SHALL beat Mute, with Default contributing no claim. Effective Focus SHALL
  be a union and count only currently reachable effective-focused members. Away
  and ambiguous addresses SHALL contribute no group intent. Hover guidance SHALL
  explain the source and overridden claims. Explicit Watch SHALL be stored distinctly
  from Default deletion; no meaning SHALL be inferred for old absent records.

  Stored Teams/Pods SHALL have Focus/Mute/Default viewer controls, saved separately
  as Board layout.group_interest by immutable Group ID, without copying member
  terminal preferences or writing membership attrs. Deletion or Team dissolution
  SHALL remove the overlay atomically; unresolved members SHALL retain it. Empty
  or offline Focus SHALL NOT silence everyone and the chip SHALL disclose no members
  online. Projected Room/Desk controls and persisted overlays SHALL be refused in v1.
  The Town-master needs-you exception SHALL bypass focus filtering only, never an
  explicit mute, device-off, motif-off or seen policy.

#### Scenario: Mute an agent

- **WHEN** the user opens the interest button beside an agent's name and chooses Muted
- **THEN** the button shows Muted on every device, the choices close, and the agent's needs still enter reception without a chime

#### Scenario: A closed agent's interest goes

- **WHEN** the host's current runtime lists every pane and the muted agent's terminal is not among them
- **THEN** World drops that terminal's interest, and keeps it when the listing fails or comes from a replaced runtime

### Requirement: Chimes

While a World page is open, World SHALL play its own chime for a change that
needs the user: a timbre for who it came from, played as a motif for why.

#### Scenario: Chimes acceptance rules

- **WHEN** World observes attention or presents notifications and sound
- **THEN** The
  timbre SHALL be the Town master's for the agent holding that role, else the
  agent's profile chime, else the crew's; a change with no known sender SHALL
  use the crew's. The motif SHALL be needs you (blocked, or a Herdr custom
  notification with the request sound), finished (finished, or a custom
  notification with the done sound) or for you (a custom notification with no
  sound), decided in one mapping.

  A chime SHALL NOT play when its motif is switched off, when the change's pane
  is already on screen, when this device's sounds are off or when the agent is
  muted; while any agent is focused, only focused agents and the Town master's
  needs-you SHALL chime. Changes within 3 seconds SHALL play one chime, with a
  higher-priority change (Town master, then needs you, for you, finished) played
  once more at the window's end. Every chime SHALL come with a toast whose reason
  line names the sender, or says the sender is unknown, and why; a burst's toast
  SHALL read "N changes" with each reason. World SHALL NOT guess a sender from
  notification text.
  Sender claims SHALL travel explicitly through the service relay; missing or
  invalid sender metadata SHALL remain unknown, including with a known pane or
  profile. Unknown senders SHALL retain the crew timbre and the mapped motif.
  Queued escalations SHALL recheck the current sound and interest policy before
  playing. Intentionally suppressed page notifications SHALL stay silent when
  Web Audio is unavailable.

  The user's class timbres and motif switches and each profile's chime SHALL
  be committed through each World service's instance SQLite single writer with
  its profiles, and shared by its browsers. Legacy profile JSON SHALL remain an
  import source only. The Town master
  role SHALL live with the terminal in Herdr metadata, shared by every World
  on that Herdr and ending with the terminal. The newest claim SHALL win,
  with revision ties broken by the greater terminal ID, as specified by
  [Per-terminal settings live with the terminal](../appearance/spec.md#requirement-per-terminal-settings-live-with-the-terminal). The Town master's timbre SHALL NOT be given to the crew or a profile. Exactly one
  agent MAY hold the Town master role; only the user SHALL assign it, and moving
  it from another live agent SHALL ask first. A terminal launched from a profile
  that offers the role SHALL be suggested, never assigned. Whether this device
  plays chimes, and how loud, SHALL be the device's own setting.

  When World plays the sound on a page, it SHALL mark that page's notifications
  silent, and push notifications SHALL be silent while a page has reported
  playing chimes or muting this device within the last minute. This SHALL work
  on first installation without reloading, and one page's OS fallback SHALL NOT
  override another page's current silence policy; otherwise the OS sound SHALL play.

#### Scenario: The Town master needs you during Focus

- **WHEN** another agent is focused and the Town master becomes blocked
- **THEN** World plays the needs-you motif in the Town master's timbre and shows its reason line

<a id="scenario-a-message-for-the-owner"></a>

#### Scenario: A message for the user

- **WHEN** an agent runs `herdr notification show "Review ready"` with no sound
- **THEN** World plays the for-you motif in the crew's timbre with the reason "For you · sender unknown: Review ready"

#### Scenario: A burst

- **WHEN** an agent finishes and, within 3 seconds, the Town master becomes blocked
- **THEN** World plays the finished chime at once and the Town master's needs-you once at the window's end, and the toast reads "2 changes" with both reasons

#### Scenario: Two Town masters

- **WHEN** the user makes a second agent Town master while the first is open
- **THEN** World asks before moving the role

### Requirement: Focus sessions hold interruptions

World SHALL let the user start a focus session of 25, 45 or 90 minutes or until
stopped, from the Town center ring, the Town status board, the Menu and the
command box. While a session runs, every device SHALL hold chimes, browser
notifications, Web Push and the tab-title and app-badge count; Town, marks and
Needs you SHALL keep showing every item. Focus SHALL NOT change what agents see
or answer any item.

#### Scenario: Start

- **WHEN** the user starts a 45-minute session
- **THEN** the service saves a session ending 45 minutes later, publishes the
  new revision, and every device holds its interruptions and shows the time left

### Requirement: Focus state is service-owned

The service SHALL own one focus state (`world.focus.get`, `world.focus.start`,
`world.focus.end`), persist it before acknowledging or publishing a change,
raise its revision on every change and publish `world_focus_changed`. A session
SHALL end at its own time without a client, recorded as expired at that time.

#### Scenario: Service restart

- **WHEN** the service restarts during a session
- **THEN** it reloads the saved session and keeps holding until its end, and a
  session whose end passed while the service was down is recorded as expired at
  that end

### Requirement: Focus sessions end with one recap

Ending early SHALL record the session as ended. When a timed session expires,
each open device SHALL play the for-you motif once. Either end SHALL show a
recap headed "While you focused" with the session's length, read by the Since
you left model over the session's window; each line SHALL open Needs you at its
first item.

#### Scenario: Expire

- **WHEN** a session reaches its end with no client connected
- **THEN** the service records it as expired at its end time and publishes it,
  and a device that sees the expiry chimes once and shows the recap

#### Scenario: End early

- **WHEN** the user chooses End now
- **THEN** the service records the session as ended now, interruptions resume
  without a chime, and the recap shows
