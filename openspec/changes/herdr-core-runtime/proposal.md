## Why

World needs full support for herdr-core beside the existing Herdr TUI runtime:
observe, start, talk to, answer, review and control agents across Town, Board,
Desk, Spaces and Chat. The owner asked for support built "deeper, not bigger".
This change fixes the contract before product code depends on it.

## Owner rulings (2026-11-11; verbatim)

- "I need full support": read and write, not read-only.
- herdr-core is a second runtime beside herdr (the TUI). Both co-exist until the TUI moves onto core.
- "core will be our primary runtime (if installed)": World starts new agents in core when core is present, and World-started agents appear in Herdr's apps (placement on for agents; plain shells start in core unplaced). The TUI stays a per-launch choice.
- "world view would clear 'done'": seen and favourite are shared with Herdr's apps.
- "we should support latest version and assume it won't be breaking changes" and "we should not explicitly pin ... adopt as herdr-core and herdr-tui evolves": no version pins and no certification gate; every core release gets full read-write, and a smoke test against the newest release flags changes.
- "we can have world equivalents and give best of both": TUI-only popups get World equivalents.
- Windows SSH hosts are in scope through a PowerShell named-pipe relay; the owner verifies on a real Windows host.
- Defaults until the owner says otherwise: status is written to core only for harnesses whose integration World installed, never for an agent that reports its own status (plan O4/M11); Chat, answers and asks to Claude and Codex go through each harness's own session channel, never typed into a terminal that may have been replaced (plan O8 option a).

These rulings supersede the planning alternatives. There is no uncertified-version
read-only mode, version allowlist, Windows exclusion, popup gap or acceptance of
terminal-queued Chat reaching a replacement. Core is a Herdr runtime for World's
runtime-selection rules. Installation alone selects the launch default; it does
not authorize automatic startup of a stopped core during observation/reconnect.

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
  native terminal streams and harness session delivery.

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
