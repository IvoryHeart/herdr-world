## 1. Prove the Herdr metadata seam

- [ ] 1.1 Inspect Herdr 0.9.0's `pane.get`, metadata report/clear, TTL and agent-session/source binding on a synthetic pane; record exact wire fields and a focused compatibility check. If replacement cannot invalidate old summaries, stop and revise this change before coding around it.
- [ ] 1.2 Trace the current executable dispatch and local/`--ssh-host` control-client paths in `server/src/index.ts`, `server/src/herdr/cli.ts` and `server/src/bridge/`; record one command path that exits before listener startup and verify it targets only the chosen runtime.

## 2. Implement the producer

- [ ] 2.1 Add a dedicated task-summary argument parser for report, `--clear`, `--pane`, `--session` and `--ttl-ms`; verify focused cases for defaults, missing pane, conflicting options, invalid TTL and a summary beginning with `-` after `--`.
- [ ] 2.2 Add normalization, 160-code-point truncation and credential-shaped-value replacement; verify synthetic Unicode, whitespace and secret-pattern cases without putting real credentials in fixtures or diagnostics.
- [ ] 2.3 Implement exact-pane lookup and session-bound report/clear through Herdr's supported metadata method; verify a missing pane, no agent session, replacement session and method rejection cannot write to another target.
- [ ] 2.4 Wire the command before World service startup, using the existing local or fixed-policy SSH control transport; verify help, exit codes, bounded output and that report/clear do not open an HTTP listener or browser WebSocket.

## 3. Reconcile observations and deliver

- [ ] 3.1 Confirm report, clear and TTL expiry invalidate the existing pane/World observation path; add only the missing event mapping if required and verify Office, Tree, Graph and Inspector receive current text without another poller.
- [ ] 3.2 Verify stale replies and agent-session replacement remove old text in `worldObject` and mounted view cases; retain absent metadata as absent and preserve unrelated terminal ownership.
- [ ] 3.3 Document local and SSH harness invocation, exact-pane targeting, lifetime and privacy limits in the relevant runbook/feature guide; add a user-facing Unreleased entry and verify examples use synthetic identifiers only.
- [ ] 3.4 Synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect the final diff/history for generated output and sensitive data, then open a ready PR with exact evidence for independent review.
