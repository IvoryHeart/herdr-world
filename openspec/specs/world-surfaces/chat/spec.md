# World chat

## Purpose

Define the user-facing chat contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Chat source links use the admitted Inspector worktree

In Town, Board and Desk, local source references in an agent conversation SHALL
open Files in that same Inspector at the referenced line or Markdown heading.

#### Scenario: Chat source links use the admitted Inspector worktree acceptance rules

- **WHEN** World presents Chat or prepares conversation input
- **THEN** Supported references SHALL
  include absolute paths with an optional line number, root-level filenames,
  complete inline-code paths (including spaces) and Markdown file links. Escaped
  filename delimiters SHALL remain filename content; version-number prose SHALL
  NOT become automatic source links. Automatic basename recognition SHALL require
  both a known source/document format and a filename context (inline code, a line
  location or a standard document name). A code command or list of references
  SHALL retain individual source-path links and line locations rather than become
  one combined filename. Automatic recognition of a spaced inline-code filename
  SHALL require a qualified path prefix; explicit Markdown links SHALL remain
  available for ambiguous names or unrecognized automatic formats. Relative references SHALL resolve within the
  selected agent
  worktree. HTTP and HTTPS links SHALL remain web links. Inspectors without an
  admitted agent-worktree integration, including Spaces, SHALL retain ordinary
  Markdown navigation and SHALL NOT offer a nonfunctional worktree chooser.

  Source navigation SHALL preserve the originating connection, runtime generation,
  pane/session and the shared Files/Changes worktree binding. It SHALL NOT admit a
  path outside that selected root, use a workspace default, change another
  Inspector or accept a delayed result from a replaced binding. Missing or stale
  bindings and unresolved local paths SHALL show an explicit unavailable or
  choose-worktree state, without browser navigation to a local-path URL.

#### Scenario: Open a source reference on desktop or phone

- **WHEN** a user activates a local source link with a line in Chat
- **THEN** that Inspector selects Files and reveals the file and line using its
  admitted agent worktree, including when opening the same file at another line

#### Scenario: Source link cannot use its originating worktree

- **WHEN** the binding is stale or belongs to another host, generation or session,
  or the path is outside the selected worktree
- **THEN** no fallback file read or browser navigation occurs, and the Inspector
  offers an explicit unavailable notice or worktree choice

#### Scenario: Refresh equivalent evidence while a source read is pending

- **WHEN** opening Files refreshes worktree evidence with identical connection,
  runtime, subject, revision, candidate and root values before the read completes
- **THEN** the successful read still reveals its requested line, genuine binding
  replacements continue to retire old work, and notices follow their binding

#### Scenario: Code lists and executable-led commands preserve source items

- **WHEN** inline code contains comma/semicolon-separated references, mixed
  qualified paths and basenames, or a command led by an executable directly in
  `bin`, `sbin` or `.bin` at any relative or absolute installation prefix, or in
  virtualenv `Scripts`
- **THEN** each source item retains its own file link and line location, including
  lists without spaces after commas; a single qualified filename containing
  spaces or a literal comma remains whole when it is unambiguous; spaced names
  directly in these executable directories remain available as explicit Markdown links

### Requirement: Honest agent startup presentation

When Chat is the chosen opening view, an agent SHALL open on Terminal until
Chat can show its conversation.

#### Scenario: Honest agent startup presentation acceptance rules

- **WHEN** World presents Chat or prepares conversation input
- **THEN** No session, unsupported harness, missing
  integration and unreadable records SHALL all keep it on Terminal; a reported
  session alone is insufficient. When the same agent's conversation becomes
  readable, the window SHALL switch to Chat unless the user has chosen a view.
  Replacing the terminal or harness SHALL cancel that automatic switch, including
  late replies after the original identity is restored.

  Unavailable Chat explanations SHALL appear only when the user chooses Chat.
  Chat before a conversation exists SHALL show an empty conversation, plain
  starting/waiting guidance and Open Terminal. A named record that is missing or
  unreadable SHALL keep its error. Startup presentation SHALL NOT allow sending
  messages or answering prompts without their existing authority checks.

