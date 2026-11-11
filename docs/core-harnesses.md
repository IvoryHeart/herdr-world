# Core harness support

World's core launcher offers 30 harness kinds. Any of them can be selected
in a saved profile; installation and authentication stay with the harness on the
core host. This inventory is data, not a core-version gate.

Sources inspected on 2026-11-11:

- Core's latest official release, **0.1.20**: [run handler](https://github.com/herdrdev/herdr-core/blob/v0.1.20/crates/herdr-core/src/api/run.rs),
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
Native status means exactly core's records: without OSC 7501 it is **unknown**.
World does not copy the TUI's screen-status inference or install status-writing
hooks for core. Seen and favourite use the existing shared labels. A stopped
program may return to a kept shell; its old Chat cannot send to that replacement.

| Harness kind | Executable | Core profile / status / delivery | Chat transcript |
| --- | --- | --- | --- |
| amp | amp | Yes / native / native | No TUI reader; native input remains available |
| antigravity-cli | agy | Yes / native / native | Local ID/path/directory |
| claude | claude | Yes / native / native | ID/path; resume arguments |
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
| pi | pi | Yes / native / native | ID/path; directory discovery |
| pig | pig | Yes / native / native | No TUI reader; native input remains available |
| prime-agent | prime-agent | Yes / native / native | No TUI reader; native input remains available |
| qodercli | qodercli (Windows aliases also accepted) | Yes / native / native | No TUI reader; native input remains available |
| qwen | qwen | Yes / native / native | No TUI reader; native input remains available |

Transcript reading uses the same resolver and format projections as TUI Chat;
it never derives status or permission to send. A native resume/session argument
can identify a transcript. Codex can use a title containing its Thread ID.
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
core's foreground observation, then uses the ordinary fenced native send. If
startup cannot be verified, the agent stays running and World explains that the
brief was not sent. Lost delivery replies remain uncertain, never replayed.
Claude/Codex retain their existing launch-argument first prompt.

## Browser captures

Synthetic core Chat, with readable conversation and an uncertain native send.
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

- `server/src/herdr-core/history.test.ts` runs all eight shared native transcript
  fixtures and compares their entries with the TUI projection. It also covers
  remote lookup refusal, disconnect, missing foreground, title change and kept
  replacement during a read.
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
  harness stand-ins also need a C compiler. Real Windows validation remains
  the owner's host check.
- For a credential-free preview, open `?coreFixture`, choose **Start fixture**,
  then open **reviewer → Chat** in Town. Its synthetic transcript and blocked
  question are readable; **Answer** and keys still use native core delivery.
  Use **Kill fixture** to see stale refusal, and remove the fixture afterward.
  The URL switch removes itself immediately. It starts no vendor harnesses.

A separate cumulative stress experiment reused one scratch core for repeated
start/kill cycles and timed out on its twentieth launch (World correctly reported
uncertain); the same harness passed alone. This is not a vendor-harness failure
or evidence of a supported concurrency limit. The maintained per-harness smoke
uses isolated cores. The cumulative failure needs a separate core investigation.

The TUI launcher and its conversation bindings remain independent. Its screen
readers and integrations are retained for TUI agents; core never calls them to
infer or write status. There was no existing core status writer to delete.
