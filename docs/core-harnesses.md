# Core harness support

World's core launcher offers 30 harness kinds. Any of them can be selected
in a saved profile; installation and authentication stay with the harness on the
core host. See the [runtime support table](../openspec/specs/herdr-core-runtime/notes.md#runtime-support) for versions
and platform limits. This inventory is not a core-version gate.

Sources inspected on 2026-11-11:

- Core release **0.1.20**, the latest on 2026-11-11 (0.1.21 since): [run handler](https://github.com/herdrdev/herdr-core/blob/v0.1.20/crates/herdr-core/src/api/run.rs),
  [status records](https://github.com/herdrdev/herdr-core/blob/v0.1.20/crates/herdr-core/src/status.rs),
  [OpenRPC](https://github.com/herdrdev/herdr-core/blob/v0.1.20/schema/hc.openrpc.json), [compatibility tests](https://github.com/herdrdev/herdr-core/blob/v0.1.20/crates/herdr-core/tests/compat.rs).
  Core ships **no finite harness list**: it runs arbitrary programs. First-message
  templates are explicit core templates; World launches absolute executables.
- Herdr: [integration commands](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/registry.rs) and
  [detection manifest](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/distribution/agent-detection/index.toml).
  Letta is the existing experimental World/TUI integration entry.
- Reference desktop app: [agent programs](https://github.com/herdrdev/herdr-app/blob/6a0cbc041979b16756d3d0456c571afb6aff2e34/defaults/programs.json)
  (agent entries through Ollama; editors, shells and generic Agent are not harnesses),
  and [shared status/seen rules](https://github.com/herdrdev/herdr-app/blob/6a0cbc041979b16756d3d0456c571afb6aff2e34/docs/labels.md).
- World: [integration names](../server/src/cli/harness-names.ts),
  [profile compiler](../shared/agentProfile.ts) and
  [eight existing transcript readers](../server/src/agent/chat-harnesses.ts).

Every row has a **launch profile**, **native status** and **native send/answers/keys**.
Native status means core's records checked against the process: without OSC
7501 an interactive agent is **unknown**. Two process facts adjust a report
(`coreDeskStatus`): a live headless invocation (`claude -p`, `codex exec`,
`opencode run` …) is working, and a known harness's working or waiting report
is stale, read idle, once no harness runs in the terminal's foreground. A
report speaks only for the harness running: one naming another harness, or
left by a process World saw exit (`CoreDeskMemory`), is no report for its
replacement. A harness seen inside a wrapper that stays in front remains the
desk's agent, idle, after it exits, until another leader takes the terminal. Core
0.1.21 reports only the foreground group's leader, so for a core on this Linux
machine World also reads the group's other processes on the host
(`process-group.ts`), as Herdr's TUI looks through a whole job. Upstream ask:
core should report the foreground group's processes, so remote and macOS cores
see agents run by wrappers too.
This applies to Codex on Linux too: a missing core/harness report cannot be
repaired by mapping it to idle. An isolated Linux core 0.1.21 / Codex 0.167.0
launch publishes native idle/working through World's provider; the previously
reported Linux-only absence was not reproduced with those versions.
World does not copy the TUI's screen-status inference or install status-writing
hooks for core. Seen and the pin use the existing shared labels. A stopped
program may return to a kept shell; its old Chat cannot send to that replacement.

On Unix, New agent resolves the executable and launches it through the account's
interactive `$SHELL` (`/bin/sh` when unset), using login mode on macOS as core's
plain terminals do. Supported shells are sh, bash, zsh, dash, ksh, mksh and fish;
they pass the executable, profile arguments and first prompt as separate arguments.
Shell startup supplies PATH
and version-manager tools to the agent; World never collects or copies the
environment. Absolute executables still bypass core templates. Windows keeps
native launching. Other account shells, including csh, tcsh, nu, xonsh and elvish,
keep direct discovery and launch with the inherited environment; their startup
files do not supply additional tools. Startup files that replace the shell with
another shell or tmux can prevent launch or time out the catalog probe. No change
to the user's shell configuration is required.

New agent identifies this path with **Starts in herdr-core**; a room named
"core" on a Herdr TUI connection still uses the TUI launcher. Core launches
receive an argv, including long Claude status-line settings and multiline
profile arguments, rather than a command typed into a shell. The account shell
receives those arguments as positional parameters, without interpolating them
into its command string.

| Harness kind | Executable | Core profile / status / delivery | Chat transcript |
| --- | --- | --- | --- |
| amp | amp | Yes / native / native | No TUI reader; native input remains available |
| antigravity-cli | agy | Yes / native / native | Local ID/path/directory |
| claude | claude | Yes / native / native | ID/path; own process record; World launch ID or resume arguments |
| cline | cline | Yes / native / native | No TUI reader; native input remains available |
| codex | codex | Yes / native / native | ID/path; title or resume arguments |
| command-code | command-code | Yes / native / native | No TUI reader; native input remains available |
| copilot | copilot | Yes / native / native | No TUI reader; native input remains available |
| crush | crush | Yes / native / native | No TUI reader; native input remains available |
| cursor | cursor-agent | Yes / native / native | No TUI reader; native input remains available |
| devin | devin | Yes / native / native | No TUI reader; native input remains available |
| droid | droid | Yes / native / native | No TUI reader; native input remains available |
| dsh-tui | dsh-tui | Yes / native / native | No TUI reader; native input remains available |
| gemini | gemini | Yes / native / native | No TUI reader; native input remains available |
| grok | grok | Yes / native / native | Local ID/path/directory |
| hermes | hermes | Yes / native / native | No TUI reader; native input remains available |
| kilo | kilo (or kilo-code) | Yes / native / native | No TUI reader; native input remains available |
| kimi | kimi | Yes / native / native | ID/path |
| kiro | kiro-cli | Yes / native / native | No TUI reader; native input remains available |
| letta | letta | Yes / native / native | No TUI reader; native input remains available |
| maki | maki | Yes / native / native | No TUI reader; native input remains available |
| mastracode | mastracode | Yes / native / native | No TUI reader; native input remains available |
| muse | muse | Yes / native / native | ID/path; directory discovery |
| ollama | ollama | Yes / native / native | No TUI reader; native input remains available |
| omp | omp | Yes / native / native | ID/path |
| opencode | opencode | Yes / native / native | No TUI reader; native input remains available |
| pi | pi | Yes / native / native | ID/path; World launch ID or session arguments; directory discovery |
| pig | pig | Yes / native / native | No TUI reader; native input remains available |
| prime-agent | prime-agent | Yes / native / native | No TUI reader; native input remains available |
| qodercli | qodercli (Windows aliases also accepted) | Yes / native / native | No TUI reader; native input remains available |
| qwen | qwen | Yes / native / native | No TUI reader; native input remains available |

Transcript reading uses the same resolver and format projections as TUI Chat;
it never derives status or permission to send. A native resume/session argument
can identify a transcript. Codex can use a title containing its Thread ID.
World starts Claude and Pi with a new `--session-id` unless the profile's
arguments already choose a session. Claude's native process record names the
conversation it currently runs (including headless runs in newer releases); World reads that record on the
agent's host only for the foreground process with the same start time, so a
reused process ID never names another agent's conversation. For fresh `codex exec`
and Claude runs without a record or session flag, World can inspect the foreground
process's writable regular files: a unique Codex rollout, Claude transcript, or
canonical Claude session debug file. Linux uses `/proc/<pid>/fd`; macOS uses
`lsof`. Reads are bounded to 512 descriptors, 256 KiB and three seconds, with
the process start time checked before and after. Missing permissions, missing
`lsof`, process exit/replacement, deleted files and multiple candidate sessions
provide no identity. No newest-file guess is used for Claude/Codex; ephemeral
runs without a saved transcript remain unreadable. A caller-chosen `--debug-file`
name never establishes Claude's session ID. Kimi, OMP, Muse, Grok and
Antigravity keep the paths below.
Pi, Muse, Grok and Antigravity retain their directory discovery, visibly described
as a possible guess. Otherwise use **Link a conversation for reading** and enter
a session ID or an absolute transcript path on that host. Links last only while
that Chat stays open. Opening a new agent starts with a new reading choice.

On Unix SSH hosts, Claude/Codex/Pi support host-side ID lookup; Kimi/OMP/Muse
need a reported or linked path. Grok and Antigravity readers are local-only.
Windows transcript reading is unavailable, matching the TUI path; core launch,
status and native input remain supported through the PowerShell relay.

**Refresh conversation** reads the latest 200 entries; a status or turn change
refreshes too. This is transcript history, separate from **Read question screen**.
The response is bounded to 16,000 characters per entry and 256,000 in total,
with shortening disclosed. A disconnect, replacement, foreground or title change
during the read discards the result. Linking history never changes the recipient
captured when Chat opened. Core's queued-send replacement window remains Q3.

For generic harnesses, profile role/brief delivery waits up to ten seconds for
core's foreground observation, then uses the ordinary fenced native send with
`if: "idle"`. Core checks that condition after startup/draft/quiet waits and
before pasting: unknown, blocked and every other non-idle status type nothing.
Foreground alone does not prove a folder-trust dialog is clear. If startup
cannot be verified or core refuses readiness, the agent stays running and World
says to open Chat to send the brief after reviewing the terminal. Lost delivery
replies retain the started agent's identity and remain uncertain, never replayed.
Claude/Codex retain their existing launch-argument first prompt.

## Browser captures (historical)

These captures show the superseded standalone core Chat. A core agent now opens
the same Chat as a Herdr agent (#920), so they record the earlier screen, not
the current one. Synthetic core Chat, with readable conversation and an
uncertain native send.
The [light receipts](images/core-chat-harnesses/uncertain-light.json) and
[dark receipts](images/core-chat-harnesses/uncertain-dark.json) retain revision,
dimensions and sanity checks for all five standard viewports.

| Viewport | Light | Dark |
| --- | --- | --- |
| Phone | [390×844](images/core-chat-harnesses/uncertain-light-phone.png) | [390×844](images/core-chat-harnesses/uncertain-dark-phone.png) |
| Mac laptop | [1512×982](images/core-chat-harnesses/uncertain-light-mac-laptop.png) | [1512×982](images/core-chat-harnesses/uncertain-dark-mac-laptop.png) |
| Linux half | [1280×1440](images/core-chat-harnesses/uncertain-light-linux-half.png) | [1280×1440](images/core-chat-harnesses/uncertain-dark-linux-half.png) |
| Linux wide | [2560×1440](images/core-chat-harnesses/uncertain-light-linux-wide.png) | [2560×1440](images/core-chat-harnesses/uncertain-dark-linux-wide.png) |
| Portrait | [1440×2560](images/core-chat-harnesses/uncertain-light-portrait.png) | [1440×2560](images/core-chat-harnesses/uncertain-dark-portrait.png) |

## Repeatable evidence and preview

- `launch-brief.test.ts` covers unknown/blocked/working/error startup status and
  loss of idle while queued. `delivery.live.test.ts` checks a silent supported
  executable receives no bytes and checks native blocked/working/idle reports.
  `testing/recorded/delivery-0.1.20.json` retains the real conditional-send
  refusals; `delivery-replay.test.ts` replays them with one-byte reads too.
- `server/src/herdr-core/agent-sessions.test.ts` reads the shared native
  transcript fixtures through core's Chat and compares their entries with the
  TUI's. It also covers sends and keys through core, conversation lookup on a
  remote host, linked sessions, and a killed or kept replacement (even one that
  reuses the pid) never showing the old conversation.
- `server/src/herdr-core/delivery.test.ts` exercises every inventory name through
  native send/keys; `delivery-replay.test.ts` replays release-captured bytes at
  one-byte, seven-byte and whole-frame boundaries. The inherited replay/watch
  tests cover EOF, kill/restart, split UTF-8, exhausted credit and missed overflow.
- `harnesses.live.test.ts` launches each inventory name on an isolated real core
  with a credential-free native OSC 7501 stand-in. It checks blocked/done, native
  records, app placement and message/answer delivery, and reports elapsed time.
  This checks World/core traffic; it does not certify vendor harnesses, their
  credentials or their ability to emit status. Actual vendor sessions use
  deterministic transcript fixtures because CI has neither binaries nor accounts.
- `bun scripts/herdr-core-smoke.ts` downloads and verifies the newest official
  release, runs core/launch/delivery/harness-name smoke, installs nothing and
  leaves no processes. Live tests skip without `HERDR_CORE_BIN`; the native
  harness stand-ins also need a C compiler. Real Windows validation requires hardware checks; this smoke does not provide them.
- For a credential-free preview, open `?coreFixture`, choose **Start fixture**,
  then open **reviewer → Chat** in Town. Its synthetic transcript and blocked
  question are readable; **Answer** and keys still use native core delivery.
  Use **Kill fixture** to see stale refusal, and remove the fixture afterward.
  The URL switch removes itself immediately. It starts no vendor harnesses.

The per-harness smoke uses isolated cores; it does not establish a supported
concurrency limit or certify vendor harness behavior.

The TUI launcher and its conversation bindings remain independent. Its screen
readers and integrations are retained for TUI agents; core never calls them to
infer or write status. There was no existing core status writer to delete.
