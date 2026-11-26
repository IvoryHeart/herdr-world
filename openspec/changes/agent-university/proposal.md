## Delivery state

Design only (#1418, step 1). Nothing here is built yet, and no table, column or
data file changes. Building starts after the design and screens are approved
and the storage design (World as one object) has taken in the fields listed in
[design.md § Storage](design.md#5-storage-what-the-profile-record-needs).

## Why

Agent profiles have no home. They are edited in a dialog reached from the
town center's ring, Settings, Actions, the launcher and Board. A profile also
promises more than a launch gives: its skills reach Codex only as a sentence in
its instructions, a profile can name a skill that only another harness can see,
and there is no way to give an agent MCP servers at all. Nothing shows what a
running agent was actually given.

The request (2026-11-26): launch a University in Town, with a college per
harness where that harness's skills and MCP servers are attached to the agent.
Profiles are created and edited in the University, and an agent that is hired
comes fresh out of the University to work.

## What Changes

- **A University in Town.** A new civic landmark at the end of the civic row,
  right of the observatory. Its window is where profiles are created, edited,
  copied, retired, restored and deleted. The town center keeps New agent and
  the Town master; its ring loses Profiles and its Buildings ring gains the
  University.
- **One college per harness.** Every harness World supports today has a
  college: the eight it reads conversations from (Claude Code, Codex, Kimi
  Code, Grok, Pi, omp, Muse, Antigravity) and the others in its integration
  list, drawn as wings of the University. A college shows, per host: installed and logged
  in, the skills and MCP servers that harness can see there, and its models,
  efforts and permission modes. A wing whose harness is missing or logged out
  looks it, in Town and in the window.
- **Supported, planned or not built.** Each college's skills, MCP servers and
  registry have one state, from a sourced table of each harness's own launch
  options (design § 3). Supported means a per-launch option attaches exactly
  the set (or preloads it), checked in isolation before it ships; anything
  else is shown as planned or not built with its reason, never half-attached.
  In this change: Claude Code and Codex attach skills and MCP servers; Pi
  and omp attach skills; the rest are planned or not built. No
  college browses a registry (no marketplace).
- **A profile is a course of study:** its college (harness), role, brief, model,
  effort, permission, look, and the skills and MCP servers from that college.
- **Attached through the harness, not the prompt.** At hire, World checks the
  destination host has every attached skill and MCP server, then attaches them
  with the harness's own launch options (Claude Code: the subagent definition's
  `skills`, and `--mcp-config` with `--strict-mcp-config`; Codex: per-launch
  `-c` overrides of `mcp_servers.<name>.enabled` and `skills.config`; Pi
  `--no-skills --skill`; omp `--skills`). No skill is
  named in a prompt in place of attaching it. The user's harness configuration
  is never edited. A host that lacks one refuses the hire and says what is
  missing and where World looked.
- **One hiring path.** The University, the town center, Board, Actions, Spaces,
  and the CLI all hire through `launcher.start` with a profile. A profile hire
  walks out of the University's gate.
- **A diploma.** Every hired agent records what it was given: the profile and
  its version, harness options, skills and MCP servers, and how firmly each was
  attached. The agent keeps it while it runs, even after the profile changes.
- **Settings and the character sheet.** Settings → Agent profiles (#1063) and
  Actions → Agent profiles open the same University window. The agent character
  sheet (#775) shows the diploma.

## Capabilities

### Modified Capabilities

- `world-surfaces/creation-profiles`: profile lifecycle with retire and copy,
  colleges and their per-host catalogs, attaching skills and MCP servers at
  launch, refusal on a host that lacks one, the diploma, and who may attach.
- `world-surfaces/town`: the University landmark and its college wings, and
  profile hires arriving from the University.

## Impact

Design artifacts only: this change folder and its `screens/`. Step 2 touches
`shared/agentProfile.ts` (fields, `launchPlan`), `server/src/agent/skills.ts`
(per-harness discovery), a new MCP catalog reader beside it,
`server/src/agent/profile-launch.ts` and `server/src/rpc/launcher.ts` (the
pre-launch check and per-launch files), the herdr-core launch path,
`web/src/world/ProfileEditor.tsx` and a University window, Town lots, paint and
signs, and `server/src/storage/catalog.ts` once the storage design admits the
new fields. The `agent-profiles` change's open CLI task (3.1) is folded in here.
