## 1. Model and service

- [x] 1.1 Timbres, motifs, the motif mapping, the gate, burst priority and the reason line in `shared/chimes.ts`; verify in unit tests.
- [x] 1.2 Chime settings, profile chimes and the single Town master in the profile store; verify the master's chime stays its own, the single holder and older files.
- [x] 1.3 Herdr custom notifications as their own kind by sound; verify the mapping, and verify live that `herdr notification show` arrives without a pane.

## 2. Browser

- [x] 2.1 Web Audio player, chime center (sender, gate, bursts, silent) and the store's toasts; verify bursts, escalation, focus and unknown senders with a fake clock and player.
- [x] 2.2 Settings → Sounds and the profile's Look & sound; push silent while a page chimes.

## 3. Follow-ups

- [ ] 3.1 Read interest from layers' `useAgentInterest` once it lands (the gate already takes it).
- [ ] 3.2 Name the sender of a "for you" once the message ledger lands (relay).
- [ ] 3.3 A sub-agent class once a lineage source exists.
