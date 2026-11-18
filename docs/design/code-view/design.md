# Code view interaction study

**Proposed, not implemented.** Read the [research and recommendation](research.md)
and [proposed contracts](../../../openspec/changes/world-code-view/specs/world-code-view/spec.md).
The preview is a standalone design fixture served by World's existing static
asset path, outside the live view router. It changes no shipping navigation or
runtime behavior. Its World shell and room cards are simplified sketches.

## Try the preview

On the dispatcher's preview, open **`/code-view-prototype.html`** on the same
origin. For example, replace the preview URL's path with that exact path; no
query switch, real repository or connected runtime is needed. The persistent
**DESIGN STUDY / 981** banner distinguishes every screen from the real app.
**Return to World** leaves the fixture. **Reset study** reloads its initial state.

1. Click **Open Orchard in Code →**. The room's project opens with files on the
   left, code in the middle, Scout/Wren terminals below and Changes on the right.
   Click **README.md**, then **greeting.ts** to switch example buffers.
2. Click **Scout's checkout**. The branch and checkout label change to the
   agent's linked worktree. Edit the example file, switch to **Room · main**,
   then back: drafts belong to their original checkout.
3. Click **Wren** below **TERMINALS**, then **Take control (mock)**. Type an
   example message and click **Send example**. It is labelled as mock input;
   nothing is executed. Select Scout to return to the builder's terminal.
4. Click **Agent changes file**. A clean source buffer refreshes and Changes
   shows the example patch. Click **PR #42**, then **Review changed file**.
   The PR card includes branch, checks and review state; it is a synthetic PR,
   not a link to an actual repository.
5. Edit `greeting.ts`, then click **Agent changes file** again. The draft is
   preserved; **Save example** refuses an overwrite and asks you to compare.
   Changes shows both versions. **Use agent version (discard example draft)**
   explicitly resolves this mock conflict by discarding the local example.
6. Click **Disconnect host (mock)**. Files become stale/read-only and terminal
   input is disabled. Click **Reconnect host (mock)**: the draft survives,
   control must be taken again and nothing is replayed. Click **Town**, then
   **Code** to see the selected project persist across projections.
7. Click **Field notes** under Projects (on a phone, first tap **Files**).
   This opens the other room on the synthetic SSH connection with Finch's
   **Herdr TUI** terminal. There is no fallback from one room or host to another.

On a phone, the same project uses **Files / Code / Agents / Changes** at the bottom
of the workspace. Tap **Agents** for terminals, **Changes** for the diff and PR,
and **Code** to return to the retained buffer. Scenario controls remain below
the panel; scroll down if needed. Try both portrait and landscape. The mock is
responsive rather than a separate phone app, and uses native textarea editing.

## What the proposed product does

Code is a peer of Town, Board, Desk and Spaces in the existing view picker. A
room's **Open in Code** action passes its qualified identity, not a guessed
directory. Its default project is the room checkout. A room without a known
project shows **Choose a project**; an offline room shows its stale state and
cannot open a new actionable editor. Multiple known projects are explicit choices,
never an unbounded scan of the host filesystem.

The left explorer keeps host, room and checkout visible. Selecting an agent's
checkout changes the file/Git context explicitly; selecting its terminal alone
changes only the terminal. Switching projects keeps separate buffers and branch
labels. No view reassigns an agent, moves a desk, switches branches or opens a
new runtime. Common Needs you/Hosts navigation remains available in the real shell;
the fixture omits those live controls rather than simulating authority.

The proposed initial live surface opens read-only text files and comparison tabs.
The mock explores an editing extension: an explicit Save would report success,
conflict, disconnected, unsupported or outcome-unknown. Dirty buffers do not silently
reload when agents write. Binary/oversized/unsupported files remain previews or
downloads under current limits. No tasks, extensions or project code run just
because a folder opens. The textarea demonstrates draft interactions, not syntax
services, editor quality or actual file saving. Editing is deferred pending the
external-writer decision described in the architecture; the initial spec makes
no filesystem-write promise.

Terminals are existing World terminals, selected by agent with runtime and
connection context. They begin in observe mode. Input uses each runtime's current
control semantics and phone composer. The proposed **Take control** affordance is
presentation of those rules, not a new cross-runtime lock. Hide/switch/close detaches
the visible consumer and releases input authority; it never ends an agent. A
separate explicit lifecycle action remains in World.

Changes is scoped to the selected checkout and shows working-tree changes alongside
agent activity. Agent identity is contextual information, not inferred authorship
from a modified timestamp. PR association uses existing validated repository,
branch and reported work links; missing association says **No linked PR**, stale
checks say **Stale**, and no GitHub authorization says **Connect GitHub in World**.
Review opens the exact checkout/file comparison. Opening a PR uses the validated
GitHub URL; approve/merge/commit/push are outside this proposal.

## Layout, access and failure states

Desktop uses explorer / editor-with-terminal / review columns. The terminal dock
and review surface can later use existing World panel controls; this mock fixes
their sizes to compare the arrangement without implementing a layout system.
On phones only one workspace panel is visible; host/project/branch context and
Needs you remain reachable. Keep drafts and selection when navigating. Use 44 px
phone targets, visible keyboard focus, text status labels and announced save and
connection outcomes. Screen-reader/editor and real touch/IME validation remains
an acceptance task for the future editor, not a claim of the mock.

| State | Person sees and can do |
| --- | --- |
| Agent writes a clean open file | Fresh content plus a change indicator; review the diff. |
| Agent writes a dirty open file | Kept draft, conflict message and a comparison; explicit resolution before save. |
| Host disconnects or runtime changes | Stale label; no input or saving; kept draft and exact-target revalidation. No queued writes or keys. |
| Terminal/agent is replaced | Retired target message; explicitly select its replacement. Never attach by display name. |
| Checkout missing, moved or outside admitted root | Unavailable project; choose a newly admitted root. No fallback to room cwd. |
| Read/write or platform capability absent | Read-only explanation, existing supported terminal/review actions retained. |
| Save reply lost after possible write | Outcome unknown; compare a fresh read before any retry. |

Only conflict and disconnect are interactive fault scenarios in this bounded
fixture; the other states above are proposed acceptance cases. Tests exercise
the actual fixture HTML/script, project and checkout retention, conflicts,
terminal selection/control, phone panels and the absence of storage/network effects.
They do not validate live editor or runtime behavior. The future implementation
must satisfy the OpenSpec scenarios and the verification plan.
