# Creation Profiles notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Actions New workspace/tab/agent, Town room +, Board New tab/note launcher and Spaces reach creation.
- Shared tab-strip, mobile creation and Inspector shortcuts use the same preparation/completion path.
- Settings, Actions, launcher and Board reach profile editing and harness readiness/login guidance.
- TUI uses bounded native starts and first-prompt delivery; core uses its own launch admission.

**Code:**

- `shared/agentProfile.ts`
- `server/src/usage/claude-launch-settings.ts`
- `server/src/usage/claude-launch-settings.test.ts`
- `web/src/creationRequests.ts`
- `web/src/world/agentProfiles.ts`
- `web/src/world/ProfileEditor.tsx`
- `server/src/rpc/launcher.ts`
- `server/src/agent/profile-launch.ts`
- `server/src/rpc/launcher-probe.ts`

**Tests:**

- `web/src/world/SharedViewCreation.test.ts`
- `web/src/worldCreation.test.ts`
- `shared/agentProfile.test.ts`
- `server/src/rpc/launcher-tap.test.ts`
- `server/src/rpc/launcher-probe.test.ts`

**Pitfalls:**

- A method advertisement is not this browser's prepared source attachment.
- Global creation confirms one host; All hosts never means broadcast.
- A lost reply may mean creation happened; do not automatically relaunch.
- Readiness/login commands are host-specific; World shows login text rather than typing it.
- Profile definitions are World-owned, but current assignments are Herdr-owned; see appearance.
- No profile-management CLI is specified here; CLI integration commands manage skills.

## Usage reference

- **New agent and agent profiles.** **New agent** starts an agent in a new
  tab of a room you choose, from a profile (one tap) or from any agent kind the
  host's Herdr supports. It is in the Actions menu of Town and Board, on Board's hub (**+**
  beside the bin), on each
  Town room's dashed **+** seat (zoom into the room first), beside **+** in
  Spaces' tab bar,
  and in Board's New tab dialog. The room seat preselects its room; the
  launcher's first choice, **Terminal**, creates a plain shell tab. World
  creates an agent's tab, starts the harness
  through Herdr, waits until it is ready, then sends the first prompt; if the
  harness stops on a question (such as Claude's folder trust) or exits at
  once, it says so and offers to open the tab. While a start is in flight, the
  pressed choice stays marked busy and a **Starting …** line says what World is
  doing; after 10 seconds of real waiting it reads **Taking longer than
  usual** (there is no progress bar or countdown, and the icon stays still
  with reduced motion). Progress and outcomes stay in view above the choices.
  When World confirms the start, Town plays the new agent's **arrival**: it
  steps out at the town center (when started from the town center's **New
  agent**) or at the bus stop nearest its room (started anywhere else), walks
  the streets to its building's front door, goes in to its desk and sits
  down, and a sparkle and its name fade over it. The walk outdoors takes at
  most 3 seconds and the walk in at most 2.5; several starts at once arrive
  0.7 seconds apart. Agents already in Town, a reload, a failed or uncertain
  start and returning to Town never play it. With reduced motion the agent is
  at its desk at once with a still highlight that fades. A confirmed start closes the launcher and opens
  the new agent's or terminal's window once World shows it, on Herdr TUI and herdr-core hosts alike, even when Hosts hides that host; an uncertain
  attempt keeps its explanation and disables start choices. Open its existing
  tab or close the launcher before another attempt. A definite failure lets
  you retry, log in or edit profiles.
  - The launcher shows whether each harness is installed and logged in on the
    host, asked with the harness's own status command (`claude auth status`,
    `codex login status`; Pi reports only whether it is installed). **Log in**
    opens a small tab and shows the harness's own login command to copy and
    run there. World never types into it, and never sees or stores
    credentials. Failed or unreadable probes remain unknown, with the safe
    check source/time, **Check again** and existing **Edit profiles** controls;
    only confirmed absence blocks a supported harness. Windows probes remain
    unsupported. See [readiness evidence](../../../../docs/harness-readiness.md).
  - **Agent profiles** (Settings → Agent profiles, Actions → Agent profiles, or
    Edit profiles in the launcher and Board) set a name, home room, role,
    colour, brain (harness, model, Codex reasoning effort, permission mode),
    skills (the room's and host's `SKILL.md` folders), tools, a starting brief
    with `{{name}}`, `{{task}}`, `{{room}}` and `{{spawned_by}}`, and a Town
    look: skin, hair, outfit (including a dress or a captain's jacket),
    colours and an accessory, with a live preview. Reviewer, Builder,
    Designer and FirstMate are starters you can edit or delete.
  - At launch a profile becomes the harness's own configuration: Claude Code
    gets an inline subagent definition (`--agents` and `--agent`, the fields of
    `.claude/agents/*.md`) and `--permission-mode`; Codex gets `-m`, `-a`,
    `-s` and `-c` options with the role as developer instructions; other kinds
    start plainly and get the role in their first prompt. The editor shows the
    exact command. The new tab takes the profile's colour and its agent wears
    the profile's look in Town.
  - Profile assignments and the Town master travel with their terminal in Herdr
    and are shared by Worlds connected to that Herdr. Profiles and chimes stay
    per World; an unknown profile shows its recorded name with the default look.
    Closing the terminal or restarting Herdr ends its assignment and role.
    The newest Town master assignment wins; moving the role still asks first.
  See the [New agent exercise](../../../../docs/TUTORIAL.md#new-agent).
New workspace and worktree dialogs suggest readable two-word names. Suggestions
load asynchronously; editing the name takes precedence over a late suggestion.

New room (New workspace) picks its **Folder** on the chosen host, Herdr TUI
and herdr-core alike:

- **Recent folders** are up to six buttons, by name with the full path as a
  tooltip: the folders that host's panes and rooms work in, the focused pane's
  first, then the most recently active. The folder defaults to the most recent
  one, else `~` (home); one tap on another recent folder, then **Create**,
  makes the room there.
- The folder is checked on the host as you type: it shows the resolved path,
  **Up to <parent>** and its subfolders to browse, or the error. **Tab**
  completes a typed path to the shared start of the matching folders. Create
  waits for the check of a typed folder; the default folder does not.
- A herdr-core room keeps its folder: core checks it on its host, refuses a
  missing one, and starts the room's shells and agents there. App spaces and
  worktree rooms keep their own folders.
