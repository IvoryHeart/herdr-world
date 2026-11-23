# Apartments notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town's green building sign, town center ring and Board's hub (**Past sessions**) open one Apartments dialog.
- Search opens resident detail, Read history, Resume in room and confirmed Evict on desktop/phone.
- ?apartments-preview=avatars supplies one-load synthetic appearance cases and removes itself.
- TUI resume opens the new terminal; core reports it back. Claude/Codex resume on the original host.

**Code:**

- `web/src/world/apartments/`
- `shared/apartments.ts`
- `server/src/features/apartments/` (construction, RPC declarations/handlers and close lifecycle)
- `server/src/world/apartments.ts`
- `server/src/world/apartment-census.ts`
- `server/src/world/apartment-resume.ts`
- `server/src/storage/apartments.ts`
- `web/src/world/apartments/ApartmentsDialog.tsx`
- `web/src/features/apartments/mount.tsx`

**Tests:**

- `server/src/world/apartments.test.ts`
- `server/src/world/apartment-census.test.ts`
- `server/src/world/apartment-history.test.ts`
- `web/src/world/apartments/ApartmentsDialog.dom.test.ts`
- `web/src/world/apartments/residentLook.test.ts`

**Pitfalls:**

- Disconnect/restart is not an observed ending; census is a separate admission route.
- One session is one resident; a running session hides its asleep record.
- Eviction forgets the record, not the transcript, and suppresses census rediscovery.
- Fallback looks disclose their basis instead of inventing captured appearance.
- No Apartments CLI is specified; resume uses the shared launcher.

## Usage reference

### Apartments: finished agents

Contract: [Apartments](spec.md).

**Apartments** holds every agent that is not running now, asleep and
resumable: agents from before Apartments existed, on every connected host
(Herdr TUI and herdr-core). Agents move in three ways:

- **Found asleep**: on each connected host World reads the transcripts Claude
  Code (`~/.claude/projects`), Codex (`~/.codex/sessions` and
  `archived_sessions`), Pi and Oh My Pi keep, honouring `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `PI_CODING_AGENT_DIR` and `PI_CONFIG_DIR`. Each such agent
  moves in with its harness as name, its folder, its session, when its
  transcript started and was last written, and its first request as summary.
  World looks through a host's histories when it first sees the host, then
  every 15 minutes, newest first and at most 400 transcripts read per pass
  (a longer history continues a minute later). It reads only each file's
  first bytes, once per World run, and writes nothing on the host. Codex
  subagents and Claude sidechains are another agent's helpers, not agents.
- **Its terminal ended**, seen by World while it observed the host.
- **Retired by the bus** when the bus took it from the bin.

Each resident keeps its name, harness, project folder, room and tab, host, when
it ran, its last task summary, its last report (the closing message of its
transcript, when the host answers within ten seconds; added just after the
move-in, and lost if World stops first), the pull requests and issues the
Sources linked to it, and its harness session (the one its Chat reads: Herdr's
report, or for herdr-core a linked Codex session, Claude's process record or
the launch command, read again while the agent runs). One session is one
resident: an ending World sees replaces the found record of that session.

- Open it from the green **APARTMENTS** sign on the sandstone block in Town's
  park beside the town center (left of the plaza, or right when there is no
  room; a town too small for it hides the building), where the bus brings
  binned agents to its door and the sign's count goes up as each walks in
  (see **Bin and bus** under [Visual control plane](../notes.md#visual-control-plane)),
  from **Apartments** in
  the town center ring, or from **Past sessions** in Board's hub (Board's
  plain name). All three read the same residents, and the ring and hub show
  how many live there.
- Each resident shows its avatar, as Town and Inspector show a live agent:
  its Town character on its terminal colour, with its harness's icon, in the
  list (with its harness, project, room and host) and larger in the opened
  resident. World keeps the avatar at move-in: the avatar chosen for its
  pane, else its profile's look, else the character Town drew for it, and
  the colour Town showed: its tab's, else (a spawned agent) its parent's
  tab's, else its room's. Herdr TUI and herdr-core residents look the
  same. A resident whose avatar was not kept (it moved in before World kept
  avatars, or World found it in its harness's history) shows the nearest: its profile's look, else a profile of the same
  harness, else World's default character; hovering the avatar says which.
  Its colour then falls back to the plain tile.
- Each resident shows its own usage this week under its row and in the
  opened resident, worded as an agent card's line: "This week: at work 3 h ·
  waited on you 0 min · 7.1M tokens". A harness World reads no log of
  (Cursor, OpenCode and others) reads "tokens and cost not available for
  this harness". World counts a resident under the usage agents it ran as
  while World watched it, in its own harness session only (a resumed
  session adds its new run; another session later in the same terminal
  starts its own count). Runs of one harness that follow each other in one
  shell terminal (a crew terminal's fixer, then its next fixer) share one
  usage agent, so their lines read "This week, with 1 other run in its
  terminal: …" with the shared numbers. World counts only agents it watched
  at work, so an unknown line says why: "found in its history, World kept no
  usage for it" (ended before this World watched it, ran outside it, or left
  into a shell before a World restart), "World
  did not record it while it ran" (from before World kept usage), or
  "nothing recorded this week". A fresh World data folder therefore shows
  usage only for agents that end after it started watching them: close an
  agent's terminal, or leave it into a shell, and it moves in with its
  usage.
  While the read is not in the line is empty. In Town, clicking the line
  closes Apartments and opens Usage on **Breakdown** filtered to that
  resident, even when its usage is unknown (Breakdown then says "Nothing
  measured"); from Board's hub the line is text only.
- `?apartments-preview=avatars` in the page's address shows synthetic
  residents, one per avatar case and one OpenCode resident, for that load
  only (the page removes it at once; nothing is saved). Add `&usageFixture`
  for synthetic usage lines.
- A resident whose session runs again at a desk is hidden while it runs, and
  returns when it stops, also when its terminal stays open with a shell. Its
  newer end is recorded when that terminal closes. A transcript written in the last 10 minutes is left
  for a later pass, since its agent may still be running.
- Search matches name, harness, project, folder, room, host, summary, report,
  `#42` or `PR 42`, repository and the day it ran or moved in (`2026-11-19`).
  Residents list newest first; the newest 200 matches are shown, and a search
  finds older ones.
- Opening a resident shows its facts, how it moved in, summary, report and
  linked work. **Read history** reads its conversation from the harness
  transcript on its host, the same chat reading Inspector uses (the latest 200
  messages); a message opens in full. History needs that host connected.
- **Resume in room** starts the agent again with its harness's own resume
  (`claude --resume <session>` or `codex resume <session>`) in a room on the
  host where it ran: its old room when it still exists, or the one chosen. A
  Herdr TUI room opens the new terminal; herdr-core says it is back. The
  command is also shown to run by hand. Resume is refused on another host,
  for a resident with no session, and for harnesses other than Claude and
  Codex; the resident stays either way.
- **Evict…**, then **Evict**, forgets a resident. Its transcript stays on the
  host, and a later pass does not bring it back; it returns only if it runs
  again and World sees it end. World keeps at most 5000 residents, whatever
  their age; the longest asleep go first. Running, recent, empty and evicted
  transcripts take none of those places.
- Limits: Kimi, Grok, Muse and Antigravity keep histories World does not look
  through, so their agents are recorded only when World sees them end. An
  agent whose host disconnects, restarts or changes runtime generation is not
  recorded as ended, nor one that ends while World is stopped; a found record
  covers it later when its harness is one of the four above. Found agents have
  no room, tab or linked work. Records live in World's own store on this
  computer.
