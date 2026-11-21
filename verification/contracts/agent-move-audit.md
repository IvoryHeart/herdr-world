# Agent moves between runtimes (Q57)

## Scope and requirement

`world.agent.move` (`server/src/world/agent-move.ts`) hands one idle agent or
idle plain terminal from a Herdr TUI connection to a herdr-core connection of the same
machine, or back. The requirement is the `agent-runtime-move` OpenSpec change
(`Agent moves between runtimes`, `Agent relations`). Moves within one runtime
use that runtime's native move and are outside this contract.

Order: admit the source (idle, alone; for core, the exact kill set: the agent
with no descendants; with no conversation to resume, `confirm` until the
request says `fresh`) → record spawn claims → start the destination (resumed,
or fresh) and wait until ready → re-read the source → carry the desk
(`agent.rehome`) → re-read the source again and require the same idle agent or
shell, alone (else put the desk back and close the copy) → close the source
within the admitted set. A refused close puts the desk back and closes the
copy; a Board that refuses putting it back is named and the copy still goes. An unconfirmed end returns `uncertain`; an unconfirmed cleanup names
the copy that may still run.

## Why a direct matrix is enough

The controller awaits each port in turn, and a per-source lock in the service
keeps a second request out until the first ends, so its own steps never
overlap. What can change meanwhile is outside: the source agent (working,
split, gone, a new child) and the runtimes' replies (refused, lost). Those are
inputs to the serial steps, so enumerating them covers the controller:

- `agent-move.test.ts` runs 108 combinations of start (ready, failed, failed
  with a partial copy), recheck (same, working during start, working during
  pinning), source close (ended,
  uncertain, refused, failed but gone) and cleanup (ended, uncertain, throws).
  Each asserts one owner of the desk, the original still running after any
  refusal, and that every copy or original that may still run is named.
- The same file changes the source during startup (working, split, gone) and
  runs the real herdr-core close against the in-process core: a child started
  after admission refuses the kill with both alive, and a lost kill reply is
  `uncertain`. `herdr-core/operations.test.ts` keeps killCore's own plan and
  confirmation checks.

A model would explore the same serial states and adds no schedule.

## Limits

The lock is per service: independent Worlds or external clients acting on the
same agent are not excluded. A service crash between start and close can leave
both copies; World does not recover it automatically. Real harness startup,
login and readiness are checked by the owner check on a real Herdr TUI and
herdr-core, not here.
