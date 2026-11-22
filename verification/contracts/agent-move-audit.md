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

## Model and replay

The controller awaits each port in turn, and a per-source lock in the service
keeps a second request out until the first ends, so its own steps never
overlap. What changes meanwhile is outside: the source agent (working, split,
gone, a new child), either connection (dropped, or reconnected at a new
generation) and the runtimes' replies (refused, lost, unconfirmed).
`quint/agent-move.qnt` interleaves those with every step, in both directions.
Its invariant, checked by TLC over every bounded run:

- once settled, exactly one of the original and the copy runs, unless the
  report names the one that may also run (or the person ended the source);
- a refused move leaves the original running with its desk and a reason, and
  names a copy that may still run or a desk that could not be put back;
- `moved` means the original ended and the desk is on the copy; `uncertain`
  keeps the copy and the desk and names the original;
- a busy, split or child-starting source is refused before anything starts;
- no effect lands on a dropped or reconnected side, and the original is never
  closed while busy.

A pinned desk is not refused: the town-moves requirement carries the pin with
the agent, so the model pins the copy before the desk moves, and a refused pin
fails the move with the original intact.

`quint/agent-move.ts` replays sampled traces through the real
`moveAgentAcross`, with both sides scripted by the trace and fenced like a
runtime lease. It compares the outcome, the calls made, who runs and owns the
desk, what the report names, and that each side was resolved once by its
admitted connection ID and generation. Four model faults (no second recheck,
a call reaching a reconnected side, assuming an unreadable source still runs,
an unnamed lost start) and two production mutants must be rejected.

The model found two faults in the first version, both fixed and kept as
replay witnesses in `quint/agent-move.test.ts`: a lost close reply followed by
an unreadable source put the desk back and closed the copy, though the
original may have ended (now `uncertain`, copy kept); a lost start reply did
not name the copy that may be running.

The 108-outcome matrix in `agent-move.test.ts` stays as consumer evidence. It
also runs the real herdr-core close against the in-process core: a child
started after admission refuses the kill with both alive, and a lost kill
reply is `uncertain`. `herdr-core/operations.test.ts` keeps killCore's own
plan and confirmation checks.

## Limits

The model assumes nothing but a core child (fenced by core's admitted kill
set) or a connection change happens between the last re-read and the close; a
source turning busy in that window is not excluded. The lock is per service:
independent Worlds or external clients acting on the
same agent are not excluded. A service crash between start and close can leave
both copies; World does not recover it automatically. Real harness startup,
login and readiness are checked by the owner check on a real Herdr TUI and
herdr-core, not here.
