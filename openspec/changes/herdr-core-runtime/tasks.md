## Issue #863: contract and model

- [x] Record owner rulings verbatim, architecture and M1–M11 with overrides.
- [x] Record P0–P6 acceptance and Q1–Q10 upstream questions in this one change.
- [x] Verify the composed delta model, replay and all ordering/recovery mutants.
- [x] Register bounded evidence and one knowledge-map row.

## Following implementation (outside issue #863)

- [ ] P1: inventory parity consumers, extract typed seam and implement core mirror.
  - [x] Issue #865: existing-only local and Unix SSH connections (core.lock on
    every attempt, private socket directory), framed client with credit and
    streaming UTF-8, ordered mirror with missed/heartbeat/gap rules, liveness,
    lease/core/occupant fences, profile runtime kind, connection status,
    recorded 0.1.20 replay and a production-mirror model replay.
  - [x] Issue #866: core agents in Town, Desk, Board and Needs you as a
    provider-neutral read model (both runtimes in one aggregate snapshot, each
    under its own connection), status from core's 7501 records with Herdr's
    shared seen rule and World's first sight, every Herdr/app harness, rooms
    from the desktop app's placement, view-only controls with a reason, and a
    production read-model replay with its own negative control.
- [ ] P2: observer streams, shared seen/favourite and event push.
  - [x] Issue #868: shared `herdr.seen` from foreground World peeks (once per
    turn per look, decided-label write, raise-only, best effort), favourite
    as `herdr.pinned`, Web Push from core status events, the shared-seen
    model with production replay, recorded 0.1.20 and live-release tests.
- [ ] P3: core-default launches, placement, core send/keys for every harness and pre-send fences.
  - [x] Issue #869: core-first launches from World (absolute executable, no
    caller/parent/notes, explicit keep; agents placed with a `where` caption,
    shells unplaced), World's rooms in SQLite (create, rename, close), kill,
    room-close and bin confirmations naming every dying descendant bound to
    its program print, core task summaries and spawn stamps, the model's kill
    fence with two plan mutants and two production controls, and live checks
    against the 0.1.20 release.
- [ ] P4: files/Git/worktrees, asks and Ranger.
- [ ] P5: interactive/mobile, popup equivalents and both SSH platforms.
- [ ] P6: latest-release smoke, usage docs and final device/parity acceptance.
- [ ] Obtain independent design/model review and separate implementation mapping
  acceptance; synchronize current specs and archive only after full delivery.
