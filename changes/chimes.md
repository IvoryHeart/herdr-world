### Added

- **Chimes.** World plays its own chime for a change that needs you: a sound
  for who (the Town master, the crew or the agent's profile) and a pattern for
  why (needs you, for you, finished), with a toast that says both. **Menu →
  Sounds** sets this device's chimes, the shared sounds and patterns, and the
  Town master, whose needs-you chime breaks Focus. Profiles get a **Chime**.
  Bursts share one chime; World's notifications go silent while it chimes.
  Queued sounds follow current settings, intentional silence stays silent
  during OS fallback, and device mute silences push while World is open.
  First-install notification control works without reloading; unknown senders
  keep the crew sound through the server relay.

### Changed

- A `herdr notification show` with no sound is now a message for you rather
  than a finished task; with `--sound done` it is still a finish.