#### Scenario: An agent is waiting at a startup question

- **WHEN** the agent has not reported a conversation
- **THEN** its window opens on Terminal; manually opened Chat explains startup
  without suggesting an integration install

#### Scenario: Chat becomes available

- **WHEN** the same agent's conversation becomes readable and no view was chosen by hand
- **THEN** the existing window switches to Chat

#### Scenario: A reported session has an unreadable record

- **WHEN** the agent is opened and Chat cannot read its reported record
- **THEN** the window stays on Terminal; choosing Chat manually shows the
  original record error and Open Terminal

#### Scenario: A view was chosen or the agent was replaced

- **WHEN** a session is later reported
- **THEN** the old automatic switch does not change the chosen view

### Requirement: Shared Chat composer and honest send receipts

Chat SHALL reuse TerminalComposer, its harness command palette, editing and uploads,
with a separate draft qualified by connection, runtime, terminal, pane and session.

#### Scenario: Shared Chat composer and honest send receipts acceptance rules

- **WHEN** World presents Chat or prepares conversation input
- **THEN** Chat SHALL hide Direct mode, Insert draft and the terminal key bar. Enter SHALL
  insert a new line. Ctrl+Enter, Cmd+Enter and the paper-plane Send button SHALL send.
  The paperclip SHALL attach files. Typing `/` or choosing Browse commands in the
  vertical-ellipsis controls menu SHALL open the shared harness command palette.
  Submissions SHALL use the bound conversation's
  agent prompt rather than terminal insertion. Every slash command SHALL be allowed.

  Native working-state admission SHALL show a queued bubble with recipient and send
  time until transcript evidence arrives. World SHALL NOT add a second send queue.
  Blocked sends SHALL preserve the draft and show the refusal. Commands without a
  literal own-transcript receipt SHALL say **sent, not checked**; neither a session
  switch nor a rewritten user turn SHALL claim their effect was checked or misdelivered.

  The current quest SHALL appear at the start of its section inside the scrolling
  conversation, collapsed to a title/progress row. Its keyboard-reachable expand
  button SHALL expose aria-expanded and reveal objectives inline. The row SHALL
  repeat no agent identity or status and SHALL NOT be sticky.

  While the reader is scrolled away, the existing floating catch-up button SHALL
  count only new agent messages, excluding own sends, queued bubbles, tool activity
  and transcript notices. Reaching the bottom or changing sessions SHALL clear it.
  Older-page loading SHALL NOT increment the count. Focused answer keys and the
  existing double-Escape stop SHALL retain their existing scope.

#### Scenario: A command intentionally switches sessions

- **WHEN** a bound Chat sends a slash command and the harness switches sessions
- **THEN** its slim receipt remains **sent, not checked** without pausing normal sends
  as a misdelivery; no command effect is inferred

### Requirement: Chat answers captured prompt choices and text options

Chat SHALL recognize complete Codex approval menus with key hints and complete
Codex question dialogs with their question counter, numbered choices, one cursor
and notes/submit/interrupt footer.

#### Scenario: Chat answers captured prompt choices and text options acceptance rules

