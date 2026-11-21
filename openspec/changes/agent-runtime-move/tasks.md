## 1. Move between runtimes

- [x] 1.1 `world.agent.move`: admit an idle, single-terminal Claude or Codex agent; refuse busy, blocked, spawned-children and cross-machine moves.
- [x] 1.2 Resume on the destination and wait until ready; check the original again; carry the desk (`agent.rehome`); close the original within what was admitted.
- [x] 1.3 Report an unconfirmed close or cleanup as uncertain; undo the desk and drop the copy when the original refuses to close.
- [x] 1.4 Keep spawn links (`moved_from`) and inherited colour across connections.
- [x] 1.5 Town drag, M menu and Move to… on Town and Board peeks; FEATURES.md.

## 2. Synchronize

- [ ] 2.1 Synchronize these deltas into `world-surfaces` once the owner check passes on a real Herdr TUI and herdr-core.
