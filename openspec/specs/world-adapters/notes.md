# world-adapters notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Harness detection, status, transcripts and runtime adapters.

**Code:**

- `server/src/world/agent-commands.ts`
- `server/src/world/agent-commands.test.ts`
- `server/src/cli/world-agents.ts`
- `server/src/cli/world-agents.test.ts`
- `server/src/world/world-cli-service.ts`
- `server/src/service/world-service.ts`
- `server/src/service/agent-commands.ts`
- `server/src/herdr-core/host-runtime.ts`
- `server/src/herdr-core/agent-cli.test.ts`
- `server/src/adapters/runtime-ports.ts`
- `server/src/adapters/herdr.ts`
- `server/src/adapters/registry.ts`
- `server/src/adapters/conformance.test.ts`
- `server/src/agent/`
- `server/src/herdr/`

**Pitfalls:**

- Unsupported or missing observations stay explicit rather than guessed.

## Usage reference

### Runtime-neutral agent reads

With the local World service running, `herdr-world runtime ls [--json]` lists
connections per host with runtime kind, version (unknown when unavailable), state,
actionability, supported agent verbs and a native manual pointer. These commands
reach local and SSH runtimes through World without requiring their native CLI.

`herdr-world agent ls [--connection ID] [--json]` returns current agents and status.
Use its percent-encoded `CONNECTION/ADDRESS` target with
`herdr-world agent read TARGET [--lines N] [--json]`. Any verified local agent can
read another connection's screen. Reads print plain text even when piped;
`--lines` keeps the last 1–10000 screen lines without scrolling the native terminal.
A bare address is accepted only when unique across actionable connections.
Ambiguity names the qualified candidates. Unknown targets, non-actionable connections
and unsupported runtime verbs have explicit reasons; refresh the listing after a
reconnect. World never substitutes another connection or a retired reply.
Group `agent://` names retain their separate group-target meaning.

The [active contract](../../changes/world-agent-cli/specs/world-agent-cli/spec.md)
also plans send, wait and start; those write commands are not delivered here.

### Session task summaries

Agent harnesses can use `herdr-world task-summary` to publish a short, expiring,
session-qualified description of current work for an exact local or fixed-policy SSH
Herdr pane. The Inspector shows it only while the current
agent session matches the report. Herdr owns expiry; the command does not infer work,
assign tasks, or provide a Clear operation.

## Latest upstream additions

- Read local Oh My Pi transcripts, Pi directory-inferred history in read-only mode,
  Claude continuation transcripts and queued-message state. SSH transcript reads
  reuse cached bytes and fetch appended text while keeping World's history bounds.

- Ranger workspace/agent mentions, quick model and thinking controls, task-management
  previews, guarded close actions, and clearer settings/chat history.
- Windows Herdr 0.9.1+ hosts over SSH from Linux/macOS World, with native terminal
  and workspace actions. Unix-only remote file and Git tools remain unavailable.
- Optional private-network PIN login with independent session signing and recovery.
