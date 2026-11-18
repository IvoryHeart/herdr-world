# Code: the real IDE, in World's frame

**Design study, not a shipping feature.** The owner selected real VS Code and
IDE integrations. This revision replaces the earlier custom-editor mock.
The three standalone assets at `/code-view-prototype.html` use fixed synthetic
fixtures only: no IDE/extension is loaded, nothing installs, no network or storage
is used, no desktop app opens, no command executes and no real file or PR changes.
The workbench is a **clearly labelled stand-in**, not a screenshot or working IDE.
The [research](research.md) and [architecture](../../../openspec/changes/world-code-view/design.md)
explain the unresolved licence, single-origin and full-shell trust gates.

## Try it on the preview

Open **`/code-view-prototype.html`** on the dispatcher's preview origin. No runtime,
repository, account, query parameter or database setup is needed. The permanent
**DESIGN STUDY / 981** banner and **LABELLED STAND-IN · NOT A RUNNING VS CODE**
caption identify the fixture. **Return to World** leaves it. **Reset study**
restores all initial memory-only state.

1. Click **Open Orchard in Code →**. World's host/room header surrounds a VS Code
   workbench stand-in: activity rail, Explorer, code, integrated terminals and
   native Source Control context. Click **README.md** and **greeting.ts**.
   The example is read-only because this study does not build a World editor.
2. Click **Scout’s checkout**. The branch changes to `scout/welcome`. Click
   **World: Wren** in the workbench's terminal tabs: the terminal changes, while
   the checkout stays Scout's. Click **Attach profile (mock)**, then **Detach
   profile (mock)**. These represent the proposed World VS Code extension
   attaching an existing core terminal, not launching a new agent or shell.
3. Click **Agent changes file**, then **PR #42** in the World sidebar, then
   **Review in VS Code (mock)**. The synthetic file changes and the review request
   selects the agent checkout. Real Git diffs, saves and conflicts belong to
   VS Code; World supplies verified project/PR context. No actual PR is opened.
4. Click **IDE integrations**. This host has Microsoft VS Code web detected and
   enabled. OpenVSCode and code-server are separate providers with Open VSX
   labels. Click **Enable (mock)** for OpenVSCode, then **Use web IDE (mock)**:
   the provider label changes. Open the picker and return to Microsoft explicitly.
   Each row discloses detected/enabled state and the full-shell/write trust warning.
   Press **Escape** or **Done** to close. Nothing installs or accepts real terms.
5. Click **Open in desktop IDE**, then **Cursor**, **JetBrains Gateway** or **Zed**.
   The handoff preview retains the exact project, checkout and owning host. It
   explains that the browser device's installed apps are unknown and launches
   nothing. Press **Escape** to return to the selected project.
6. Click **Block embedding (mock)**. The workbench is replaced by an explicit
   webview-origin blocker with desktop handoff. No automatic CSP change or provider
   fallback occurs. Click **Clear embed block (mock)** to restore it. Click
   **Disconnect host (mock)**: context becomes stale, profiles detach and desktop
   handoff refuses. **Reconnect host (mock)** restores that exact host with no
   profile automatically reattached and no input replay.
7. In **Project**, select **Field notes · SSH**. Its Microsoft provider is missing,
   demonstrating independent host state. Open **IDE integrations**. Either enable
   the detected code-server and explicitly use it, or click **Mark installed (mock)**
   for Microsoft, **Enable (mock)**, then **Use web IDE (mock)**. Mark installed is
   a testing-only switch; it downloads/starts nothing. The future product would
   require owner setup and validated licence/security admission.
8. On Field notes click **Attach profile (mock)**. Read the warning: **Herdr attach
   resizes the pane for every viewer**, even when observing. Click **Confirm shared
   resize (mock)** to attach Finch. Closing/detaching would leave the existing
   agent running. Open the desktop handoff to see SSH-specific instructions,
   rather than incorrectly treating the remote folder as client-local.

