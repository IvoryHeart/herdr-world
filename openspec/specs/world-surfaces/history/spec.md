# World history

## Purpose

Define the user-facing history contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Session-qualified task summaries

The packaged `herdr-world task-summary` command SHALL report a normalized, redacted,
80-Unicode-code-point-or-shorter `task_summary` token and a SHA-256 fingerprint token
for one explicitly identified Herdr pane without starting the World web service.

#### Scenario: Session-qualified task summaries acceptance rules

- **WHEN** World reports tasks or reads and presents agent History
- **THEN** The
  fingerprint SHALL cover `JSON.stringify([source, agent, kind, value])` for that pane's
  current Herdr `agent_session`; World SHALL show the producer token only when the exact
  current session still matches it. The command SHALL accept `--pane` or `HERDR_PANE_ID`,
  the existing named-session selection, and an explicitly requested fixed-policy SSH
  transport. It SHALL use the same TTL for both tokens, default to 900,000 milliseconds,
  accept only 1 through 86,400,000 milliseconds, and leave expiry to Herdr. It SHALL NOT
  offer `--clear`, because Herdr cannot conditionally delete pane-global token keys by
  expected session identity.

#### Scenario: Current session reports work

- **WHEN** a harness reports `Reviewing CI` for an exact pane with an active session
- **THEN** Herdr receives the summary and its paired fingerprint in one metadata call,
  and Town, Board and Inspector show the text after their existing observation
  path refreshes

#### Scenario: Session is replaced or observations disagree

- **WHEN** a pane starts another session, has no complete session, or pane and agent
  observations disagree about the session
- **THEN** a summary fingerprinted for the prior session is absent from World surfaces

#### Scenario: Delayed cleanup is invoked

- **WHEN** a former hook invokes `herdr-world task-summary --clear`
- **THEN** the command exits with a usage error before requesting pane metadata, leaving
  any newer summary intact

### Requirement: Qualified History presentation and explicit Codex linking

History SHALL offer Chat and Timeline over the same bounded loaded transcript.

#### Scenario: Qualified History presentation and explicit Codex linking acceptance rules

- **WHEN** World reports tasks or reads and presents agent History
- **THEN** Chat SHALL pair tool calls with their results and offer a conversation minimap
  without implying older records have been fetched. Switching presentation SHALL
  retain the selected runtime and pane lease.

  On Unix SSH connections, a Herdr-reported Claude session UUID SHALL resolve
  against that host's `~/.claude/projects/<project>/<UUID>.jsonl`. Exactly one
  project transcript SHALL match; duplicate matches and lookup/read errors SHALL
  NOT fall back to this machine's files. History and Chat SHALL read the resolved
  file through the captured connection's file adapter. A readable reported session
  MAY use Chat Send under the existing session and native admission checks;
  remote discovery SHALL NOT grant authority to a guessed session.
  The projects root SHALL be canonicalised on the selected host, including a
  symlinked root. The returned transcript path SHALL match the requested UUID and
  one immediate project beneath that canonical root before stat/read admission;
  stat metadata SHALL NOT redirect the validated path.

  A manual Codex session link SHALL require a full session UUID, readable metadata
  from the selected runtime, a preview and explicit confirmation. The one-shot
  preview SHALL expire after five minutes and bind the pane terminal, foreground
  process/group, existing session and transcript identity. Confirmation SHALL reject
  changed witnesses or runtime authority before reporting the link, then verify
  Herdr retained it. Remote lookup SHALL NOT fall back to local transcripts.
  The external runtime does not offer an atomic process-and-link operation; this
  contract does not exclude a process change during the final report RPC.

  Codex title IDs SHALL take precedence over hook reports. A report contradicted
  by another pane claiming or naming its thread SHALL NOT bind a conversation.
  Without a title or report, World MAY infer a read-only conversation from the
  selected runtime's existing app-server only when exactly one Codex pane and one
  loaded interactive thread share an exact directory, recent activity and matching
  status, with no recently updated unloaded interactive competitor. Inference SHALL require complete bounded discovery and unchanged pane
  evidence, SHALL be recomputed per snapshot, and SHALL NOT persist a session link.
  Chat SHALL label this evidence `guessed`, with no session fingerprint, Send or
  answer keys. Missing, stale, conflicting or ambiguous evidence SHALL yield no
  inferred conversation; remote discovery SHALL NOT fall back to a local daemon.
  Uniqueness covers visible panes in the selected connection, not every client
  sharing that daemon or Codex home. An unseen client MAY make a guess incorrect;
  this evidence SHALL remain read-only. Quest snapshots SHALL share discovery and
  take a final pane snapshot after the daemon read. Successful metadata SHALL NOT
  survive the snapshot; unavailable discovery MAY suppress guesses for 60 seconds.
  Discovery state SHALL belong to one connection ID and runtime generation and
  SHALL be discarded on generation replacement. Exact/reported binding and Send
  SHALL NOT depend on this cached metadata.

#### Scenario: Shared daemon with one eligible pane and thread

- **WHEN** an unlinked Codex pane uniquely matches one loaded thread on its own runtime by directory and recent matching activity
- **THEN** Chat and History read that thread as a guess, without granting message or answer authority

#### Scenario: A second pane or thread makes inference ambiguous

- **WHEN** another Codex pane or loaded thread shares the directory, or the evidence changes during discovery
- **THEN** the next snapshot withholds the inferred conversation, including any previously inferred match

#### Scenario: The pane's own recently active thread has been unloaded

- **WHEN** one visible idle pane shares its directory with a recent unloaded interactive thread and another client's loaded idle thread
- **THEN** both threads count as competitors and World shows no inferred conversation

#### Scenario: A daemon client is outside the selected connection

- **WHEN** an unseen client shares the daemon and visible metadata leaves one eligible thread
- **THEN** any inferred conversation remains an explicitly fallible guess with no message or answer authority

#### Scenario: A pane changes after preview

- **WHEN** the captured runtime, terminal, foreground Codex process, existing
  session or transcript identity changes before confirmation
- **THEN** the link is refused and a fresh preview is required

#### Scenario: Nested Inspector navigation and transient UI

- **WHEN** terminal screen, Composer panel, Inspector navigation and a menu are open
- **THEN** successive system Back actions close menu, navigation, panel and screen
  before returning to the prior route

### Requirement: History terminal input preserves the pane draft

Details' Chat history view SHALL share the selected pane's runtime-qualified,
in-memory terminal Message draft and single-submission lock.

#### Scenario: History terminal input preserves the pane draft acceptance rules

- **WHEN** World reports tasks or reads and presents agent History
- **THEN** Sending SHALL type
  into the captured pane through its admitted connection; a retired connection
  SHALL refuse dispatch and restore the draft. Image uploads SHALL retain successful
  paths in the original draft. A working, blocked or unknown agent SHALL require
  explicit **Send anyway** confirmation; repeated Enter SHALL NOT confirm. Primary
  Chat's conversation-binding and receipt requirements SHALL remain applicable.

#### Scenario: History opens after a same-runtime reconnect

- **WHEN** the transport epoch changes while the pane's runtime remains the same
- **THEN** History SHALL show the terminal's existing draft and SHALL send it at most once
- **AND** retirement during input SHALL NOT move the draft or dispatch to another connection

#### Scenario: Codex readiness is unknown

- **WHEN** Codex has an unknown, absent or unrecognized status and the user presses Enter or Send in History
- **THEN** History SHALL show the terminal-input warning without dispatching the draft
- **AND** repeated Enter or Send SHALL NOT confirm; a separate **Send anyway** activation SHALL be required
