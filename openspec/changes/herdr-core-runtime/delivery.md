## Phases and acceptance

Each implementation phase updates current usage documentation and its changelog,
passes required gates and preserves TUI regressions. Acceptance has three distinct
boundaries: core accepts the traffic; World preserves authority/state; official
apps and real devices show the intended result. Model replay establishes none of
the third boundary by itself. The original feature-parity baseline is `15baa482`.

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| P0 | This single OpenSpec change, owner decisions and composed delta model; feature matrix core-involvement classification | Model passes, all eleven planned mutants fail, and design/mapping receive independent review. Per-bullet parity inventory/classification is a later implementation planning task, outside issue #863's bounded file scope. |
| P1 | Typed seam preserving TUI; core provider, existing-only transport, bounded mirror; initial observation in Town/Desk/Needs you | Required Bun fake/recorded-traffic suite and provider replay; TUI suites green. App-started agent appears in World; crash makes it stale then recovers the same addresses; absent/stopped core never starts. This is an intermediate phase, not the final read-only scope. |
| P2 | Observe streams, shared seen/favourite and event-driven push | No World-to-core RESIZE, FOCUS or human DATA on observer streams. Core-to-World RESIZE precedes paint and xterm adopts that grid. Owner checks A/B below. |
| P3 | SQLite topology CRUD, core-default launch with placement, core send/keys for every supported harness, pre-send occupant/foreground checks, M6–M8 and descendant kill confirmation | Replacement, stale-report, draft-delay, session-selection, parent-death and read-side-effect cases below. Placed reporting World agent appears in desktop space/Agents; phone visibility recorded separately. World answer unblocks the original agent. |
| P4 | Guarded host files/Git/worktrees/hooks, asks and Ranger | Consumer fixtures for both providers, colliding IDs and retired leases; disposable repository worktree create/open/remove for a core agent. |
| P5 | Interactive streams, mobile, host uploads, World popup equivalents, Unix/Windows SSH and mixed hosts | Both-provider browser suites; first key once, win32-input-mode, owner Windows named-pipe relay checks. Owner C/D; TUI/core on one host without duplicate agents. |
| P6 | Newest-release smoke, final parity review and FEATURES/TUTORIAL/README updates | Full gates, independent review and separate owner device evidence. Full read-write on each release without pins or certification gating. Ready PR; merge only on owner instruction. |

### Required fixtures before the phase ships its path

- P1: lossless captures, full projections and honest latency endpoints; absent
  socket and stop mid-connect; changed lock path; oversized labels and heartbeat
  jump; frame/header/UTF-8 fragmentation; profile A/B on the same core. Port useful
  spike experiments into maintained Bun fixtures; neither spike model is evidence.
- P2: confirmed observer resize order on desktop/mobile grids, during credit
  stalls and reconnect; assert observer-alone headless resizing; replay captures
  through actual World/browser consumers; shared seen/unread/favourite races.
- P3: kept replacement and exit to shell connected/disconnected, reused pid,
  never-reported shell-wrapped agent; queued input after connection close and
  replacement documented as the core-owned Q3 race (source-gated model assumption
  and ungated control); pre-send occupant/foreground refusal for every supported
  harness; draft-held timeout shown as uncertain without automatic retry,
  cancellation and later completion; no World status writes or per-harness side
  channels; stale reports; app-started agents and inherited runtime markers; parent with a dying child and an outliving child in different rooms;
  `lines:0` side-effect guard. Source completion and World publication are separate.
- P5: first genuine key exactly once after attach; Windows pipe discovery, EOF,
  reconnect, process cleanup and win32-input-mode on a real host. Required CI uses
  fakes/recorded traffic; optional live tests skip cleanly without a supplied binary.

### Owner device acceptance for later implementation

Use a disposable test account and candidate World, never the owner's runtime.

- A, Observe: focus a desktop app pane and record its grid; open the agent in
  World on a phone, rotate and toggle the keyboard. The phone uses the desktop
  grid without changing it. With no interactive desktop viewer, expect headless.
- B, Seen: finish a turn while hidden and see Done in the app. View it in a
  foreground World tab and see Idle in the app within two seconds. Mark unread
  in the app and ensure World preserves it; check favourite both ways.
- C, Control: type in World and see the desktop pane adopt World's grid; click
  the desktop pane and see it reclaim its grid. Leave World and retain desktop
  control. Repeat on Windows SSH with native key encoding.
- D, Placement: launch an agent with default placement, see it in the app with
  keep enabled, then close the app pane and see it ended in World. Launch an
  unplaced shell; record desktop/phone behavior separately.

## Upstream questions (for the owner to post)

These improve the protocol; they do not reopen settled owner rulings or authorize
this worker to post upstream messages.

1. Q1, Compatibility: can releases list semantic changes and a deprecation policy
   (upstream #115)? New releases remain fully supported without certification.
2. Q2, Existing-only connect: can connect/server status accept no-autostart
   (upstream #203/#209)? The fixed Windows PowerShell relay proceeds independently.
3. Q3, Safe input: can a public program incarnation condition send/keys, checked
   when a queued send actually executes? Core owns closing this replacement
   window. World uses core send/keys for every harness with an immediate
   occupant/foreground check and uncertain timeouts; no harness side channel.
4. Q4, Observer resize: is observer-alone attachment resetting to headless intended?
5. Q5, Oversized recovery: can suppressed missed snapshots be explicit, labels
   capped or snapshots paginated?
6. Q6, Status coverage: how will core expose status for every supported harness,
   including non-reporting agents (upstream #826)? World reads core status only
   and never becomes an external reporter; missing status stays unknown (M11).
7. Q7, Labels: can seen use CAS or numeric-max rather than last-writer wins?
8. Q8, Placement: can space/tab names be labels (app #43), and does the phone
   Inbox include agents without herdr.space? Verify the promised app visibility.
9. Q9, Environment: should core strip other runtimes' HERDR_* markers?
10. Q10, TUI evolution: what is the TUI-on-core timeline or import path (app #63)?
11. Q11, Conditional kill: can `terminal.kill` refuse when the set of terminals
    its cascade ends differs from one the caller names? World confirms every
    descendant it has observed; a child core creates after World's last applied
    event can still die unconfirmed.

No unresolved owner decision blocks this design. O1–O3 select core coexistence,
default placement and shared seen; O4 is overridden by status read-only (M11);
O5 removes certification gates; O6 includes Windows relay; O7 requires popup
equivalents; O8 is overridden by core send/keys for every harness, immediate
occupant/foreground checks, uncertain timeouts and no per-harness side channel.
The queued-send replacement window is core's to close under Q3.