On a phone open Orchard and use **Agents / Files / Changes**. These sketch World's
existing native phone surfaces, keeping host/project context and no custom phone
editor. **IDE preview** deliberately shows the compact stand-in with a larger-screen
warning; it is not evidence of real phone VS Code support. PR selection lives under
Changes; scroll below the current panel for mock scenario controls. The provider
picker and handoff remain usable on a phone, with no assumption a desktop client
is installed. Try portrait and landscape.

## Proposed interaction and ownership

Code stays a peer of Town, Board, Desk and Spaces in the common shell. A room's
Open in Code passes its qualified project and connection; multiple/missing roots
require a choice, never a host-wide scan. The common navigator, attention, Hosts
filter and annotations remain World-owned; this simplified fixture does not
recreate the entire production shell. Changing projection preserves selection
and never moves an agent or silently swaps host, checkout or IDE provider.

The central workbench belongs to the selected installed IDE. Explorer, editing,
debugging, tasks, extension management, settings, profiles, Workspace Trust and
Source Control remain native IDE UI. World does not intercept saves or promise a
new external-writer conflict protocol. Project configuration travels with the
project; personal/browser/server/desktop settings and remote extensions may need
supported Sync/import and separate setup. No promise of unlimited desktop parity.

IDE integrations live in the existing integrations direction, grouped with harness
integrations but with distinct provider capabilities. Detection is per host and
read-only; enablement is per host and requires explicit full host-user shell/write
and same-origin trust consent. Installed servers start only on explicit admitted
open/start actions. Microsoft terms are accepted by the user, never silently by
World. Setup guidance is separate from starting known installed software.

A small optional World extension exposes existing agent terminals through terminal
profiles. Profiles start in observation under runtime-specific admission, with TUI
shared-size effects disclosed before attaching. Core uses a screen/typing adapter,
not an assumed raw PTY. Editor focus never sends terminal keys. Closing/leaving
Code releases World attach/input demand; it does not kill agents or an externally
started IDE server. The IDE's ordinary shell terminals remain available under the
IDE's own authority and are distinct from World-attached agent profiles.

World's right-side context shows agents, attention and qualified PR evidence.
The real IDE shows working-tree changes. Review requests select a verified
checkout/comparison through the proposed extension; a terminal label or matching
branch name alone is not proof of authorship or PR association. Stale or missing
provider evidence stays non-actionable. No new World commit/merge authority.

## Failure and responsive design

| State | Proposed experience |
| --- | --- |
| Provider missing/disabled | Exact host and reason; setup/enable or explicit provider choice. No install-on-open. |
| Licence or origin/worker/webview check fails | Block embed, explain hurdle, offer desktop handoff. Never silently weaken policy or switch marketplace. |
| Host/session retires | Stale context, revoked proxy/extension input, no automatic host fallback or key replay. |
| Core adapter unsupported | Disable that profile with reason; keep native World terminal access. |
| Desktop client unknown | Explicit launch confirmation or supported connection instructions; no host-side GUI or guessed local file path. |
| Too many active servers/windows | Measured limit explanation and explicit close/stop choices; never kill external servers or agents. |
| IDE update changes behavior | Revalidate actual server commit and disable incompatible embedding until verified. |

Desktop gives most space to the real workbench and a narrow World context rail.
The mock's proportions are illustrative, not a replacement IDE layout engine.
Phone defaults to native World panels. Controls use 44 px phone targets, text
state labels, keyboard focus, Escape dismissal, modal focus containment and polite
status announcements. Actual IDE browser/keyboard/IME/accessibility behavior must
be verified against the installed product before shipping; synthetic rendering
cannot establish compatibility or phone parity.

Research/design-only changes do not alter first-run install or learner steps, so
README and TUTORIAL remain accurate. FEATURES and the knowledge map identify the
study and its limits. On implementation **or rejection**, retire the three mock
assets and lower the extra asset-count allowance; the OpenSpec task list records
this lifecycle explicitly.
