## ADDED Requirements

### Requirement: Chimes

While a World page is open, World SHALL play its own chime for a change that
needs the owner: a timbre for who it came from, played as a motif for why. The
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

The owner's class timbres and motif switches, each profile's chime and the
Town master SHALL be kept by the service and shared by every browser. The
Town master's timbre SHALL NOT be given to the crew or a profile. Exactly one
agent MAY hold the Town master role; only the owner SHALL assign it, and moving
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

#### Scenario: A message for the owner

- **WHEN** an agent runs `herdr notification show "Review ready"` with no sound
- **THEN** World plays the for-you motif in the crew's timbre with the reason "For you · sender unknown: Review ready"

#### Scenario: A burst

- **WHEN** an agent finishes and, within 3 seconds, the Town master becomes blocked
- **THEN** World plays the finished chime at once and the Town master's needs-you once at the window's end, and the toast reads "2 changes" with both reasons

#### Scenario: Two Town masters

- **WHEN** the owner makes a second agent Town master while the first is open
- **THEN** World asks before moving the role
