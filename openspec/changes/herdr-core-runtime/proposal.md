## Why

World needs full support for herdr-core beside the existing Herdr TUI runtime:
observe, start, talk to, answer, review and control agents across Town, Board,
Desk, Spaces and Chat. The owner asked for support built "deeper, not bigger".
This change fixes the contract before product code depends on it.

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
World's runtime-selection rules. Installation alone selects the launch default;
it does not authorize automatic startup during observation/reconnect.

## What Changes

- Record one provider design and ownership decisions M1–M11 in [design](design.md).
- Define observable runtime requirements in the [delta specification](specs/herdr-core-runtime/spec.md).
- Carry the phases, acceptance and upstream questions in [delivery](delivery.md),
  with implementation progress in [tasks](tasks.md).
- Add one composed delta/authority/recovery Quint model, its replay adapter,
  mutation controls and verification registration. See [model contract](model.md).

## Capabilities

### New Capabilities

- `herdr-core-runtime`: full qualified runtime support, recovery, shared app state,
  native terminal streams and core-native delivery for every supported harness.

### Modified Capabilities

None in this PR. Future implementation must preserve runtime-federation,
world-protocol-identity, world-effects and world-surfaces contracts while adding
the second provider. This change remains active until that implementation and
its consumer acceptance are complete.

## Impact

This PR delivers planning and bounded design evidence only. It changes no product
code, setup, browser flow or runtime dependency. README, FEATURES and TUTORIAL
remain accurate for shipping behavior; each implementation phase updates those
guides when its behavior ships. There is no live-core or device-conformance claim.

The model composes the maintained runtime lease and opaque effect recovery
predicates. Coverage remains pending for a production core provider; passing
design replay cannot promote its future implementation mapping.
