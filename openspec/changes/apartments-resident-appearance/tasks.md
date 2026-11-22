## 1. Resident appearance

- [x] 1.1 Add the optional `appearance` (profile, look, colour) to the resident record, read leniently; old records read as `null`.
- [x] 1.2 Read it while the agent lives, from its chosen avatar, profile and the colour live views show, including a spawned table's inherited colour; keep the last good read when a read fails.
- [x] 1.3 Draw the kept or nearest avatar in the Apartments list and resident view with the live-agent sprite, harness icon and colour tile.
- [x] 1.4 Cover the fallback chain, inherited colour and old records with unit, DOM and browser tests; captures for the fallback cases.
- [x] 1.5 Document the behaviour in FEATURES.md (Apartments).

## 2. Synchronize

- [ ] 2.1 Synchronize these deltas into the current specs together with the Apartments capability once it is specified.

Capability path after the feature-map split: `world-surfaces/apartments`. Existing delivery and pending tasks are unchanged.
