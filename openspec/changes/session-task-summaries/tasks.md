## 1. Prove the Herdr metadata seam

- [x] 1.1 Inspect tagged Herdr 0.9.0 `pane.get`, `pane.report_metadata`, token value/key limits, two-token atomic report, TTL and `agent_session` fields on a synthetic pane. Record that token patches bypass `agent`/`applies_to_source` guards and no conditional token delete by session fingerprint is available. Prove a `task_summary_session` digest can be checked against the current session and that replacement or absent session hides old text; if not, stop and revise this change.
- [x] 1.2 Trace the current executable dispatch and local/`--ssh-host` control-client paths in `server/src/index.ts`, `server/src/herdr/cli.ts` and `server/src/bridge/`; record one command path that exits before listener startup and verify it targets only the chosen runtime.

## 2. Implement the producer

- [x] 2.1 Add a dedicated task-summary argument parser for report, `--pane`, `--session` and `--ttl-ms`; reject `--clear` with a usage error before any Herdr request. Verify focused cases for defaults, missing pane, invalid TTL and a summary beginning with `-` after `--`.
- [x] 2.2 Add normalization, 80-code-point truncation and credential-shaped-value replacement; verify synthetic Unicode, whitespace and secret-pattern cases without putting real credentials in fixtures or diagnostics.
- [x] 2.3 Implement exact-pane lookup and a two-token report (`task_summary` plus SHA-256 session fingerprint) with the same TTL. Verify a missing pane, no agent session, replacement session and method rejection cannot display old text or write to another target. In the sequence report A, report B, delayed `--clear` from A, assert the command rejects Clear without a metadata request and B's report remains intact.
- [x] 2.4 Wire the command before World service startup, using the existing local or fixed-policy SSH control transport; verify help, exit codes, bounded output and that reporting does not open an HTTP listener or browser WebSocket.

## 3. Reconcile observations and deliver

- [x] 3.1 Confirm report and TTL expiry invalidate the existing pane/World observation path; map the producer's Herdr tokens into `WorldObject` only after a digest match with the current agent session, adding only the missing event mapping if required. Verify Office, Tree, Graph and Inspector receive current text without another poller.
- [x] 3.2 Verify stale replies, a mismatched/absent session fingerprint and agent-session replacement remove old producer text in `worldObject` and mounted view cases; retain absent metadata as absent and preserve unrelated terminal ownership.
- [x] 3.3 Document local and SSH harness invocation, exact-pane targeting, lifetime and privacy limits in the relevant runbook/feature guide; add a user-facing Unreleased entry and verify examples use synthetic identifiers only.
- [x] 3.4 Synchronize the accepted delta into current `world-surfaces`, run focused checks and `bun run check`, inspect the final diff/history for generated output and sensitive data, then open a ready PR with exact evidence for independent review.