- **WHEN** World presents Chat or prepares conversation input
- **THEN** Question choices SHALL use their digit shortcut
  without requiring an approval key hint. A waiting Codex pane detected by Herdr
  without turn hooks SHALL use the same bound-conversation admission; an inferred
  or guessed conversation SHALL NOT gain answer authority from a recognized screen.

  Claude Code's question and plan menus SHALL expose their recognized text options.
  Selecting one in Chat SHALL open a single-line reply field without sending input.
  Submitting SHALL check the original prompt and session, select its native option,
  wait for the corresponding empty inline editor or discussion composer, and check
  the destination again before submitting text. Missing, stale, replaced or
  unrecognized editors SHALL receive no text. A native editor that was already
  active before Chat selected its option SHALL remain in the Terminal, including
  when it appears empty; it SHALL receive neither menu digits nor text. Text SHALL be nonempty, at most 4000 characters
  and free of terminal control characters. An existing native draft SHALL remain
  in the Terminal after its cursor moves away, including text resembling a
  placeholder or another option. Discussion dispatch SHALL require a complete empty
  composer with no continuation rows and unchanged session, terminal, revision,
  state sequence, title and status across its screen read; discussion text SHALL NOT invoke the
  composer's slash, shell or memory commands. Answers to one pane SHALL NOT
  interleave inside a conversation source.

  Digits within the reply input SHALL remain text. A replacement prompt or admitted
  connection, runtime, pane or session SHALL reset its option and draft. An answer receipt SHALL claim acknowledgement only from the
  same session moving on, not merely from successfully writing input. After queuing
  a discussion reply, Chat SHALL wait at most three seconds for working evidence,
  then recheck the same owner. Discussion acknowledgement SHALL require a newer
  working sequence, or an idle/done sequence at least two changes newer than the
  final destination check, covering a completed turn. An unchanged sequence or an
  idle/done sequence only one change newer SHALL remain unconfirmed.
  A post-selection refusal SHALL remain visible across
  question reloads in the same owner scope until the next answer attempt, even
  when the question disappears. Herdr's lack
  of conditional input remains a documented gap between the last check and dispatch.

  Claude Code's ask-the-user questions SHALL be read from the newest open call in
  the pane's reported session transcript, bounded and complete, and joined with
  the screen. Answer keys SHALL be offered only when the screen shows one of those
  questions with exactly its options and descriptions (wrapping aside) and, for a
  form, the same header chips, or the form's own review. Otherwise, and for
  multi-select or typed questions, Chat SHALL show every recorded question,
  header, option, description and selection mode with no keys, the reason, and
  the Terminal. The prompt fingerprint SHALL cover the call and its questions as
  well as the screen. A guessed conversation SHALL NOT supply questions. An
  unrecognized prompt SHALL be shown as its whole bottom block, with the reason,
  never as a clipped tail, with its final row initially in view and after updates.
  Supplied transcript fields SHALL be validated atomically. A rejected pending ask
  SHALL remain Terminal-only without retaining screen keys. Literal wildcard and
  code contents SHALL remain significant when matching. Ambiguous asterisk markup
  SHALL NOT be discarded to grant keys. A failed transcript check SHALL preserve
  the screen question without answer keys. A form review SHALL match
  its complete ordered question list as well as its headers before keeping keys.
  History read errors SHALL remain visible alongside question cards.
  Needs you SHALL show the same card.

  Claude Code's folder-trust question before a session SHALL be recognized only
  as the complete dialog: its edge, "Accessing workspace:" heading and absolute
  folder, nonempty "Quick safety check" text, the unnumbered choices "No, exit"
  (or "No, continue without these permissions" for pre-approved tool grants) then
  "Yes, I trust this folder" with exactly one cursor, and the "Enter to confirm ·
  Esc to cancel" footer. The alternate decline choice SHALL continue Claude without
  those grants rather than exiting. Chat and Needs you SHALL display the full
  folder, safety question and warnings above the choices without clamping them.
  Menu identity SHALL ignore only the parsed option cursor, preserving every
  folder and question character. Its input SHALL be bound to a
  service-owned pre-session witness: the source's connection runtime, the pane,
  its terminal, Claude with no reported session, and the pane's foreground
  process group and processes. Every key SHALL follow a fresh read of the witness
  and the exact question, with Herdr's record unchanged across that check, under
  the per-pane input lock. A click SHALL move the cursor with one arrow key only
  when needed, confirm the same question with the cursor on that choice, and only
  then press Enter. A session arriving, a replaced process or terminal, another
  question, a stale or partial read, an unmoved cursor or concurrent input SHALL
  refuse further keys. Digit shortcuts, automatic acceptance, a fabricated
  session fingerprint or relaxed session-bound answer, key or send paths SHALL
  NOT be used.

#### Scenario: Codex waits without hooks

