# Optional Codex usage audit

For an ad hoc audit, run `bun run agent:usage -- --session <session-id> --from
<ISO-UTC> --until <ISO-UTC>` in the checkout. Repeat `--session` for contributing
agents, or omit it to use the current `CODEX_SESSION_ID` for a root agent. Pass
each subagent's rollout UUID explicitly: its environment may inherit the
parent's `CODEX_SESSION_ID` and misattribute usage. Omit a time bound only when
the whole session belongs to the task.

The script reads local Codex rollout files under `$CODEX_HOME/sessions` (or
`~/.codex/sessions`), sums per-response `token_usage_record` entries including
compaction, and prints only aggregate counts and the chosen boundary. Its
`--pr` value labels the report; it cannot infer which turns belong to a PR.
Record the explicit session/time boundary with any report. Cached input is
included in input, and reasoning is included in output. These counts are not
billed cost. The local Prometheus `codex_turn_token_usage` series aggregates by
model and token type without a session label, so it cannot substitute for a
PR-specific rollout count.

Add `--tooling` to report aggregate tool calls, recognized check commands and
output size for the same boundary. Command counts recognize executable
positions in literal shell commands, excluding comments, quoted data and
heredoc bodies; dynamic or opaque shell scripts may be missed. The report
never prints command text or tool output. A check executed inside the
pre-push hook does not appear as a literal agent command.

This audit is optional. Canonical usage and gate accounting belongs to the
durable workflow measurement follow-up, linked to task, session, PR and head.
