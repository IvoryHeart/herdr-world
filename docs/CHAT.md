# Chat and the conversation read model

The Inspector's **Chat** tab shows an agent's conversation as messages and lets
you reply. Chat replaces the History tab. The **Terminal** tab remains a separate
view that you open on purpose.

Set **Menu → Configuration → Appearance → Chat text** to resize both your
messages and agent replies. Chat can follow the terminal text size or use its
own size.

When a reply box is available, explicitly opening or returning to Chat focuses
it so you can start typing immediately. Desk's J/K previews keep focus in the
queue. Transcript, session and connection updates do not move your focus. If
you move to another input or window while a conversation loads, its delayed
reply box leaves focus where you put it.

## What Chat does

On Unix SSH hosts, Claude Code sessions reported by Herdr as UUIDs are resolved
in that host's `~/.claude/projects/<project>/<UUID>.jsonl`. The transcript is read
through the captured connection's SSH file adapter. Missing files, duplicate UUID
matches and SSH errors never use a local transcript. A readable, reported session
can use the same session-checked Send as a local conversation; missing integration
metadata still shows the integration instructions.
The projects root is resolved on that host, including when it is a symlink.
Discovered paths must name the requested UUID directly inside one project under
that root; stat metadata cannot redirect the read to a different transcript.

- Reads only the conversation read model described below. It never reads the
  terminal screen and never shows terminal output.
