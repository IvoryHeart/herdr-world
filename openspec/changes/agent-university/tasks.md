# Tasks

## 1. Design (#1418, this step)

- [x] 1.1 Proposal, design, spec deltas and screens (`screens/`).
- [ ] 1.2 Review of the design and screens; record its decisions here.
- [ ] 1.3 The storage design (World as one object) takes in the profile fields,
  the diploma record and the per-launch host files (design § 5).

## 2. Build (after 1.2 and 1.3)

- [ ] 2.1 Verify, with an isolated harness (scratch configuration folders, named
  Herdr session, throwaway MCP stdio server): Claude `--mcp-config` with
  `--strict-mcp-config`, and a definition's `mcpServers` by name with `--agent`;
  Codex `-c mcp_servers.<name>.enabled`, `-c` for `skills.config`, and that
  `codex mcp list --json` starts no server. Record the results in design § 3.
- [ ] 2.2 Profile fields `mcp_servers`, `retired`, `version` in `parseProfile`
  and the store; retire, restore, copy, change college; storage catalog entry.
- [ ] 2.3 Per-harness skill discovery (`server/src/agent/skills.ts`) and an MCP
  catalog reader, data per harness beside `HARNESS_SPECS`; only the allowed
  fields leave the host.
- [ ] 2.4 `launchPlan` with the host catalog; Claude per-launch MCP file on the
  host and its cleanup; Codex overrides; the pre-launch check and refusal in
  `launcher.start`; the same on the herdr-core launch path.
- [ ] 2.5 Operator-only admission for profile writes that create a profile or
  change its harness, skills, MCP servers, tools or permission.
- [ ] 2.6 The diploma: record at a confirmed start; Given at hire on the
  character sheet (#775) and Inspector; Working now in the University.
- [ ] 2.7 University window (Profiles, Colleges, editor, college page, Retired
  shelf) in the place window frame; `openProfileEditor` opens it; Settings,
  Actions, launcher and Board entries; phone sheet.
- [ ] 2.8 Town: University lot, paint (three wing variants), sign, place key,
  Buildings ring entry; remove Profiles from the town center's ring; profile
  hires arrive from the gate.
- [ ] 2.9 CLI `herdr-world profile list|show|hire` (replaces `agent-profiles`
  task 3.1).
- [ ] 2.10 Docs: creation-profiles and town notes, tutorial step for hiring
  from the University, help entry and its picture.
