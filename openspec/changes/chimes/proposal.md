## Delivery state

Chimes and live Group Interest are delivered. Only tasks 3.2 (message-ledger sender identity) and 3.3 (sub-agent class) remain, pending their upstream evidence sources.

Delivered requirements are synchronized into [the current contract](../../specs/world-surfaces/notifications/spec.md#requirement-chimes).
No unsynchronized requirement delta remains in this record; unfinished tasks
and acceptance above keep the change active.

## Why

The user hears the same OS sound for every agent and every reason, and the
notification text names neither who nor why. World can vary its sound only by
playing it itself while a World page is open. Chimes must distinguish the Town master, agent classes and profiles, with
a reason line that travels with each sound.

## What Changes

- A chime is a timbre (who: the Town master, the crew or a profile's own) played
  as a motif (why: needs you, for you, finished). One mapping from a change to
  its motif; Herdr custom notifications map by their sound (request is needs
  you, done is finished, none is for you).
- Eight timbres synthesised with Web Audio; no sound files.
- The user's chime settings (class timbres, motif switches) and the one Town
  master live in the profiles document, shared by every browser; the profile
  gets a Chime field and an offer of the Town master role. Only the user
  assigns the role.
- This device's sound (on or off, volume, tests) stays in the browser.
- The gate: motif switches, already on screen, the viewer's interest (layers),
  and Focus, which only the Town master's needs-you breaks. Bursts within 3 s
  play one chime and escalate once; the toast reads "N changes".
- World marks OS notifications silent while it plays the sound, including push
  while a page has said it is chiming.
- Settings → Sounds.

## Capabilities

### Modified Capabilities

- `world-surfaces`: new requirement for chimes.

## Impact

Profiles document (`agent-profiles.json`) gains `chimes` and `town_master`;
older files load with the defaults. The task notification kind gains
`message`. The notification service worker version moves to 3.
