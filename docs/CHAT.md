# Chat and the conversation read model

The Inspector's **Chat** tab shows an agent's conversation as messages and lets
you reply. Chat replaces the History tab. The **Terminal** tab remains a separate
view that you open on purpose.

## What Chat does

- Reads only the conversation read model described below. It never reads the
  terminal screen and never shows terminal output.
- Sends with Herdr's `agent prompt`, and only to the conversation it shows: if
  the pane now runs another session, nothing is sent and Chat says so. Herdr
  refuses a blocked agent; answer its question first.
- Refreshes when Herdr reports an agent status change, and when you open the
  tab. It does not poll. **Refresh** rereads on demand.
- When the conversation is unavailable, Chat shows the reason and an **Open
  Terminal** button. It offers no composer then.
- **Details** opens the earlier History view: Timeline, tool output, transcript
  preview and export.

## Read model

Each connection owns one conversation source. Herdr is the first source; another
runtime, such as ACP, can implement the same interface
(`server/src/agent/conversation.ts`) without changing Chat or other consumers.
The Herdr source uses the agent and session Herdr reports for the pane (or the
Codex thread named in the pane's title), through the same session resolver and
projection cache as History ([History synchronization](HISTORY.md)).

| RPC | Parameters | Reply |
| --- | --- | --- |
| `agent_conversation.get` | `pane_id` | A conversation |
| `agent_conversation.latest` | `pane_id`, or `pane_ids`, or nothing for every agent | A conversation without `messages`, or `{ conversations }` |
| `agent_conversation.send` | `pane_id`, `text`, `session_fingerprint` | `{ status: "sent" }` or `{ status: "refused", reason, message }` |

A conversation carries `agent`, `agent_status`, `session_fingerprint`,
`updated_at`, ordered `messages`, `latest` (the last assistant message) and a
`status` of `ok` or `unavailable`. Each message has a `role` (`user`,
`assistant` or `tool`) and a `kind`:

- `message`: user or assistant text.
- `error`: an error the harness recorded.
- `activity`: one line for each run of tool calls between messages, such as
  "Used Read, Bash ×2", with per-tool counts and the number of failed results.

The window is History's: the latest 200 conversation entries. `latest` is meant
for summaries, such as a morning briefing of every agent's status and latest
message.

### Unavailable reasons

| Reason | Meaning |
| --- | --- |
| `no_agent` | Herdr sees no agent in the pane. |
| `unsupported_harness` | Herdr detects the agent, but World has no transcript reader for it. |
| `unsupported_platform` | The connection is a Windows SSH host. |
| `remote_lookup` | A remote agent reported an ID rather than a path, and finding it would search this machine. |
| `no_session` | Herdr has no session for the pane; the reply names the integration command. |
| `codex_unlinked` | Codex runs threads in a shared service, so Herdr cannot tell which thread the pane shows ([#250](https://github.com/IvoryHeart/herdr-world/issues/250)). Add Thread ID to Codex's `/title`, or link the session. |
| `no_messages_yet` | The Codex title names a thread that has no saved messages yet. |
| `ambiguous` | More than one Codex transcript matches the pane's title. |
| `file_missing` | The reported transcript cannot be found. |
| `read_failed` | The transcript exists but could not be read. |

## Harness matrix

Herdr 0.9.3 detects 24 agent kinds. World reads conversations for seven of them.
Each supported harness has a synthetic transcript fixture in its own format in
`server/src/agent/conversation-matrix.test.ts`, covering messages, the latest
message, a missing transcript, a pane with no session and a guarded send. No
model runs in these tests.

| Harness | Herdr kind | Chat | Transcript |
| --- | --- | --- | --- |
| Codex | `codex` | Supported | Rollout JSONL, by reported session or the thread ID in the pane title |
| Claude Code | `claude` | Supported | Project JSONL |
| Kimi Code | `kimi` | Supported | `wire.jsonl` |
| Grok Build | `grok` | Supported | `chat_history.jsonl` with `summary.json`; local directory fallback |
| Pi | `pi` | Supported | Session JSONL |
| Muse Code | `muse` | Supported | Session log; local directory fallback |
| Antigravity CLI | `agy` | Supported | SQLite trajectory; local directory fallback |
| Gemini, Cursor, Devin, Cline, OMP, Mastra Code, OpenCode, Copilot, Kiro, Droid, Amp, Hermes, Kilo, Qoder, Qwen, Letta, Maki | as named | Not supported | World has no reader for these transcripts yet; Chat reports `unsupported_harness` and links to the Terminal. |

Codex 0.157 and later works only when its title includes Thread ID or the
session is linked, because of the upstream issue above. Windows SSH hosts are
not supported.

A live check used a throwaway `herdr --session` with a fake Claude process that
reports its session through `herdr pane report-agent-session` and writes an echo
reply for each prompt. It confirmed that Herdr 0.9.3 reports such a session by
ID, that `agent prompt` reaches the process, that a stale fingerprint sends
nothing, and that a shell pane reads as `no_agent`.
