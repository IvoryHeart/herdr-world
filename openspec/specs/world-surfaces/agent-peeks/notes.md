# Agent Peeks notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town agent/reception hover previews; tap and keyboard activation open the agent's Inspector.
- Town and Board peeks offer Open chat, Open terminal, Files and qualified answer choices.
- Agents open preference selects Chat/Terminal; phone Chat has one composer and no terminal key bar.
- TUI/core share presentation; readable harness conversations and input capabilities determine availability.

**Code:**

- `web/src/world/town/TownPeek.tsx`
- `web/src/world/board/BoardPeek.tsx`
- `web/src/world/WorldInspectorConversation.tsx`
- `server/src/agent/conversation.ts`
- `web/src/attachmentUploads.ts`

**Tests:**

- `web/src/world/WorldInspectorChatWorktree.test.ts`
- `web/src/components/TerminalComposer.uploads.test.ts`
- `web/src/world/DeskView.test.ts`

**Pitfalls:**

- A peek is read-only conversation preview, not a separate chat window or upload composer.
- Hover alone cannot take keyboard focus or intercept typing in a terminal.
- Use the conversation watch for latest chatter; screen text is not the latest message.
- Opening an agent returns its character to its desk without marking work reviewed.
- There is no peek CLI; task-summary and ask have separate contracts.

## Usage reference

## Agent Awareness and Session Inspection

- See Herdr-recognized identity and working/blocked/done/idle status in the tree,
  pane switcher, command menu, and Agent panel. Focus panes there or through
  browser completion notifications.
