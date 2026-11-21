# World apartments

## Purpose

Keep agents that are no longer running discoverable, inspectable and explicitly
resumable on their original host, for both Herdr TUI and herdr-core.

## Requirements

### Requirement: Resident admission and identity

Apartments SHALL retain agents found asleep in supported harness histories,
agents whose terminals World observed end, and agents retired by the bin's bus.
One harness session SHALL identify one resident on its host; an observed ending
SHALL replace that session's found record. Disconnect, restart, runtime-generation
replacement and endings while World is stopped SHALL NOT count as observed endings.

#### Scenario: A host disconnects

- **WHEN** a host disappears while its agents were running
- **THEN** World does not invent resident endings; a later supported-history census may find their sessions asleep

### Requirement: Bounded historical discovery

World SHALL read connected hosts' Claude Code, Codex, Pi and Oh My Pi histories,
including Codex archived sessions, honouring CLAUDE_CONFIG_DIR, CODEX_HOME,
PI_CODING_AGENT_DIR and PI_CONFIG_DIR. Discovery SHALL run on first observation
and every 15 minutes, newest first, reading at most 400 transcripts per pass and
continuing longer histories one minute later. It SHALL read only initial bytes,
once per file per World run, and write nothing on the host.

#### Scenario: Histories exceed one pass

- **WHEN** a connected host has more than 400 eligible transcripts
- **THEN** World reads a bounded newest-first pass and continues a minute later
- **AND** Claude's `~/.claude/projects` and Codex's `~/.codex/sessions` and `archived_sessions` are the default roots; configured roots override them

### Requirement: Census exclusions and running sessions

Codex subagents and Claude sidechains SHALL NOT become residents. Transcripts
written within ten minutes SHALL wait for a later census. A resident whose
session runs at a desk SHALL be hidden until it stops, including when its terminal
returns to a shell; closing that terminal SHALL record its newer end. Kimi, Grok,
Muse and Antigravity histories SHALL NOT be scanned; their agents require an
observed ending.

#### Scenario: A resident runs again

- **WHEN** the resident's session is observed running at a desk
- **THEN** its asleep listing is hidden while it runs and returns when it stops
- **AND** running, recent, empty and evicted transcripts consume no resident capacity

### Requirement: Resident facts and closing reports

A resident SHALL keep its name, harness, project folder, room, tab, host, run
times, last task summary, linked PRs/issues and harness session. The closing
transcript message SHALL be added after move-in only when its host answers within
ten seconds; a World stop before that addition MAY lose the report. Found records
SHALL use the harness as name, transcript times and first request as summary,
without invented room, tab or linked work.

#### Scenario: Resolve a live session before move-in

- **WHEN** World observes the running agent
- **THEN** its session is the one Chat reads: Herdr's report, or for core a linked Codex session, Claude process record or launch command, read again while it runs
- **AND** a slow closing-report read cannot delay saving the resident's other facts

### Requirement: Apartments entry points

Town's green APARTMENTS sign on its sandstone park building, the town center ring
and Board's hub SHALL open the same residents. Ring and hub SHALL show resident
counts. Town SHALL place the building beside the town center, left of the plaza
or right when needed, and hide it when the town is too small. Bus arrivals SHALL
increase the sign's count as their agents walk in.

#### Scenario: Open from Board on a phone

- **WHEN** the user opens Apartments from Board's hub
- **THEN** the same residents are available as through Town's building and ring

### Requirement: Kept resident appearance

Residents SHALL show their Town character on their terminal colour with a harness
icon, in the list and larger in detail, alike for TUI and core. Move-in SHALL keep
the pane's chosen avatar, else its profile look, else its drawn character, and its
tab colour, else its spawning parent's tab colour, else its room colour.

#### Scenario: Inspect a recorded resident

- **WHEN** a resident has a kept appearance
- **THEN** list and detail retain it together with harness, project, room and host facts

### Requirement: Honest fallback appearance

A resident without a kept avatar SHALL use its profile's look, else a profile of
the same harness, else World's default character, with hover guidance naming the
basis and a plain colour tile. The one-load `?apartments-preview=avatars` fixture
SHALL show synthetic avatar cases, remove its parameter immediately and save
nothing.

#### Scenario: Census finds an old session

- **WHEN** a resident has no captured live appearance
- **THEN** its fallback identifies the basis rather than claiming an observed avatar

### Requirement: Search and resident detail

Apartments SHALL list newest residents first and show the newest 200 matches.
Search SHALL find older residents by name, harness, project/folder, room, host,
summary/report, issue or PR number, repository and run or move-in day. Detail
SHALL show facts, admission reason, summary, report and linked work. Read history
SHALL use Inspector's host-qualified transcript reading, with the latest 200
messages and expandable full messages, requiring the owning host connected.

#### Scenario: Find an older pull request

- **WHEN** the user searches `#42`, `PR 42`, a repository or a day such as `2026-11-19`
- **THEN** matching older residents remain discoverable beyond the default 200-row listing

### Requirement: Explicit same-host resume

Resume in room SHALL run Claude's `claude --resume <session>` or Codex's
`codex resume <session>` on the resident's original host, in its old room if
present or a chosen room. TUI SHALL open the new terminal; core SHALL report it
back. World SHALL also show the manual command. Another host, missing session or
another harness SHALL refuse resume. The resident SHALL remain stored either way.

#### Scenario: The old room is gone

- **WHEN** the user resumes a supported resident whose original room no longer exists
- **THEN** the user chooses a current room on that same host before launch

### Requirement: Eviction and resident bounds

Evict SHALL require the Evict… then Evict confirmation, forget the resident and
leave its host transcript intact. Later census SHALL NOT recreate it; running
again followed by an ending World observes MAY do so. World SHALL keep at most
5,000 residents regardless of age, evicting the longest asleep first, in its own
local store.

#### Scenario: Census sees an evicted transcript

- **WHEN** a later pass encounters a session the user evicted
- **THEN** it stays absent until it runs again and World witnesses its ending
