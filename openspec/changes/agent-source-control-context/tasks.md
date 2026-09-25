## 1. Prove and define the agent checkout source

- [ ] 1.1 Complete `session-task-summaries` task 1.1 or independently prove Herdr 0.9.0 source/session/TTL metadata semantics on a synthetic pane. Record exact report, clear, event and session-replacement behavior. If unsupported, stop and revise this proposal before implementation.
- [ ] 1.2 Trace `WorkspaceInspectorHost.tsx`, workspace Git status/diff/action root selection, `WorldObject` agent-session identity and connection lease routing. Record which existing UI can be reused without treating workspace checkout as agent checkout.
- [ ] 1.3 Define the bounded `agent-checkout` report/clear fields: explicit pane, absolute checkout path, optional HTTPS PR URL, Herdr session/SSH selection, TTL and source name. Verify missing pane/session, invalid path/link, oversized input and conflicting options fail before metadata write; do not log real paths.

## 2. Publish and read exact context

- [ ] 2.1 Add the packaged report/clear command before World listener startup, reusing the proven task-summary transport and source/session binding. Verify no browser focus inference, another-host fallback or second World process.
- [ ] 2.2 Add a connection- and generation-routed read-only agent Git context request. Re-read current pane/session metadata server-side, ignore browser-supplied checkout paths, validate the reported absolute checkout as a Git root/worktree, and return bounded branch, worktree state, changed-file statuses/count and optional Reported PR provenance. Verify safe local and SSH process arguments and unavailable/error cases.
- [ ] 2.3 Add focused cases for two agents in the same workspace with different checkouts, equal pane IDs on two hosts, missing metadata, non-Git path, report clear/TTL, session replacement, runtime reconnect and a slow reply arriving after Inspector selection changes.

## 3. Present distinct Changes scopes

- [ ] 3.1 In an agent Inspector, default Changes to Agent checkout when admitted, label its checkout/worktree, branch, file statuses/count and optional Reported PR, and provide an explicit Workspace changes switch. When unavailable, show the reason and separate workspace choice. Verify no workspace or terminal CWD appears as an inferred agent path.
- [ ] 3.2 Keep the Agent checkout list read-only: omit Git mutation controls and prevent underlying workspace handlers from acting on the agent root. Keep current workspace Changes and its existing confirmation/lease checks when that scope is explicitly selected.
- [ ] 3.3 Reset agent context on pane/session/generation/host change and guard delayed responses; verify two simultaneous Inspectors retain distinct resource state and one docked plus five floating contexts cannot exchange checkout data.

## 4. Accept and deliver

- [ ] 4.1 Exercise desktop/phone/keyboard/accessibility presentation using synthetic local and deterministic SSH runtimes, including absent context and visibly different workspace/agent roots; capture focused evidence without real paths or repository contents.
- [ ] 4.2 Document the harness command, privacy/TTL behavior and reported PR provenance, add an Unreleased entry, synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect final diff/history, then open a ready PR for independent review.
