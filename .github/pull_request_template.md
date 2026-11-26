## Summary

- What changed and why:
- Parent PR or branch, if stacked:
- Documentation impact: <list relevant guides updated, or explain why existing instructions remain accurate; changelog alone is insufficient>
- Release notes: use a `fix:` or `feat:` PR title for user-facing changes; release-please owns the changelog.
- Help: <changed *.help.ts declaration, or none — explain why an added feature needs no help entry>
- Knowledge map impact: <updated, or unchanged — explain why navigation did not change>

Spec impact: <updated spec path or OpenSpec change name, or none — reason>
Verification impact: <updated model, adapter, coverage owner or named check path, or none — reason>

<!-- Required for non-documentation PRs, as plain lines without bold labels.
Good: Spec impact: none — Contributor tooling leaves product contracts unchanged.
Bad: Spec impact: none
Good: Verification impact: scripts/check-pr-body.test.ts — Policy input and diff regression cases.
Bad: Verification impact: none
Name changed paths (or a spec/change directory or name); claims about untouched
files fail. Changes under openspec/specs/ or openspec/changes/ forbid Spec impact:
none. Changes under quint/, verification/ or an inventory owner forbid Verification
impact: none. This is a cheap consistency check; reviewers assess the decision.
-->

## Verification

- Checks run and results (or why they were not run):
- Behavioral evidence: affected inventory IDs, model/replay or justified alternative, and executed boundaries; for mechanical changes, explain no contract impact.
- Remaining risk or review focus:

## Agent execution and usage

<!-- For a human-only PR, write N/A. For agent work, report measured values or "unknown"; do not estimate a bill from token counts. When using Codex session logs, sum per-response token_usage_record entries so compaction calls are included. -->

- Agent/model, reasoning effort and roles:
- Work pattern (investigation, implementation, checks/rechecks, review/repair, parallel agents):
- Measurement boundary and source (responses/compactions if available):
- Logged tokens: input **...** (cached **...**, uncached **...**); output **...** (reasoning **...**, included in output); total **...**.
- Elapsed time and major waits:
- Billed cost (actual billing data or unknown):
