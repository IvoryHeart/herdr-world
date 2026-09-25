## 1. Prove and define the agent checkout source

- [ ] 1.1 Complete `session-task-summaries` task 1.1 or independently prove Herdr 0.9.0 pane-token limits, atomic patch, no-TTL persistence, active `agent_session` read and update events on a synthetic pane. Record that presentation guards do not bind token patches and no conditional token delete by session fingerprint is available; if the tagged runtime differs, revise this change before implementation.
- [ ] 1.2 Trace `WorkspaceInspectorHost.tsx`, workspace Git status/diff/action root selection, `WorldObject` agent-session identity and connection lease routing. Record which existing UI can be reused without treating workspace checkout as agent checkout.
- [ ] 1.3 Define the fixed 15-key `agent-checkout` token layout from the design: version, SHA-256 fingerprint of the exact active agent-session identity, nine base64url path chunks (at most 540 decoded UTF-8 bytes) and four optional PR chunks (at most 240 decoded UTF-8 bytes). Omit TTL and any refresh timer. Verify report requires an active session, `--clear` is rejected before any Herdr request, and missing pane, invalid/overlong path or link, stale chunk suffix and full Herdr token capacity fail safely without logging real paths.

## 2. Publish and read exact context

- [ ] 2.1 Add the packaged report command before World listener startup, reusing the proven task-summary transport. Report all 15 tokens in one metadata call, nulling unused chunks, and fingerprint the current agent session. Reject `--clear` before metadata access. Verify no browser focus inference, another-host fallback, second World process or periodic renewal job.
- [ ] 2.2 Add a connection- and generation-routed read-only agent Git context request. Re-read the current pane/session and token set server-side, require the exact session fingerprint and complete versioned chunks, ignore browser-supplied checkout paths, validate the decoded absolute checkout as a Git root/worktree, and return bounded branch, worktree state, changed-file statuses/count and optional Reported PR provenance. Verify safe local/SSH process arguments and unavailable/error cases.
- [ ] 2.3 Add focused cases for two agents in the same workspace with different checkouts, equal pane IDs on two hosts, missing/malformed chunks, non-Git path, a shorter replacement report, a current session lasting beyond 24 hours without renewal, session replacement, pane closure, Herdr restart, runtime reconnect and a slow reply arriving after Inspector selection changes. In the sequence report A, report B, delayed `--clear` from A, assert Clear is rejected without a Herdr request and B's complete token set and Agent checkout remain intact.

## 3. Present distinct Changes scopes

- [ ] 3.1 In an agent Inspector, default Changes to Agent checkout when admitted, label its checkout/worktree, branch, file statuses/count and optional Reported PR, and provide an explicit Workspace changes switch. When unavailable, show the reason and separate workspace choice. Verify no workspace or terminal CWD appears as an inferred agent path.
- [ ] 3.2 Keep the Agent checkout list read-only: omit Git mutation controls and prevent underlying workspace handlers from acting on the agent root. Keep current workspace Changes and its existing confirmation/lease checks when that scope is explicitly selected.
- [ ] 3.3 Reset agent context on pane/session/generation/host change and guard delayed responses; verify two simultaneous Inspectors retain distinct resource state and one docked plus five floating contexts cannot exchange checkout data.

## 4. Accept and deliver

- [ ] 4.1 Exercise desktop/phone/keyboard/accessibility presentation using synthetic local and deterministic SSH runtimes, including absent context and visibly different workspace/agent roots; capture focused evidence without real paths or repository contents.
- [ ] 4.2 Document the one-shot harness command, session-owned/no-TTL lifetime, Herdr-restart loss, size/privacy limits and reported PR provenance; add an Unreleased entry, synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect final diff/history, then open a ready PR for independent review.