- Sends with Herdr's `agent prompt`, and only to a conversation that Herdr ties
  to the pane (see [Binding](#binding)). Herdr refuses a blocked agent; answer
  its question first.
- Never calls a message delivered. A sent message shows as "Sent; not yet seen
  in this conversation" until the same words appear in the transcript of the
  session it was sent to, and then marks that message as matched by its words.
  When there is evidence it went to another session, a red notice
  names both sessions and pauses Send until you dismiss it; when Chat can no
  longer check, it says so (see [Delivery](#delivery)).
- Sends all slash commands, including custom and plugin commands, through the
  same session-qualified `agent prompt` as messages. A slim command row says
  **sent, not checked** until the literal command appears in its own transcript;
  this confirms text was seen, never that the command had its intended effect.
  Commands may intentionally switch sessions. Claude Code's `!` and `#`
  terminal input modes still require the Terminal. A message starting with a
  path, such as `/var/log/app.log fails`, is ordinary message text.
- Refreshes when the service says the conversation changed (see
  [Refresh](#refresh)). The browser has no timer. **Refresh** rereads on demand.
- Adds the shared pull request card below an agent message that announces a
  known PR with **READY** or **opened**, or names a PR on its current work
  claim. An ambiguous bare number gets no card. **Details** shows current CI,
  reviews and the owner's actions. When this conversation owns the claim,
  **Ask the author to fix** sends a `↳ #N` message through Chat; it keeps any
  unsent draft. A retired host, runtime or agent session cannot supply a claim.
- Shows what is happening now. The Now bar shows Herdr's status as a 14px
  circle (blue working ring, yellow needs-you mark,
  green done tick, grey idle dot), with its word kept for screen readers and
  the tooltip. Reduced motion shows a still working dot. It also shows the
  task the harness names in its terminal title (such as "Running tests"), and
  the time since Chat saw the status change. The step running now (a tool call
  in the transcript with no result yet) shows at the end of the conversation
  with its command or file and its own timer. Harnesses write transcripts per
  message or tool call, not per token, so this is what moves during a long
  step; it is never terminal output. The step and the clocks show only while
  Herdr reports the agent working: a call waiting for your approval, or one
  an interrupt or crash left without a result, is not shown as running.
  Screen readers hear the status and task change, not the clocks.
- Stops the agent when you ask. For Claude Code, Codex and Pi, **Stop** in the
  Now bar, or Esc pressed twice while Chat has focus, presses Esc in the
  agent's pane to interrupt the turn. One Esc only asks for a second; Chat
  never stops an agent by itself.
- Answers the agent's own question. When Herdr reports the agent blocked, Chat
  reads the bottom of its screen and recognises only the menus of supported
  harnesses:
  - Claude Code's whole permission box: a question ending in "?", numbered
    options, the ❯ cursor on one. A digit selects.
  - Claude Code's questions and plan approval: a numbered menu below a rule
    and above its footer of controls ("Enter to select · … · Esc to cancel",
    or the plan's "ctrl+g to edit"), with the question ending in "?" and the ❯
    cursor on one option. A digit selects. Each choice shows the description
    under it. "Type something.", "Chat about this" and "Tell Claude what to
    change" open a text field in Chat: write a single-line reply and choose
    **Send text answer**. A form with several
    questions shows one at a time under a row of header chips
    ("←  ☐ Color  ☒ Size  ✔ Submit  →"); the card lists every header and
    whether it is answered, and a digit answers the question shown, after
    which the form moves to the next. Its "Ready to submit your answers?"
    review, which Claude Code draws without a footer, lists the answers and
    offers Submit answers or Cancel; a footerless menu is read only with the
    chips and the "Review your answers" heading above it. Plan approval shows the whole plan Claude drew between
    its dashed edges as the request, and the fingerprint covers it; a plan
    cut off by the capture is left to the Terminal.
  - Codex's approval menu: options ending in their key hints such as "(y)" or
    "(esc)", the › cursor on one. The hint key selects.
  - Codex's questions: the complete "Question 1/1 (1 unanswered)" dialog with
    its notes/submit/interrupt footer, numbered choices and the › cursor on
    one. Choices can have descriptions without approval key hints; a digit
    submits the selected answer. Choices use logical keys: pasted digits would
    become notes in this dialog. Herdr 0.9.5 reports these waiting panes through
    screen detection rather than Codex turn hooks. Chat still requires a bound
    Codex conversation before it reads or answers the prompt.

  It shows an ask card with the complete request (the whole command, the file
  and its edit, or a form's header and answers so far), the question and each
  option. Anything else gets no options and **Answer in the Terminal**: plain
  numbered output, a y/n line, an unnumbered menu (such as Claude Code's
  folder trust), a box or form cut off by the capture, or a request the
  harness shows shortened.
- Picking an option, or pressing its number while that card has focus, calls
  `agent_conversation.answer`. The service checks Herdr's state, rereads the
  screen, and checks Herdr's state again (status, session, title, state
  sequence); the prompt's fingerprint covers the shown prompt, the session and
  the state sequence, and any difference refuses with nothing sent. Then it
  presses that option's key.
- Text replies are at most 4000 characters and cannot include line breaks or
  terminal control characters. Chat selects the native text option, waits for
  the editor, and rechecks its pane, session and question before sending text
  and Enter. "Chat about this" closes the question first and sends the reply
  through Herdr's normal `agent prompt`; discussion replies cannot start with
  `/`, `!` or `#` commands. Digits typed in the reply field remain text.
  A different question discards that field's draft. An already-open native
  editor, even if it appears empty, stays in the Terminal: Chat cannot distinguish
  a placeholder from identical text already typed there. Chat does not append to
  or replace it; start a text answer from an untouched menu in Chat instead.
  A typed native draft stays in the Terminal after its cursor moves away,
  including text beginning with a placeholder or another option's label.
  Discussion replies require the complete empty composer frame, with no
  continuation rows, and unchanged status, title and state sequence across
  its screen read.
  If the editor cannot be verified after the option was selected, Chat says
  **No text was sent** and offers the Terminal. Another answer to the same pane
  is refused while the first is in progress. The refusal stays visible across
  subsequent question reloads, including when the card disappears, until the
  next answer attempt in that same connection, pane and session.
- Codex conversations inferred from the shared daemon are read-only guesses.
  World cannot see every client sharing that daemon: another Herdr session or
  an outside terminal can make the guess wrong. Recent unloaded threads count
  as competitors; `/title` with **Thread ID** or an explicit link gives stronger
  identity evidence.
  Chat shows no answer card for them, and the service rejects answer requests
  without an exact title or uncontradicted reported binding. Use the Terminal
  to answer, or identify the thread with `/title` or an explicit session link.
- **The gap World cannot close.** Herdr has no conditional input
  ([herdrdev/herdr#4764](https://github.com/herdrdev/herdr/issues/4764)), so
  neither a selection key nor subsequent text can be made conditional on the prompt. If the prompt or session
  changes in the instant between the last check and the key, the key reaches
  the new prompt. The card says so under its options. The owner accepted this
  risk until Herdr can close it; it is tracked as a known issue in
  [#284](https://github.com/IvoryHeart/herdr-world/issues/284). Closing the
  gap needs an input Herdr applies only while the prompt is unchanged.
- Chat replaces the card with what it sent. "You answered 2 · …" needs
  evidence that this agent left this prompt: the same session, and then a
  status that shows progress (`working`, `idle` or `done`), or a recognised
  menu on a readable screen that is a different question (a form's next tab
  keeps Herdr's state) or comes with a new Herdr state. A partial or
  unrecognised screen never counts. Otherwise the receipt reads "Sent 2 · …"
  with the reason (`unconfirmed_reason`): the question still shows
  (`still_showing`), the pane has another session (`session_changed`, and the
  key may have reached it), Herdr reports a status such as `unknown`
  (`unknown_status`), Herdr no longer reports the agent (`agent_missing`), or
  the screen could not be read (`unreadable`). A discussion reply additionally
  waits up to three seconds for Herdr to report `working` after queuing the
  reply, then checks the same agent and session. It requires a newer sequence
  in `working`, or an `idle`/`done` sequence at least two changes newer than
  its final destination check, covering a turn that already finished. Without
  that evidence it gives `no_progress`; closing the menu or queuing the text
  alone does not prove the reply was accepted. Chat answers only when you
  pick an option.
- Completes the harness's own command menus. `/model`, `/permissions` and
  their follow-up steps open menus that Herdr usually reports as `idle`
  (Claude Code) or `done` (Codex). Herdr's screen rules report Claude Code's
  `/permissions` list as `blocked` once its cursor is on a rule; a blocked
  pane shows a menu only when the prompt parser reads no question there and
  the transcript has no open tool call (questions, approvals and plans are
  tool calls; a transcript Chat cannot read counts as one). Chat asks for menus
  (`agent_conversation.latest` with `menus: true`; Town never does) and
  rereads 0.7 and 1.8 seconds after sending a slash command, since Herdr has
  no event for a menu opening. Recognised shapes, captured from Claude Code
  2.1.312 (full-screen and inline) and Codex 0.164.0:
  - Claude Code: a panel between a `▔` or `─` top edge and a footer of
    `<key> to <action>` segments joined by ` · `, one of them `Esc`. Its
    first line is the title; tab rows, notes and a boxed search or entry
    field are shown as they are.
  - Codex: a title paragraph directly above a block of numbered options, and
    a footer such as `enter select · esc back`, at the bottom of the screen or
    directly above the idle composer (the full-access confirmation).
  The menu card shows the title, the other lines, each numbered option with
  the harness's cursor marked, the field's contents and one button per key
  the footer names (plus `↑`/`↓` for a list and `←`/`→` where a line says
  `←/→ to …`). Unknown footer keys, such as `ctrl+g`, give no button. A digit
  picks an option only when it cannot start a longer option number (in a
  13-model list, `1` could start `10`) and the menu has no text field, which
  would take the digit as text; those options are reached with the arrows.
  Field text is one line of at most 500 characters without control
  characters, typed without Enter so the next screen shows it before the
  menu's own Enter submits it. The card's keys also work while it has focus.
- Each menu key calls `agent_conversation.press` with the session and the
  menu's fingerprint. The service checks that the session is the one Chat
  showed, the pane still shows a menu by the rules above, the screen shows that exact
  menu and the key is one it names; then it reads the pane again (agent,
  session, terminal, title, revision and state sequence) and presses the key.
  It rereads for up to about half a second until the screen changes and
  returns the next menu, or none when it closed. Any difference refuses with
  nothing sent and returns the menu now shown. A new connection, runtime, pane
  or session retires the card and its notice. Answers and keys to one pane
  never interleave. The same gap as answers remains: Herdr cannot make the key
  conditional on the menu ([herdrdev/herdr#4764](https://github.com/herdrdev/herdr/issues/4764)).
  Claude Code's `/model` saves a digit or Enter as the default for new
  sessions, as its footer says; use `s` for this session only.
- The composer's **⋮** menu holds the Terminal's key controls, in the rows
  arranged in Settings, on desktop and phone. Each press calls
  `agent_conversation.press` without a menu fingerprint: the service checks
  the session and Herdr's key name (`ctrl+c`, `alt+up`, `shift+tab`, `esc`,
  `f5`, one character), then the pane again, and presses it. Page Up/Down
  scroll the Terminal and Herdr names no Home, End, Insert or Delete, so those
  buttons are disabled in Chat. The popover stays open to walk a menu.
- Keeps the last good conversation when a read fails, for example while the
  transcript is being written, and says that it could not refresh.
- In Town, Board and Desk, opens local source references in the same
  Inspector's **Files** view.
  Absolute paths, root-level filenames such as `README.md`, inline code paths
  (including spaces) and Markdown file links can include a
  line (`src/example.ts:12` or `src/example.ts#L12`); Markdown heading links
  such as `docs/guide.md#setup` open that section. Relative references start
  at the selected agent worktree. Files and Changes keep their shared binding
  to that host, runtime and worktree. A missing or stale binding, or a path
  outside the selected worktree, shows an unavailable notice with **Choose a
  worktree**. Choose the intended worktree and click the reference again;
  Chat never chooses another checkout or host for a link. HTTP and HTTPS
  links continue to open as web links. Automatic basename links use known
  source/document formats: inline code or a line number supplies the file hint;
  standard document names such as README.md also link in prose. A command such
  as `bun test web/src/example.test.ts` links its source path, and a list of
  source references keeps separate links and line targets, including comma- or
  semicolon-separated items and mixed paths/basenames. An executable-led command
  such as `./node_modules/.bin/tsc main.ts`, `./bin/dev main.ts` or
  `/opt/toolchain/bin/tsc main.ts` links its source argument separately. Executables
  directly inside `bin`, `sbin` or `.bin` are recognized at any installation
  prefix, as are virtualenv `Scripts` executables. Use an explicit Markdown link
  for a spaced filename directly inside one of these executable directories.
  For a root filename
  with spaces, use a path prefix such as `./my file.ts:12`. Dotted prose such
  as Node.js and code identifiers such as `process.env` stay text. Use an explicit
  Markdown file link for ambiguous filenames or unrecognized formats.
  Spaces retains ordinary Markdown link
  navigation: its Inspector does not yet have an agent-worktree binding and
  does not offer this worktree chooser.
- When the conversation is unavailable, Chat shows the reason and the action it
  names: the integration command to copy, the Codex session link, **Refresh**
  and **Open Terminal**. It offers no composer then.
- Chat uses the same full **Compose** component as the Terminal: the paperclip attaches
  files and typing **/** opens that harness's command palette. **⋮ → Browse
  commands** opens the same palette. The ⋮ menu follows the shared Back/Escape
  stack, closing before the underlying window. The placeholder names the same
  agent as the window bar. Enter starts a new line;
  the paper-plane **Send** button, `Ctrl+Enter` or `Cmd+Enter` sends.
  Direct mode, Insert draft and the terminal
  key bar stay out of Chat.
- Each bound conversation has its own draft, separate from Terminal drafts.
  Drafts remain usable when another host has focus; a replaced runtime cannot
  send or upload through the retired draft.
  **Add a file** (paperclip) or paste uploads to that pane's host with progress chips;
  completed paths enter at the saved caret, and **Send** waits for uploads.
  A completion after Chat closes updates only that conversation's draft.
  Failed sends restore the submitted text before any newer draft.
- While Herdr reports the agent working, an accepted send shows
  **Queued · sent to <agent>**, with its send time. Herdr owns admission and
  scheduling; World keeps no second queue. Without a transcript receipt it
  remains **Sent, not seen in the transcript** when checking ends. Blocked
  sends remain refused with their reason and keep the draft.
- While you read back, the existing floating **Jump to latest** shows **3 new**
  when three agent messages arrive. Your own messages, queued sends, tool
  activity and transcript notices do not count. Reaching the bottom clears it;
  opening another session starts fresh. Answer numbers remain scoped to the
  focused question card; no global answer keys or extra key bar are added.
- **Details** opens the earlier History view: Timeline, tool output, transcript
  preview and export.

## Files and Changes worktree

The agent window's Files and Changes use the same selected worktree. Open its
location line for **Worktree** candidates, source labels and **Refresh**.
Evidence is ordered live pane cwd, then that session's native transcript/Codex
rollout cwd or checkout report, then its branch in the known repository's
worktree list. A higher-ranked live directory keeps precedence; lower sources
and other listed trees remain explicit viewing choices, useful for `git -C`.
When Herdr reports a changed foreground cwd, the observation refreshes.
Choosing a viewing worktree changes Files and Changes together; it does not
change the agent's terminal directory.

To review a different branch, open **location line → Worktree**, choose its
branch-labelled candidate, then select **Changes → Against main**. **Working
tree** shows uncommitted edits; **Against main** shows committed branch changes
since the merge base. An old branch already merged into main can correctly show
no changes in both modes even while the agent works in another listed tree.

Ambiguous choices and stale evidence never silently use the launch checkout.
The service rechecks the subject, revision and root for both RPC and HTTP
resources; a new session cannot inherit the old selection. This changes the
Inspector's resource target, without changing Chat's bound session, draft or
prompt adapter. A viewed tree is never an ownership claim.

An unreadable transcript does not suppress a usable live or reported worktree.
When the selected binding changes, retained files reload through the new binding
and replies from the previous binding are discarded. If a retained preview
becomes unavailable, only that preview shows a recoverable notice; Chat and the
rest of the window stay open. Choose a current worktree or another file, or use
**Retry preview** after refreshing its worktree.

## Read model

Each connection owns one conversation source. Herdr is the first source; another
runtime, such as ACP, can implement the same interface
(`server/src/agent/conversation.ts`) without changing Chat or other consumers.
The Herdr source uses the agent and session Herdr reports for the pane, the
Codex thread named in the pane's title, or an unambiguous read-only daemon
inference, through the same session resolver and
projection cache as History ([History synchronization](HISTORY.md)).

Codex rollouts can be plain `.jsonl` or compressed `.jsonl.zst`. Chat and
History read both on local and SSH connections without changing Codex's files;
compression does not grant a stronger binding or enable Send for a guess.

| RPC | Parameters | Reply |
| --- | --- | --- |
| `agent_conversation.get` | `pane_id` | A conversation |
| `agent_conversation.latest` | `pane_id` and optional `menus`, or `pane_ids`, or nothing for every agent | A conversation without `messages`, or `{ conversations }`; with `menus: true`, a command menu (see above) is its `pending_prompt`, with `menu` |
| `agent_conversation.send` | `pane_id`, `text`, `session_fingerprint`, optional `baseline` (IDs of the user messages Chat showed) | `{ status: "sent", delivery }` or `{ status: "refused", reason, message }` |
| `agent_conversation.dismiss` | `pane_id`, `delivery_id` | `{ dismissed }`; forgets a delivery notice |
| `agent_conversation.answer` | `pane_id`, `key`, `prompt_fingerprint` | `{ status: "sent", number, label, acknowledged, unconfirmed_reason, prompt_fingerprint }` or `{ status: "refused", reason, message, pending_prompt }` |
| `agent_conversation.press` | `pane_id`, `key`, `session_fingerprint`, optional `menu_fingerprint` and `text` (a menu field's line) | `{ status: "sent", key, text?, menu }` (the menu after the key, or null) or `{ status: "refused", reason, message, menu }` |
| `agent_conversation.steps` | `pane_id`, `call_ids` (at most 500) | `{ steps }`: the step model for those tool calls, by the harness's call ID; calls it cannot find are left out |
| `agent_conversation.watch` / `.unwatch` | `pane_id` | `{ ok: true }`; see [Refresh](#refresh) |
| `agent_worktree.get` | qualified `subject` (connection, generation, pane/terminal, session), optional `refresh` | Worktree observation with revision/time, candidates and attributed evidence; selected candidate plus subject/revision is submitted with resource requests |
| `agent_quest.list` | `pane_ids`, or nothing for every agent | `{ quests }`: per pane, `agent`, `session_binding`, `session_fingerprint` and `quest`; see [Quests](#quests) |

A conversation carries `agent`, `agent_status`, `terminal_title`, `running_tool`
(the open tool call: its ID, name, summary and start), `pending_prompt` (the
question a blocked agent is waiting on, or null), `session_binding`,
`session_fingerprint`, `updated_at`, ordered `messages`, `latest` (the last
assistant message), `quest` (see [Quests](#quests)) and a `status` of `ok` or
`unavailable`. Each message has a
`role` (`user`, `assistant` or `tool`) and a `kind`:

- `message`: user or assistant text.
- `error`: an error the harness recorded.
- `activity`: one line for each run of tool calls between messages, such as
  "Used Read, Bash ×2", for consumers that want a summary instead of steps.
- `notice`: an event in the conversation, such as "Conversation compacted" or a
  Claude Code background task update.

**Steps.** `agent_conversation.steps` gives the step model for the tool calls
Chat names by the harness's call ID (the same ID other views such as Quests
link to). Each step has the tool, a label ("Read reconnect.ts", "Run
tests"), the command or file it names, its state (`running` with no result
yet, `ok`, `failed`, or `interrupted` when the agent moved on without a
result), start and end times, the end of its output (12 lines at most), the
lines an edit removed and added (40 at most between them, with `omitted`
counting the rest), and for a test run its pass and fail counts and first
failing test (bun, vitest, jest, pytest and cargo summaries). The label,
summary, output, failing test and diff all have credential-shaped values
redacted. Chat's list is History's: Chat asks only for the calls in
History's window, again for any not yet finished, and keeps only those. Each
tool row shows its step's label, time and a test run's pass or fail badge; a
run whose tests failed reads as failed, and a call cut off without a result
as interrupted until its result arrives. Opening the row shows the test
strip with its first failure or the edit's diff (a cut diff says how many
lines are left out and points to Changes), above the call's own arguments
and output. The History drawer shows the plain rows.

User messages are what the person wrote. The readers drop text the harness
injects as user turns: Codex repository instructions (`# AGENTS.md
instructions`) and environment blocks, and Claude Code local-command caveats.
They also drop subagent sidechains, and prompts the user rewound and edited
together with everything after them. Claude Code slash commands with arguments
read as `/name args`.

The window is History's: the latest 200 conversation entries. `latest` is meant
for summaries, such as a morning briefing of every agent's status and latest
message.

### Binding

`session_binding` says how the shown conversation is tied to the pane:

| Binding | Source | Chat can send |
| --- | --- | --- |
| `reported` | The harness's Herdr integration reported the session | Yes |
| `title` | The Codex pane title names the thread (Thread ID in `/title`) | Only once the title gives a complete thread ID: a full UUID, or a truncated one that matched exactly one saved transcript |
| `guessed` | World found the newest Grok Build, Antigravity or Muse session in the pane's folder | No; two agents in one folder would see the same guess |
| `guessed` (Codex) | One pane and one loaded daemon thread share an exact folder, recent activity and matching status; [full inference rules](HISTORY.md#chat-and-codex-session-binding) | No composer or answer keys; inference grants no input authority |

Codex title IDs take precedence over reports and guesses. A reported session
claimed by another pane (including its thread title) is discarded. Daemon
inference is recomputed for every snapshot and disappears on ambiguity or
changed evidence; it is never saved as a session link.

`session_fingerprint` identifies a reported session or a complete Codex thread
ID, and is null otherwise. Codex shows 29 characters of the thread ID in its
title, so a new thread with no saved transcript, or a title naming two threads,
is shown but cannot be sent to until the ID resolves; send its first message
from the Terminal. Chat does not send a thread's first message. Prefix
equality is never treated as the same thread.

For a truncated Codex title ID, a send first searches the transcripts afresh,
ignoring any remembered match, and accepts it only if exactly one transcript
matches. It then rereads the pane with `agent.get` and prompts with no other
await in between. If the bound session changed, or the title no longer names
the thread just found, nothing is sent.

### Delivery

Herdr's `agent.prompt` takes only a pane, text and wait options. Herdr ignores
any other field, including an expected session, revision or state sequence:
its request schema has no such field and does not reject unknown ones, at
0.9.3, 0.9.5 and on `master`, and a live 0.9.3 server delivered prompts that
carried them. So World cannot make the prompt conditional. A session switch
after Chat's last check and before Herdr handles the prompt still delivers the
text to the new session
([herdrdev/herdr#4764](https://github.com/herdrdev/herdr/issues/4764)).
World cannot prevent that; it detects it and says what it knows.

Each send leaves a receipt for the pane, bound to the session it was sent to:

| State | Meaning | Shown |
| --- | --- | --- |
| `pending` | Herdr took it, but it is not yet in the session's transcript (a busy harness writes a queued message only when the agent takes it up) | In that session's conversation at its send time, never below replies written since, as "Queued · sent to <agent>" for working-state admission, otherwise "Sent, not seen in the transcript", with its send time. After the pane moves on, as a line "Still checking <session>". Both have **Stop checking** |
| `matched` | The same words appeared in its own session clearly after the send; or, when none did, the first user turn written there after the send that its harness could have rewritten it into (a paste or image placeholder, or words around the typed ones) | That transcript message is marked with blue ticks, "Sent from Chat; matched by its words", or "Sent from Chat; matched by order". Both show order, not cause |
| `misdelivered` | Evidence of a switch after the send | A red notice naming both sessions; Send is paused until it is dismissed |
| `uncertain` | The same words appeared at about the time of the send, or both in its own session and first in the session the pane moved to | A notice saying Chat cannot tell, with **Dismiss** |
| `unverified` | Chat can no longer check | Its own session keeps a "Sent, not seen in the transcript" bubble; another session shows the reason. Both have **Dismiss** |

Command receipts carry `kind: "command"`; native working-state admission adds
`queued: true`. Commands use only literal own-transcript matching, never the
rewritten-message fallback or another session as misdelivery evidence. Without
that receipt they remain **sent, not checked**, even after a session switch.

Each receipt carries `sent_at` (this service's clock, for display) and
`transcript_at` (the same moment on the transcript host's clock, using the
measured SSH offset), by which Chat places a pending send among the turns.

Transcript times are sorted into three bands around the send: before it,
about the time of it (the clock's uncertainty plus one second, for
transcripts that round), and clearly after it.

Texts are compared with whitespace collapsed and without attachments: an
uploaded file's path as Chat sends it, and the `[Image #N]` and
`[Pasted text #N …]` placeholders Claude Code records, are removed. A message that is only
an attachment can match in its own session but is never evidence of a
switch to another one. Claude Code wraps multi-line and pasted input in
`pasted_content` tags; Chat compares and shows the words inside, marking the
turn **Pasted**. A send that no turn matches by its words, after every send
has had that chance, takes the first unclaimed user turn in its own session
written clearly after it that its harness could have rewritten it into: one
with a paste or image placeholder, or whose words contain the typed ones or
are contained in them. An unrelated prompt from another client or the
terminal never settles a send; the send stays pending until its turn appears.

- A receipt becomes `matched` when its own session's transcript has a user
  message with the same text that Chat did not show before the send
  and that is stamped clearly after it. That proves order, not cause: another
  client or person could have typed the same words, so Chat never calls it
  delivered and keeps checking the other sessions the pane showed until the
  check window ends. If the words then turn up first thing after the send in
  one of them, the receipt becomes `uncertain`. A message from before the
  send never matches, even if it is written late, and each transcript message
  matches one send.
- A copy stamped about the time of the send, in its own session or as the
  first message in a session the pane moved to, makes it `uncertain`: Chat
  cannot tell it from this message, so it never matches it or calls it a
  misdelivery.

A misdelivery needs evidence of a switch after the send:

- Herdr's prompt reply names another identified session. Herdr captures that
  snapshot when it queues the text, so it shows the pane had switched before
  the text was queued; Chat says Herdr had switched the pane, not that the
  text certainly arrived there. A reply that names no session, or a Codex
  title that does not resolve, proves nothing and leaves the receipt pending.
- Or the pane moved to another session, and the text is the first thing said
  there clearly after the send, within 10 seconds of it. Chat says the
  message appears to have gone there. The same words typed there later, or
  already there, are not evidence. Chat keeps checking every session the
  pane showed while the receipt was pending, so a switch through two
  sessions is still caught.

Without a submission ID from Herdr, identical words typed by hand within
those 10 seconds still cannot be told apart from Chat's message.

Times are compared on the transcript host's clock. For an SSH host the
service measures that clock's offset with `date` (nanoseconds where the host
prints them, else whole seconds) to within the round trip, when it sends, at
most every ten minutes. If the measurement fails, Chat refuses the send in
plain words rather than guess.

After the pane moves to another session, Chat keeps checking the receipt in
its own session's transcript, and watches that file on this machine. A
receipt becomes `unverified` when that transcript can no longer be read, or
15 minutes after the send. The service ends each check at that deadline
itself: it reads the pane once more, marks what is still pending
`unverified`, and tells browsers showing the pane to reread, so an idle pane
does not stay pending. A harness that records no timestamps always ends
there. Over SSH a transcript is read again on Herdr events, **Refresh** and
the deadline. Up to 20 receipts are kept per pane. A matched receipt whose
check window has ended makes room for a new one; otherwise Chat refuses to
send until you dismiss some, or until matched ones finish their check, rather
than drop one that is still being checked or a warning.

Over SSH, a send uses the user messages Chat showed (`baseline`) instead of
reading the transcript again; on this machine it rereads it and refuses with
the read's own reason if that fails.

### Unavailable reasons

| Reason | Meaning |
| --- | --- |
| `no_agent` | Herdr sees no agent in the pane. |
| `unsupported_harness` | Herdr detects the agent, but World has no transcript reader for it. |
| `unsupported_platform` | The connection is a Windows SSH host. |
| `remote_lookup` | The agent is on an SSH host and its reader or ID lookup is local-only: always for Grok Build and Antigravity, and for Kimi when Herdr reported an ID rather than a path. |
| `no_session` | Herdr has no session for the pane; the reply names the integration command. |
| `codex_unlinked` | Codex runs threads in a shared service, so Herdr cannot tell which thread the pane shows ([#250](https://github.com/IvoryHeart/herdr-world/issues/250)). Add Thread ID to Codex's `/title`, or link the session in the panel. |
| `ambiguous` | More than one Codex transcript matches the pane's title. |
| `file_missing` | The reported transcript cannot be found. |
| `read_failed` | The transcript exists but could not be read. Chat keeps the last good conversation. |

### Refresh

While Chat shows a pane, it asks the service to watch it
(`agent_conversation.watch`) and stops when hidden. The service rechecks a
watched pane on every Herdr event for that connection: status changes, session
reports and `pane.updated`, which Herdr sends when a pane's title changes, so a
Codex thread switch through the title is seen. For a transcript on this
machine, it also watches the file, so messages written during a long turn
appear without a status change. When the pane's session, title thread,
transcript size or time, status, or the task in the terminal title (not its
spinner glyph) changes, the service pushes `agent_conversation_changed` to the
watching browser. Chat then reads the conversation without its messages
(`agent_conversation.latest`, for status, binding, the running step, the
terminal title and delivery receipts) and History's window from its cursor
(`agent_history.get`), which brings only the entries that changed. A burst of
pushes runs at most one more read of each. Chat renders History's bubbles and
collapsed tool cards, which load their text only when opened, so a long, busy
transcript is never reread or redrawn whole. The window is kept per pane for
the page, so a Chat that remounts, docks or reopens shows its conversation at
once. Scrolling near the top of a full window, or **Load earlier messages**,
reads the 100 conversation entries before the oldest one shown
(`agent_history.get` with `before`) and keeps the message being read in place; entries
the window drops while older ones are shown stay on screen, until the reader
is back at the newest message, when the older pages are dropped. A transcript
too large for the service's projection cache is read again for each older
page, so it pages more slowly. Transcripts on an SSH host are rechecked on
Herdr events only.

Once a truncated Codex title ID has matched one transcript, rechecks on this
machine stat that transcript instead of searching again. That is safe only
because the service also watches the Codex session directories: whenever a
transcript is created or removed, it forgets every remembered match and
rechecks the watched panes, so a second transcript with the same prefix turns
the title ambiguous. If those directories cannot be watched, or the host is
remote, every recheck searches. Reads and sends always search.

## Quests

A quest is what an agent is working through, read from its own transcript by
fixed rules, without a model (`server/src/agent/quest.ts`). It is computed with
the projection, over the whole transcript rather than Chat's 200-entry window,
and each connection keeps up to 256 quests, so a quest whose transcript has not
changed is answered without reading it again. Chat places the current quest at
the start of its section inside the scrolling conversation. It starts as one slim **title · progress** row; expand its button
to read the objectives, without repeating the agent identity or status.
Town stands a pennant beside the agent's seat, which names
the quest on hover or tap; Board puts a chip on the agent's card.

A quest has a `title`, a `source` (`todo`, `plan`, `goal` or `loop`), the
harness `tool` it came from, a `status` (`active`, `done`, `blocked` or
`paused`), `steps` with a `status` each (`pending`, `active`, `done` or
`blocked`), `progress` (`done` of `total`), `started_at`, `updated_at`,
`set_by`, `iterations` for a loop and the number of `helpers` (subagents) the
agent spawned. A step's `step_ids` are the tool-call IDs the agent made while
that step was active, and `set_by` is the call that last set the quest. They
are the IDs Chat's step cards will be keyed by; the quest log does not link to
step cards yet.

| Harness | Checklist (`todo`) | Plan | Goal | Loop | Helpers |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `TodoWrite`; `TaskCreate` and `TaskUpdate` (the harness's task IDs; a pending task waiting on an unfinished one is `blocked`) | `ExitPlanMode` with the plan inline | None recorded | `ScheduleWakeup` (`/loop`), `CronCreate`; `stop` ends it, and so does a `ScheduleWakeup` whose wake-up arrived and whose turn ended (or was followed by another prompt) without scheduling another | `Agent`, `Task` |
| Codex | `update_plan` (its `explanation` titles the quest) | Plan-mode `Plan` item | `thread_goal_updated` (paused, blocked, usage- or budget-limited, complete) | None recorded | `spawn_agent` |
| Kimi Code | `SetTodoList` | None | None | None | None |
| Pi | No built-in tool; an extension tool named `todo_write` or `write_todos` that writes the whole list is read | None | None | None | None |
| Grok Build, Muse Code, Antigravity CLI | A tool with one of the names above is read; no native equivalent is known | None | None | None | None |

The current quest is the Codex goal when there is one, with the checklist's
steps once the checklist was updated after the goal began; a completed goal
gives way to a checklist, plan or loop updated after it. Otherwise it is the
most recently updated of the checklist, the plan and the loop (on equal times
the loop, then the plan). A checklist made after an approved plan, with no new
prompt between them, takes the plan's title; otherwise it takes the user's
last prompt before it (never a turn the harness wrote, such as an
interruption notice). A list starts a new quest when it shares no step with
the last list or the last list was finished; an empty list ends the quest.
Repeated step text stays separate steps. Claude Code tasks keep the IDs its
results report, and a deleted blocker no longer blocks; a quest is `blocked`
only when every unfinished step is. Subagent sidechains are left out of the
projection, so they never set the parent's quest. A quest from a session
World only guessed from the folder is not shown on desks or cards. When a
quest cannot be read for a moment (the transcript changed while it was read),
`agent_quest.list` marks it `read_failed` and names the pane's session
(`session_fingerprint`). Town and Board keep the last quest only while the pane
holds the same session: the World's session fingerprint for the pane is
unchanged and, when the reply names a session, it is the one the quest was read
from. A pane another session took over never shows the previous quest. When
reads overlap, only the latest one started is shown. A completed Codex goal
keeps no steps, so it never shows "Complete" beside an unfinished plan.
A hidden page reads again when it is shown.

Town and Board read quests when the World changes, at most once every 5
seconds, and every 15 seconds while an agent is working. One read asks about
the first 200 agents, one call per connection and runtime generation; the
service answers it from one `agent.list`, not an `agent.get` for each pane, so
a busy World does not queue Herdr calls ahead of terminal input. In a World
with more agents, later ones show no quest yet.

Known gaps: Claude Code builds that keep the plan in a file (the
`plan_mode_exit` attachment names `~/.claude/plans/…`) are not read, because
the service reads only the transcript; Claude Code records no goal; loop
iterations count wake-ups, not finished passes.

## Harness matrix

Herdr 0.9.3 detects 24 agent kinds. World has a transcript reader for seven.
"Checked on real transcripts" means the [conformance check](#conformance-check)
ran over real transcripts with no failure. It is evidence from one machine for
the versions listed, not a guarantee for other versions.

| Harness | Herdr kind | Reader | Checked on real transcripts |
| --- | --- | --- | --- |
| Codex | `codex` | Rollout JSONL, by the title's thread ID or a reported session | 0.147.0–0.163.0, 50 transcripts |
| Claude Code | `claude` | Project JSONL | 2.1.252–2.1.308, 41 transcripts |
| Pi | `pi` | Session JSONL | 8 transcripts (no version recorded) |
| Kimi Code | `kimi` | `wire.jsonl` | Not yet: synthetic fixture only |
| Grok Build | `grok` | `chat_history.jsonl` with `summary.json`; folder guess | Not yet: synthetic fixture only |
| Muse Code | `muse` | Session log; folder guess | Not yet: synthetic fixture only |
| Antigravity CLI | `agy` | SQLite trajectory; folder guess | Not yet: synthetic fixture only |
| Gemini, Cursor, Devin, Cline, OMP, Mastra Code, OpenCode, Copilot, Kiro, Droid, Amp, Hermes, Kilo, Qoder, Qwen, Letta, Maki | as named | None | Chat reports `unsupported_harness` and links to the Terminal. |

Every reader also has a synthetic fixture in its own format in
`server/src/agent/conversation-matrix.test.ts`. The fixtures cover messages,
tool activity, the latest message, a missing transcript, no reported session and
a guarded send, and for Codex and Claude Code the injected context, compaction,
rewind and sidechain records described above. No model runs in these tests.

Known gaps: Kimi, Grok Build, Muse and Antigravity have not been checked against
real transcripts; Codex 0.157 and later needs Thread ID in `/title` or a linked
session (#250); Grok Build and Antigravity are not read over SSH; Windows SSH
hosts are not supported.

## Conformance check

`bun scripts/chat-conformance.ts [--limit N] [--json]` runs every reader over
the newest transcripts (50 per harness by default) in the standard locations on
the machine it runs on, honouring the same environment overrides as World
(`CODEX_HOME`, `GROK_HOME`, `PI_CODING_AGENT_DIR` and others). It prints pass
counts per harness and harness version. It never prints transcript content,
paths or session IDs. A harness version is printed only when it is a canonical
numeric version (such as `0.163.0` or `1.2.0-rc.1`); any other value read from
a transcript, however short, is counted as `other`. Reader errors are counted
without their message. Run it after a harness upgrade; do not commit its
output or copy transcripts into the repository.

It also counts, per harness version, how many transcripts have a quest from
each source (todo, plan, goal or loop) or none, as counts only.

It writes no output files. The one disk exception is Antigravity: its reader,
here and in the service, reads a copy of each database from a private (0700)
temporary directory and removes it afterwards, so a process killed while
reading can leave `herdr-world-agy-*` with transcript content in the
temporary directory.

A transcript fails when it cannot be read or when text the user did not write
(injected instructions, environment blocks, caveats, compaction summaries,
task notifications) shows as a user message. These are reported as notes, not
failures:

- a session with no exchange (an interrupted turn or local commands only);
- a Codex subagent thread, which no person talks to;
- a message queued while the agent was writing, whose timestamp is earlier than
  the message before it.
