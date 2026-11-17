## Issue #863: contract and model

- [x] Record owner rulings verbatim, architecture and M1–M11 with overrides.
- [x] Record P0–P6 acceptance and Q1–Q10 upstream questions in this one change.
- [x] Verify the composed delta model, replay and all ordering/recovery mutants.
- [x] Register bounded evidence and one knowledge-map row.

## Implementation and handover

Checked items record implemented paths and their maintained tests, not device
acceptance. [Delivery](delivery.md) separates traffic, authority/model and owner
checks. The closure record below supersedes the pre-merge acceptance blockers;
the handover remains historical evidence, including what was not tested.

- [x] P1: coexisting providers, qualified connections and ordered core mirror.
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
- [x] P2: observer streams, shared seen/favourite and event push.
  - [x] Issue #867: observe streams. One observe attach per visible browser
    view with its own credit, `resize_notifications` required and confirmed,
    core's grid applied before every paint (xterm adopts it; fitting only
    scales), no RESIZE, FOCUS or input from World, per-frame lease/core/program
    fences, the observer-alone headless exception reported, a recorded 0.1.20
    watch replay, live release checks and the observe model family with three
    production negative controls.
  - [x] Issue #907: core 0.1.21. Q4 answered upstream (#199): live tests
    expect an observer alone to keep the size on 0.1.21 and later and still
    report an older core's move; the fake core models both rules. The logout
    warning (`keeps_running_after_logout: false`) shows in Manage connections
    with the `loginctl enable-linger` command, read at connect and on each
    liveness check, with a fixture switch.
  - [x] Issue #868: shared `herdr.seen` from foreground World peeks (once per
    turn per look, decided-label write, raise-only, best effort), favourite
    as `herdr.pinned`, Web Push from core status events, the shared-seen
    model with production replay, recorded 0.1.20 and live-release tests.
  - [x] Issue #921: core agents open on Chat when their conversation reads
    (Terminal only until then; a plain shell on Terminal), and one pin shared
    with the apps: a core desk or card is pinned exactly while its tab
    carries `herdr.pinned`, World's pin writes it (agents first, then
    terminals; unpin clears all), the favourite star is gone, pinned agents
    lead the phone switch list and Desk's quiet agents.
  - [x] Issue #923: pinned goes first: pinned desks take a room's first
    seats in tab order on one shared rug (a quiet pin on the desk's
    front-left corner), pinned cards sit first above their workspace on
    Board under one band, and pinned agents lead the agent pickers too;
    World saves no seat for a pin; #925 adds only its rank among pins.
  - [x] Issue #925: pinned desks reorder among the pinned seats on their
    rug (drag or M); elsewhere they glide back with an unpin hint, never
    unpinning. The order is World's own Town layout (a rank on the desk pin
    record, created for a core tab), else tab order.
- [x] P3: core-default launches, placement, core send/keys for every harness and pre-send fences.
  - [x] Issue #869: core-first launches from World (absolute executable, no
    caller/parent/notes, explicit keep; agents placed with a `where` caption,
    shells unplaced), World's rooms in SQLite (create, rename, close), kill,
    room-close and bin confirmations naming every dying descendant bound to
    its program print, core task summaries and spawn stamps, the model's kill
    fence with two plan mutants and two production controls, and live checks
    against the 0.1.20 release.
  - [x] Issue #870: native core send/keys for every harness; fresh terminal and
    original occupant/foreground fences; missing evidence and replacement refusal;
    uncertain deadlines without replay; core Chat and Needs you answers; verified
    local core asks through the existing durable dispatcher; recorded/live input
    traffic, browser captures and production recipient model control. Q3 remains.
  - [x] Issue #874: source inventory of all 30 TUI/app/World harnesses, core
    launch catalog and executable aliases, generic profile briefs through native
    delivery, shared TUI transcript readers with read-only links and publication
    fences, differential fixtures and latest-release harness-name smoke.
- [x] P4: files/Git/worktrees, asks and Ranger.
  - [x] Issue #871: a core connection's host runtime per generation (read
    model rows, screen-only reads, World's guarded file/Git helpers, an
    agent's worktree bound to the program occupying its address); Files,
    Changes and file transfers routed by core connection and generation;
    worktree create/open/remove as World's rooms with Paseo hooks, repository
    settings and the kill confirmation; verified core callers for asks with
    occupant-bound recipients and native saved-answer delivery; Ranger reads,
    mentions, native prompt delivery and worktree creation
    over core; the model's worktree-removal order with three mutants; live
    checks against the 0.1.20 release.
- [x] P5: interactive/mobile, popup equivalents and both SSH platforms.
  - [x] Typing and mobile (#872): the first genuine key opens World's interactive
    viewer and is sent once after the attach; leave on blur (3 s), idle (60 s)
    and close; replies never take the size; the phone composer and uploads to
    the core host (local, Unix and Windows SSH); composer drafts live while the
    core generation does. The typing model family drives the production typing session
    with five plan mutants and two production controls.
  - [x] One Inspector and a readable size (#915): a core agent or terminal opens
    in the shared Inspector (Chat, Terminal, Files, Changes) from every entry;
    the Terminal tab holds a resumed seat at its fitted grid while open (no blur
    or idle give-back), swaps seats on resize without a headless step, never
    sends RESIZE, draws an app pane's grid at 0.85 scale or more, and takes the
    first key with focus. The typing family now models the seat, with six plan
    mutants and three production controls; the separate core window is gone.
  - [x] Popup equivalents (#873): the room shell on both runtimes; Herdr Float
    is the one TUI plugin popup World invokes, and generic plugin popups have
    no core source. World's float shell is fenced like screen reads and tested
    against the fake core, a browser and the 0.1.20 release.
  - [x] Every supported harness (#874): Herdr integration names and app program
    aliases, wrapper/interpreter detection, status from core only; topology,
    differential, delivery and launch consumer tests.
  - [x] Windows SSH (#875): fixed existing-only named-pipe probe/relay,
    ownership/ACL refusal, EOF/reconnect/cleanup and native key transport;
    fake Windows host and opt-in real PowerShell tests. Real host is below.
  - [x] Native addresses (#893): source-derived alphabet/rollover vectors,
    production-provider and action consumers, without changing authority.
- [x] P6: latest-release smoke, usage docs and release handover (#876).
  - [x] Manual/daily workflow always resolves latest, verifies SHA-256, discovers
    all live suites (including native delivery), and retains failure evidence;
    offline smoke-runner tests check errors, cleanup and suite admission.
  - [x] README runtime section, FEATURES reference, learner core steps, smoke
    runbook, one feature changelog and this implemented change record.
- [x] Core-first install (#926, owner ruling 2026-11-16): installers install
  herdr-core only when no runtime exists; confirmed installs from Manage
  connections, a core connection that found nothing running and Town's Set up
  card; installer, service and browser tests use fakes only.

## Closure (2026-11-17)

The integration merged to main as `917c6c8aa` in PR #933, whose handoff records
the whole-branch review (#934), checks and owner device results. The owner then
authorized archiving in issue #943: "Lets go ahead and archive it."
This supersedes the original two pre-merge acceptance blockers; it does not claim
new device evidence or independent promotion of the bounded model mappings.

- [x] Reconcile delivery with the merged integration and owner acceptance:
  A–D passed with the documented Windows exception. Windows local core and
  Windows SSH remain untested on real hardware; no fixture or Linux test is
  presented as that evidence.
- [x] Synchronize the capability requirements and record Windows, unreleased
  upstream changes after 0.1.21, and Q1–Q11 as known limits in the current spec;
  archive the change while preserving `delivery.md` as historical evidence.