- **WHEN** Herdr reports a bound Codex pane blocked on a complete question dialog
  whose choices have descriptions but no key hints
- **THEN** Chat shows those choices and sends the selected digit to that pane

#### Scenario: Submit a Claude text option

- **WHEN** a user chooses a text option and submits a reply from Chat
- **THEN** Chat verifies the native editor in the same question and session before
  sending the reply and Enter, or verifies the discussion composer before using
  the normal agent prompt operation

#### Scenario: The destination changes after selecting a text option

- **WHEN** the native editor cannot be verified or its pane, session or question changes
- **THEN** Chat sends no text, explains that the option may already be selected,
  and directs the user to the Terminal

#### Scenario: Discussion progress follows prompt queuing asynchronously

- **WHEN** the prompt operation queues a discussion reply before Herdr reports
  its new turn, and progress arrives during the bounded wait
- **THEN** Chat acknowledges only same-owner working progress or a completed
  turn with at least two sequence advances, and otherwise leaves it unconfirmed

#### Scenario: A recorded question the screen does not show

- **WHEN** Claude's transcript records a question whose options or text differ
  from the screen, or that allows several options
- **THEN** Chat shows the recorded question whole with no answer keys, says
  why, and refuses any answer to that card

#### Scenario: Folder trust before a session

- **WHEN** Claude shows its folder-trust question with no session and the user
  picks the choice not under the cursor
- **THEN** the service checks the witness and question, presses one arrow key,
  confirms the cursor moved on the same question, and presses Enter

#### Scenario: A session or process change during folder trust

- **WHEN** a session arrives, the foreground process changes or the question
  changes between the card and a key
- **THEN** no further key is sent and the card shows the refusal

### Requirement: Chat completes harness command menus and composer keys

Chat SHALL show a harness's own command menu (such as Claude Code's or Codex's
`/model` and `/permissions`) that is open while Herdr reports the bound agent
idle or done, read from the bottom of its screen only on Chat's request.

#### Scenario: Chat completes harness command menus and composer keys acceptance rules

