## Why

World needs full support for herdr-core beside the existing Herdr TUI runtime:
observe, start, talk to, answer, review and control agents across Town, Board,
Desk, Spaces and Chat. The owner asked for support built "deeper, not bigger".
This active change records the contract, implemented providers and remaining
owner acceptance before the feature merges to main.

## Owner rulings (2026-11-11; verbatim)

- **Full support.** "I need full support": read and write, not read-only.
- **Two runtimes.** herdr-core is a second runtime beside herdr (the TUI). Both co-exist until the TUI moves onto core.
- **Core first.** "core will be our primary runtime (if installed)":
  - When core is present, World starts new agents in core.
  - World-started agents appear in Herdr's apps: placement is on for agents, and plain shells start in core unplaced.
  - The TUI stays a per-launch choice.
- **Shared seen.** "world view would clear 'done'": seen and favourite are shared with Herdr's apps.
- **No duplication.** "we should not duplicate and rely on herdr-core to do the things it does":
  - World reads agent status from core and never writes it.
  - Messages, answers and asks go through core's own send and keys, for every harness. World checks the occupant and its foreground right before each send, shows a timeout as "uncertain", and builds no per-harness side channel.
  - The window in which a queued send can reach a replacement shell is core's to close (upstream question Q3).
- **Every harness.** World supports every harness that herdr-core and herdr support, not only Claude and Codex.
- **Latest core.** "we should support latest version and assume it won't be breaking changes" and "we should not explicitly pin ... adopt as herdr-core and herdr-tui evolves":
  - no version pins and no certification gate;
  - every core release gets full read-write;
  - a smoke test against the newest release flags changes.
- **Popups.** "we can have world equivalents and give best of both": TUI-only popups get World equivalents.
- **Windows.** Windows SSH hosts are in scope through a fixed PowerShell named-pipe relay. The owner verifies it on a real Windows host.

These rulings supersede the planning alternatives, including O4's status injector
and O8's per-harness delivery channels. World uses core send/keys for every
harness and checks the occupant and foreground immediately before sending. The
remaining queued-send replacement race belongs to core (Q3); this design does
not claim that World's pre-send check closes it. Core is a Herdr runtime for
World's runtime-selection rules. A connected, available core selects the launch
default;
it does not authorize automatic startup during observation/reconnect.

## What Changes

- Add an existing-only local/Unix SSH/Windows SSH core provider alongside TUI,
  with an ordered bounded mirror and per-connection runtime authority.
- Show both providers in World, with core status, app placement, shared seen and
  favourite, live observation, typing/mobile uploads and event-driven push.
- Route launches, native send/keys, kills, files/Git/worktrees, asks, Ranger,
  task summaries, spawn stamps and the room shell through their owning provider.
- Check ordering and authority through the composed model and production replay,
  recorded release traffic, fault injection, differential and browser tests.
- Add a manual/daily newest-release smoke and current usage guides, with one
  consolidated feature changelog. Record owner checks in [delivery](delivery.md)
  and implementation progress in [tasks](tasks.md).

## Capabilities

### New Capabilities

- `herdr-core-runtime`: full qualified runtime support, recovery, shared app state,
  native terminal streams and core-native delivery for every supported harness.

### Modified Capabilities

Existing runtime-federation, world-protocol-identity, world-effects and
world-surfaces behavior stays qualified by the original connection and runtime.
The core provider adds a second runtime; it does not widen raw RPC or LAN shell
access. This change remains active until independent mapping review, required
CI and owner device acceptance are complete.

## Impact

Product code and focused tests now implement P1–P5. README, FEATURES and TUTORIAL
explain how users connect core, select a runtime, observe/type and share seen.
The latest-release smoke is an optional external drift signal; required tests use
fakes and recorded traffic and skip live-core checks without an explicit binary.
No core version is pinned and no smoke outcome removes read-write support.

Coverage Q52/Q53 connects the composed and shared-seen models to production
consumers. Independent review and real official-app/device acceptance remain
separate: a live-core or model pass does not certify desktop/phone visibility,
Windows SSH ACLs or the residual core-owned Q3/Q7/Q11 races. Current specs are
synchronized and this change archived only after acceptance.
