# world-adapters notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Harness detection, status, transcripts and runtime adapters.

**Code:**

- `server/src/adapters/registry.ts`
- `server/src/adapters/conformance.test.ts`
- `server/src/agent/`
- `server/src/herdr/`

**Pitfalls:**

- Unsupported or missing observations stay explicit rather than guessed.

## Usage reference

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
