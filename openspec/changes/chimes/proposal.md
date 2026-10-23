## Why

The owner hears the same OS sound for every agent and every reason, and the
notification text names neither who nor why. World can vary its sound only by
playing it itself while a World page is open. The owner asked for a chime of
FirstMate's own (the Town master), chimes per agent class and per profile, and
a reason line that always travels with the sound (pm spec, sync
`pm-chatter-chimes.md` §2, with the owner's answers).

## What Changes

- A chime is a timbre (who: the Town master, the crew or a profile's own) played
  as a motif (why: needs you, for you, finished). One mapping from a change to
  its motif; Herdr custom notifications map by their sound (request is needs
  you, done is finished, none is for you).
- Eight timbres synthesised with Web Audio; no sound files.
- The owner's chime settings (class timbres, motif switches) and the one Town
  master live in the profiles document, shared by every browser; the profile
  gets a Chime field and an offer of the Town master role. Only the owner
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