- Read and reply to an agent in the Inspector's **Chat** tab, which replaces
  History. Chat reads the conversation from the agent's transcript, never the
  terminal, and hides context the harness injects as user turns. It sends with
  Herdr's agent prompt only to a session Herdr ties to the pane (a reported
  session or a Codex title thread), not to one World guessed from the folder.
  The paperclip (**Add a file**) attaches files, which upload to the pane's
  host and add their paths to the message. Enter adds a line; the paper-plane
  button, Ctrl+Enter or Cmd+Enter sends.
  A sent message shows as not yet seen until its session's transcript has
  the same words, and then as matched by its words, never as delivered.
  When there is evidence it went to another session, a red notice names both
  sessions and pauses Send until dismissed; when Chat can no longer check, it
  says so, or that it cannot tell when the same words appeared at about the
  same time. All slash commands use Chat's shared Compose editor and have
  **sent, not checked** receipts until their text appears in the transcript.
  Claude Code's `!` and `#` modes still use the Terminal.
  A Now bar shows the agent's status, its current task from the terminal title
  and how long it has been at it, with Stop (or Esc twice) for Claude Code,
  Codex and Pi; the step running now shows with its command and timer.
  Harness task titles omit animated spinner glyphs even after a letter or name
  prefix. On Herdr TUI connections those frames alone do not refresh Chat;
  changes to the task text, status or conversation still do.
  When the agent waits on a permission prompt, a question (one or several,
  with each choice's description) or plan approval, Chat shows it as an ask
  card and answers with the option you pick (click or its number key), after
  checking the question has not changed. A form of several questions lists
  every question's header with whether it is answered, asks them one at a
  time, and then offers **Submit answers** from its review. Codex question
  dialogs offer numbered choices without approval key hints. Claude Code's
  **Type something.**, **Chat about this** and plan feedback offer a text field
  and **Send text answer**, with the native destination checked before sending.
  Each tool call's row in Chat carries its evidence: a plain label, its state
  and time, a pass or fail badge for a test run, and when opened, the edit's
  diff, the test strip with its first failure, or the end of its output.
  It refreshes when the service sees the transcript, title or status change,
  without browser polling, and keeps the last good view if a read fails. When
  it cannot read the conversation it shows the reason with the matching action:
  copy the integration command, link a Codex session, **Refresh** or **Open
  Terminal**. **Details** opens the History view below. See [Chat](../../../../docs/CHAT.md).
- Inside the scrolling conversation, Chat shows the current quest as one
  collapsed title/progress row. Expand it for the progress bar and objectives
  as pending, active, done or blocked,
  read without a model from the harness's own todos (Claude Code `TodoWrite` and
  tasks, Codex `update_plan`, Kimi `SetTodoList`), approved plan, Codex goal or
  `/loop`. See [Quests](../../../../docs/CHAT.md#quests).
- In Details, switch between **Chat** and **Timeline**. Chat pairs tool calls
  with results and shares Ranger's conversation minimap; Timeline keeps individual
  records available. Use **Link Codex session** to preview a full conversation UUID
  and confirm its association with the foreground Codex pane. This replaces the
  existing link for all viewers. Codex lookup searches active and archived records
  on the selected local/Unix SSH runtime; Windows SSH history remains unavailable.
  For shared-daemon Codex panes without a session report or thread title, one
  matching pane and one loaded thread can provide a recent, read-only guess.
  Ambiguity shows no conversation. Add **Thread ID** with `/title`, link the
  session explicitly, or use the Terminal to reply or answer permissions.
- Details' **Chat** view has a terminal message box sharing the pane's Message
  draft. Paste images or choose **Add images**; uploaded paths stay in the draft
  until sent. Desktop Enter sends and Shift+Enter adds a line; touch Enter adds
  a line and **Send** sends. A working, blocked or unknown agent first requires
  **Send anyway**. This types into the selected terminal and has no Chat receipt.
  The primary Chat tab keeps its session-binding and permission-answer checks.
- Details' **Chat** view can read an agent reply aloud with **Speak**. Unless
  you choose a voice in **Settings → Read replies aloud**, only an
  on-device voice is used. A network voice, labelled there, can send the reply
  text to the browser vendor and is used only when chosen. A saved voice that
  disappears falls back to an on-device voice, never a network one, and a
  browser without one says so instead of speaking. The same settings set the
  speaking rate; playback may stop while the browser is in the background.
- Codex launch commands default to `codex --no-daemon`, so integration hooks
  inherit the selected pane's environment. Install the Codex integration on that
  host and resume existing shared-daemon conversations in this mode. See
  [Codex launch guidance](../../../../docs/HISTORY.md#pane-scoped-codex-launches).
- Open Details with independent User/Agent/Tool filters (User/Agent enabled,
  Tool hidden initially), a message minimap, and on-demand tool details. The recent window
  counts 200 conversation entries, not associated tools; exports remain complete.
  See [History synchronization](../../../../docs/HISTORY.md).
- Choose **Agents: Separate** at the bottom of Workspaces for a dedicated panel,
  keep agents nested, or pick **Agents: Compact** to hide agent rows and always
  show each workspace/worktree tab count instead. Separate defaults to
  **Attention first**: blocked,
  done, working, idle, unknown. Sort/Group icons offer workspace/manual order
  and status/workspace/type groups with collapse controls. Ungrouped manual
  order supports dragging. Sort/group preferences are browser-local; manual
  order is per connection. Idle agents sort by newest session-file activity
  reported by the bridge, with Herdr state-change sequence as a fallback.
  Recency survives refreshes and completion acknowledgements without browser
  activity tracking; manual and workspace order stay unchanged.
- Rows show tab names before pane IDs; blank or numbered defaults (`2`, `Tab 2`)
  are omitted in both views.
- Inspect turns, tokens, update time, session ID/file, and other metadata. Session
  Inspector offers Timeline, searchable ATIF/raw transcripts, and original-file
  or normalized ATIF export.

Readers exist for **Codex, Claude, Kimi, Grok Build, Pi, Oh My Pi, Muse Code, Antigravity CLI**; Codex,
Claude and Pi are checked against real transcripts (see the [harness matrix](../../../../docs/CHAT.md#harness-matrix)). Missing Herdr integration metadata shows the integration command.
Codex 0.157 and later run conversations in a shared background service, so
Herdr's hook cannot say which pane shows which one. Run `/title` in Codex and
add Thread ID: History then reads the conversation from the pane's title, and
shows nothing rather than guess when the title does not identify exactly one.
With `--ssh-host`, Herdr-reported paths and Claude, Pi and Codex ID lookups read remotely.
SSH Claude lookup requires a unique UUID match under that host's
`CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects/` when unset;
missing or ambiguous transcripts never fall back to this machine's files. Other
ID/directory fallbacks (including Grok Build and Antigravity CLI discovery) remain local and need
locally accessible transcripts.