- **WHEN** World presents Chat or prepares conversation input
- **THEN** When
  Herdr reports the pane blocked, Chat SHALL show a menu only if the prompt
  parser reads no question there and the transcript is readable with no open
  tool call; otherwise the screen remains a question. A Codex menu drawn above
  its idle composer SHALL NOT be offered when the agent's last message quotes its
  title or footer or the transcript cannot be read. Only a
  complete recognized panel SHALL be offered: a Claude Code panel between its top
  edge and a footer of key segments including Escape, or a Codex title paragraph,
  numbered option block and such a footer at the bottom of the screen or directly
  above its idle composer. Options SHALL come only from numbered rows with at most
  one cursor and consecutive numbers; Chat SHALL NOT infer choices from prose. A
  digit SHALL pick an option only when no longer option number starts with it and
  the menu has no text field. Key buttons SHALL come only from keys the footer or
  an arrow hint names, plus the arrows of a list.

  The service MAY report `menu_unreadable` with reason `terminal_too_small` and the
  measured rows only when no prompt/menu was read for the current same-session
  command and `pane.get` reports positive integer viewport rows below the shared
  `TERMINAL_SIZE_FLOOR.rows`. Connection/runtime/pane ownership, native read witness
  and current command SHALL remain qualified across the read. Unknown rows,
  layout dimensions and default sizes SHALL NOT supply a size claim. With no
  prompt, Chat SHALL show “The terminal is too small to show this menu — open or
  click Terminal to fix.” and its existing Open Terminal action for that fact.
  The note SHALL grant no send, press, answer or refusal authority.

  Each menu key SHALL carry the session and menu fingerprint Chat showed. The
  service SHALL refuse with nothing sent unless the pane's session matches, the
  pane still shows a menu under those rules, the screen shows that menu, the key is one it names and
  the pane's agent, session, terminal, title, revision and state sequence are
  unchanged on a second read. Field text SHALL be one line of at most 500
  characters without control characters and SHALL be typed without Enter. A
  refusal SHALL return the menu now shown; a sent key SHALL return the next menu
  or none. Menu keys and answers to one pane SHALL NOT interleave.

  The composer's ellipsis menu SHALL offer the Terminal's configured key
  controls on desktop and phone, with the characters and modifiers the Terminal
  would send; a combination Herdr cannot name that way SHALL be disabled. Each SHALL be sent only as a Herdr key name for
  the session Chat shows and only after a second unchanged pane read; scrolling
  and keys Herdr does not name SHALL be disabled. A new connection, runtime, pane
  or session SHALL retire a shown menu and its notice. Chat SHALL NOT type a
  message or slash command into a pane that may show a menu: Send SHALL be
  disabled while a menu card is shown, and after its last preparation await the
  service SHALL read the screen regardless of reported status and refuse with
  nothing typed when the read fails or is malformed or the screen shows a menu,
  a question or a menu-like footer or cursor, including boxed options in an
  incomplete capture; blank screen padding SHALL NOT conceal that evidence.
  The final native read SHALL retain the terminal, session, state sequence and
  other identity captured for the screen check, or the send SHALL refuse.
  Ordinary prose quoted by the same
  session's last assistant message SHALL remain sendable, including Claude's
  recognized message prefix and over SSH
  with a browser delivery baseline; that baseline SHALL NOT supply quote authority.
  World inputs to one pane SHALL NOT
  overlap. A slash command SHALL be reserved per pane, session and text before
  dispatch; it SHALL be released only when nothing reached the pane and SHALL
  otherwise stay reserved, and show as waiting, until a successful qualified
  read begun after dispatch shows another session or an idle/done status. Known
  native non-submission, including `agent_not_ready`, SHALL release the reservation
  so a legitimate retry can succeed. Unknown, failed, blocked or older observations
  SHALL NOT retire a live reservation or remove its waiting presentation.
  Dismissing its receipt SHALL NOT release it. Keyboard focus SHALL stay on
  the menu card across the menu's steps, unless the user moved it outside the card
  while a key was pending. Opening, changing or
  closing a menu SHALL keep the transcript, its scroll position, the composer
  draft, attachments and send receipts. Herdr's lack of conditional input
  remains a documented gap between the last check and the key.

#### Scenario: Quoted terminal instructions in an SSH reply

- **WHEN** a bound SSH session's last assistant reply quotes terminal footer instructions and Chat supplies a delivery baseline
- **THEN** ordinary text may be sent after checking quote text from that session; actual menus and unknown screen reads still refuse

#### Scenario: A partial question or blank padding hides menu structure

- **WHEN** a question's top edge is missing, or a cut-off menu is followed by blank terminal rows
- **THEN** Chat refuses text without sending input even when it cannot offer answer controls

#### Scenario: The final observation reports a replacement terminal

- **WHEN** a screen is checked under one terminal/state witness and the final native read reports a changed witness with the same session
- **THEN** Chat refuses without sending input; an ordinary quoted footer with Claude's message prefix remains sendable when the witness is unchanged

#### Scenario: Retry a command after native refusal

- **WHEN** the native runtime rejects a command before submitting input and the same session becomes ready
- **THEN** an identical retry may submit once; a lost acknowledgement keeps it reserved

#### Scenario: A late idle observation arrives after queue admission

- **WHEN** an idle read starts before a command is admitted to a working session and returns after dispatch
- **THEN** the command remains reserved and its receipt remains waiting; a malformed observation also cannot clear either

#### Scenario: Pick a model from Chat

- **WHEN** a user sends `/model` from Chat and picks a numbered model
- **THEN** Chat shows the harness's menu, presses that digit only if the same
  session still shows the same menu, and shows the next step or none

#### Scenario: The menu changes before the key

- **WHEN** the menu, session or pane changes between Chat's card and the key
- **THEN** the service sends nothing and returns the menu now shown

#### Scenario: Press a terminal key from Chat

- **WHEN** a user presses Ctrl+C in the composer's ellipsis menu
- **THEN** the service presses it only for the session Chat shows
