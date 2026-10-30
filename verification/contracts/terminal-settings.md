# Contract: Per-terminal profile settings and Town master convergence

## Intended behavior

[Current requirements](../../openspec/specs/world-surfaces/spec.md#requirement-per-terminal-settings-live-with-the-terminal)
place assignments and master claims on Herdr's terminal. Profiles and chimes
stay per World. Owners are `server/src/agent/terminal-settings.ts` and
`server/src/agent/terminal-tokens.ts`, under inventory area Q25. Q10/Q11 retain
their existing observation evidence and add complete-list admission checks.

Allowed: two Worlds read one assignment; an unknown local profile keeps the
recorded name and default look; moves retain settings; offline claims remain
unresolved; a newer assignment supersedes a returning older claim. Forbidden:
using another terminal's tokens, importing an assignment twice, dispatching
on a retired or different lease, reporting a refused metadata write as saved,
or letting a stale cleanup remove a newer revision on that terminal.

## Implementation mapping and evidence choice

`TerminalSettings.observe` receives a complete clean pane list only while its
captured host generation is current. The snapshot's presentation cap is not
an absence witness. `snapshot-terminal-settings.test.ts` checks complete raw
lists beyond that cap, dirty reads, retirement and malformed lists. Settings
reconciliation is queued separately and does not block snapshot delivery.

Writes validate every non-null value, read `pane.get` to confirm the terminal,
dispatch `pane.report_metadata` through the exact lease and revalidate it.
Cleanup re-lists moved terminals and compares the observed revision again
before clearing. The shared Town move executor checks the moved terminal and
restores dropped keys; a concurrent existing key wins over restoration.

The existing `runtime-leases` model supplies retirement authority only.
P5 observes Herdr's external behavior directly; P7 enumerates the small
convergence domain directly. A new abstract model would omit the platform's
actual token normalization, key limit and move/restart behavior.

## Properties and witnesses

- `terminal-tokens.test.ts`: current-terminal witness, rejection of empty,
  padded, control-bearing and overlong values before dispatch, character-safe
  name cleaning, metadata refusal, retirement before/after dispatch, revision
  ordering and tie-breaking, and move preservation with/without dropped keys.
- `terminal-settings.test.ts`: shared assignment, missing local profile,
  per-connection import, offline deferred import, immutable migration backup,
  retained rollback fields, no re-import after a newer token assignment,
  terminal replacement, refused writes, explicit role replacement, and a
  returning old holder after World restart with a backwards clock.
- P7 enumerates 288 combinations: two Worlds on two hosts; neither/alpha/beta
  offline; neither/either/both Worlds restarted; three relative revision
  orders (including a tie); both assignment orders and both host observation
  orders in each World. It checks equal winners and cleared losing claims
  after reconciliation. This is exhaustive over those axes, not arbitrary
  histories or arbitrary concurrent RPC instruction schedules.
- `terminal-settings.live.test.ts`: two in-process settings services against
  one disposable named Herdr, including move, a lost/restored logical host
  lease, convergence, actual 32-key refusal, normalization and Herdr restart.
- Launcher RPC evidence checks the refused settings error reaches the user.
  Browser helpers check the recorded name without claiming a local profile.

## Environment and limitations

Herdr's flat token patch is not a compare-and-swap transaction. The final
read/write race with another Herdr client remains a platform limitation;
revision checks prevent stale observed cleanup, not every instruction race.
Independent Worlds can have skewed clocks; revision order assumes the skew
does not exceed the gap between assignments. No cross-host atomicity is claimed.
Offline host simulation in the live test retires one logical lease while
another connection to the disposable runtime remains available; it is not an
SSH partition test. Clearing all known claims requires reachable leases.

## Reproducible checks and review boundary

Run `bun run test server/src/agent/terminal-settings.test.ts`, token/launcher/
snapshot/browser-helper tests, and the complete `bun run verification:gate`.
Opt into the platform check with
`HERDR_LIVE_TERMINAL_SETTINGS=1 bun run test server/src/agent/terminal-settings.live.test.ts`.
It starts only its own `herdr --session` and cleans it up. Ordinary test runs
skip that platform check; a skipped test is not platform evidence. Independent
PR review and required Delivery checks remain the acceptance boundary.
