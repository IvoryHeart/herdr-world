# Chat and the conversation read model

The Inspector's **Chat** tab shows an agent's conversation as messages and lets
you reply. Chat replaces the History tab. The **Terminal** tab remains a separate
view that you open on purpose.

## What Chat does

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
- Does not send commands: a slash command word such as `/compact` or
  `/review:fast`, or for Claude Code text that starts with `!` or `#`, is
  refused with a pointer to the Terminal, because a command can switch the
  session and is not recorded as something you said. A message that starts
  with a path, such as `/var/log/app.log fails`, is sent.
- Refreshes when the service says the conversation changed (see
  [Refresh](#refresh)). The browser has no timer. **Refresh** rereads on demand.
- Keeps the last good conversation when a read fails, for example while the
  transcript is being written, and says that it could not refresh.
- Keeps an unsent draft for each pane while World is open, so switching to the
  Terminal and back keeps it.
- In Town's windows (any element marked `data-skin="town"`), takes the Town
  prototype's look: a dark mono screen, what you said as dim "›" lines, tools
  as "●" lines, no bubbles, and a one-line composer with a gold Send. With a
  pointer, a message's time and Copy appear when you point at it; on touch
  they always show. The skin sets Chat's colour tokens, so it looks the same
  under the light and dark app themes.
- When the conversation is unavailable, Chat shows the reason and the action it
  names: the integration command to copy, the Codex session link, **Refresh**
  and **Open Terminal**. It offers no composer then.
- The paperclip (or a paste) attaches files. Each uploads to the pane's host
  with a progress chip, and its path joins the message; **Send** waits for
  uploads. A path that finishes after Chat closed joins the message when Chat
  opens again for that pane. Paths go after any text already typed; a message
  that starts with an uploaded path is not a slash command.
- **Details** opens the earlier History view: Timeline, tool output, transcript
  preview and export.

## Read model

Each connection owns one conversation source. Herdr is the first source; another
runtime, such as ACP, can implement the same interface
(`server/src/agent/conversation.ts`) without changing Chat or other consumers.
The Herdr source uses the agent and session Herdr reports for the pane, or the
Codex thread named in the pane's title, through the same session resolver and
projection cache as History ([History synchronization](HISTORY.md)).

| RPC | Parameters | Reply |
| --- | --- | --- |
| `agent_conversation.get` | `pane_id` | A conversation |
| `agent_conversation.latest` | `pane_id`, or `pane_ids`, or nothing for every agent | A conversation without `messages`, or `{ conversations }` |
| `agent_conversation.send` | `pane_id`, `text`, `session_fingerprint`, optional `baseline` (IDs of the user messages Chat showed) | `{ status: "sent", delivery }` or `{ status: "refused", reason, message }` |
| `agent_conversation.dismiss` | `pane_id`, `delivery_id` | `{ dismissed }`; forgets a delivery notice |
| `agent_conversation.watch` / `.unwatch` | `pane_id` | `{ ok: true }`; see [Refresh](#refresh) |

A conversation carries `agent`, `agent_status`, `session_binding`,
`session_fingerprint`, `updated_at`, ordered `messages`, `latest` (the last
assistant message) and a `status` of `ok` or `unavailable`. Each message has a
`role` (`user`, `assistant` or `tool`) and a `kind`:

- `message`: user or assistant text.
- `error`: an error the harness recorded.
- `activity`: one line for each run of tool calls between messages, such as
  "Used Read, Bash ×2", with per-tool counts and the number of failed results.
- `notice`: an event in the conversation, such as "Conversation compacted" or a
  Claude Code background task update.

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
| `pending` | Not yet seen in the session it was sent to | In that session's conversation as "Sent; not yet seen"; after the pane moves on, as a line "Still checking <session>". Both have **Stop checking** |
| `matched` | The same words appeared in its own session clearly after the send | That transcript message is marked "Sent from Chat; matched by its words" |
| `misdelivered` | Evidence of a switch after the send | A red notice naming both sessions; Send is paused until it is dismissed |
| `uncertain` | The same words appeared at about the time of the send, or both in its own session and first in the session the pane moved to | A notice saying Chat cannot tell, with **Dismiss** |
| `unverified` | Chat can no longer check | A notice saying why, with **Dismiss** |

Transcript times are sorted into three bands around the send: before it,
about the time of it (the clock's uncertainty plus one second, for
transcripts that round), and clearly after it.

- A receipt becomes `matched` when its own session's transcript has a user
  message with the same text (trimmed) that Chat did not show before the send
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
| `remote_lookup` | The agent is on an SSH host and World can only read its transcripts on this machine: always for Grok Build and Antigravity, and for Claude Code and Kimi when Herdr reported an ID rather than a path. |
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
transcript size or time, or status changes, the service pushes
`agent_conversation_changed` to the watching browser, which rereads. Transcripts
on an SSH host are rechecked on Herdr events only.

Once a truncated Codex title ID has matched one transcript, rechecks on this
machine stat that transcript instead of searching again. That is safe only
because the service also watches the Codex session directories: whenever a
transcript is created or removed, it forgets every remembered match and
rechecks the watched panes, so a second transcript with the same prefix turns
the title ambiguous. If those directories cannot be watched, or the host is
remote, every recheck searches. Reads and sends always search.

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
