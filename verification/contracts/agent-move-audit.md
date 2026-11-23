# Agent moves between runtimes (Q57)

## Scope and requirement

`world.agent.move` (`server/src/world/agent-move.ts`) hands one idle agent or
idle plain terminal from a Herdr TUI connection to a herdr-core connection of the same
machine, or back. The requirement is the `agent-runtime-move` OpenSpec change
(`Agent moves between runtimes`, `Agent relations`). When both connections
reach one runtime (same endpoint), the runtime moves the desk itself and
nothing closes; the model covers that route only as "refused, rolled back,
kept or moved".

Order: admit the source (idle, alone; for core, the exact kill set: the agent
with no descendants; with no conversation to resume, `confirm` until the
request says `fresh`) → record spawn claims → start the destination (resumed,
or fresh) and wait until ready → re-read the source → carry the desk
(`agent.rehome`) → re-read the source again and require the same idle agent or
shell, alone (else put the desk back and close the copy) → close the source
within the admitted set. A refused close puts the desk back and closes the
copy; a Board that refuses putting it back is named and the copy still goes. An unconfirmed end returns `uncertain`; an unconfirmed cleanup names
the copy that may still run.

Close-first (a harness that locks or forks its conversation): re-read the
source → close it within the admitted set → resume the conversation in the
destination. A failed start resumes the agent back where it was; if that fails
too, the report names the saved conversation (`codex resume <id>` in its
folder). A start-first copy that reports a different conversation than the
original forked: it is closed and the move continues close-first.

## Harness probe (2026-11-23)

Run in a scratch Herdr session and herdr-core room with a synthetic project:

- Claude Code 2.1.330: `claude --resume <id>` started beside the open original
  re-attaches the same conversation (same session ID, no fork), so Claude
  moves start-first.
- Codex CLI 0.171: `codex resume <id>` beside the open original stops at a
  screen saying the conversation is open elsewhere; after the original closes,
  the same command resumes it. Codex moves close-first.

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
fails the move with the original intact. A pin kept under another connection
of the same Herdr goes only after the original has closed, and a Herdr TUI
close counts only once Herdr stops showing the original
(`server/src/world/agent-move-views.test.ts` runs both connections of one
Herdr through the real TUI side).

`quint/agent-move.ts` replays sampled traces through the real
`moveAgentAcross`, with both sides scripted by the trace and fenced like a
runtime lease. It compares the outcome, the calls made, who runs and owns the
desk, what the report names, and that each side was resolved once by its
admitted connection ID and generation, and that a second move inside the
settle window is refused. Seven model faults (no second recheck, a call
reaching a reconnected side, assuming an unreadable source still runs, an
unnamed lost start, start-first for a locking harness, no fork check, a
cross-runtime handoff where a native move fits) and six production mutants
(no second recheck, assume alive, Codex start-first, no fork check, no native
route, no settle window) must be rejected.

The model found two faults in the first version, both fixed and kept as
replay witnesses in `quint/agent-move.test.ts`: a lost close reply followed by
an unreadable source put the desk back and closed the copy, though the
original may have ended (now `uncertain`, copy kept); a lost start reply did
not name the copy that may be running. The close-first extension found that
a reconnect during the re-read before the close escaped as a raw error; it is
now a `reconnected` refusal with nothing closed (unit test in
`agent-move.test.ts`).

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
same agent are not excluded. A close-first move whose Board update fails
moves the agent but leaves its desk details on the old address; the move log records it.
A forking harness that does not report its session is not detected. A service crash between start and close can leave
both copies; World does not recover it automatically. Real harness startup,
login and readiness are checked by the owner check on a real Herdr TUI and
herdr-core, not here.
