# Inspector notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town/Board/Desk selection, common navigator/tab strip and Actions open the shared Inspector.
- Headers offer dock/undock, resource tabs, worktree chooser and pane selection; Settings controls opening mode.
- Phones use the same resources through a compact full-screen window and Back.
- TUI/core reuse the resource surface; core applicability follows coreInspector and its runtime adapter.

**Code:**

- `web/src/components/WorktreeLifecycleDialog.tsx`
- `web/src/components/WorktreeLifecycleDialog.test.ts`
- `server/src/workspace/files.ts`
- `server/src/workspace/files.test.ts`
- `web/src/world/useWorldInspectorWindows.ts`
- `web/src/world/WorldInspectorConversation.tsx`
- `web/src/components/WorkspaceInspectorHost.tsx`
- `server/src/agent/worktree.ts`
- `web/src/world/coreInspector.ts`

**Tests:**

- `web/src/world/WorldInspectorWorktree.test.ts`
- `web/src/world/WorldInspectorChatWorktree.test.ts`
- `web/src/chatFocus.test.ts`
- `server/src/agent/worktree.test.ts`

**Pitfalls:**

- An Inspector represents one qualified tab, with selected pane-specific agent resources.
- Files and Changes share the admitted agent worktree; workspace defaults cannot substitute.
- Navigator selection replaces the docked conversation; explicit docking swaps presentations.
- Delayed focus/resources must not put one identity over another agent's content.
- No Inspector CLI exists; native operations remain owned by their captured runtime.

## Usage reference

### Agent worktree in Files and Changes

An agent's **Files** and **Changes** share one worktree, independently of its
launch directory. The service considers the live Herdr pane `foreground_cwd`,
then the same agent session's native transcript/Codex rollout cwd or explicit
checkout report, then its branch matched in a scoped `git worktree list`.
The location line names the selected tree and branch; its source mark explains
**Live pane**, **Session cwd**, **Agent report** or **Branch match**.

Open that location popover for **Worktree** candidates and **Refresh**; phones
use the same choices in a bottom sheet. Pick a
radio choice to apply it to Files and Changes together. Repository-listed
alternatives are viewing choices, never branch ownership claims. Equal-rank
matches need a choice; stale or replaced-session evidence stops resource access
until refreshed. When the agent's binding changes while it works, Files, Changes
and Commits keep their last view, marked **Worktree changed · Showing last
observation**, and stay non-actionable until the worktree is read again
(opening one of them reads it). Chat and Terminal are never held by the
worktree: Chat's message box and controls keep working. For testing only,
`?worktreeChanged` makes the first agent window opened see its worktree
evidence as stale; opening Files reads it again. Files never silently
falls back to the workspace checkout.
Detached HEAD is supported. An outside-Git or inaccessible cwd is shown as
unconfirmed evidence, without scanning neighboring repositories.

An agent may still report its checkout with `herdr-world agent-checkout
/absolute/checkout --pane w1:p1`, optionally `--pr HTTPS_URL`. The report belongs
to that exact session, expires with replacement/restart, and its link is labelled
**Reported PR**. It is evidence rather than a claim of ownership; viewing another
candidate does not rewrite it. Existing file and Git actions use the selected
root and revalidate its qualified binding before acting.

If a previewed file becomes unavailable, its preview shows a notice instead of
closing the window: choose a current worktree or another file, then **Retry
preview**. Chat and its draft stay open.

## Code view design preview

Code is a proposal to show the user's installed real VS Code web workbench inside
World, projecting the same hosts, rooms, projects, agents and terminals. IDEs fit
the existing integrations direction: detect and enable per host, open per project,
with desktop handoffs to VS Code, Cursor, JetBrains Gateway and Zed. The
[research and recommendation](../../../../docs/design/code-view/research.md) compare Microsoft
`code serve-web`, OpenVSCode and code-server, marketplace/settings differences,
licence, origin/authentication, SSH, terminal and resource hurdles. The
[design walkthrough](../../../../docs/design/code-view/design.md) gives exact preview clicks.
No live editor, server, extension, installer, proxy or navigation is delivered.

Open **`/code-view-prototype.html`** on your World/preview origin. The standalone
**DESIGN STUDY / 981** uses a clearly labelled VS Code **stand-in**, an IDE picker
and an **Open in desktop IDE** handoff preview. All data/actions are synthetic;
nothing installs, connects, saves, executes or launches an app. **Block embedding
(mock)**, **Disconnect host (mock)** and the SSH host's missing-provider fixture
expose failure states; **Mark installed (mock)** only changes fixture state.
**Attach profile (mock)** demonstrates existing agent terminals; Herdr TUI requires
acknowledging that attach resizes the pane for every viewer. The mock presents
the desktop workbench in World's frame. **Reset study** clears memory-only state.
Real embedding remains gated on upstream terms, same-origin/worker/webview compatibility and
explicit trust in full shell/write and same-origin extension authority.

## Workspace Inspector

Open Files, Changes, or Chat with the TabBar Inspector button,
`Cmd+Shift+B` on macOS, or workspace/agent context menus. The header identifies repository,
branch/worktree, and checkout path. Inspector and Annotations leave the primary
sidebar's visibility unchanged. Workspace rows show the latest PR/MR status while
keeping workspace names visible; Inspector commit navigation preserves focus and
refreshes Files after changes. PR/MR refreshes keep the current badge visible.
Badges also survive reloads and reconnects: the last known status stays visible
as stale, and not actionable, until a fresh lookup on a ready connection
replaces it. The browser keeps that cache per connection and destination, with
only what badges and links show. Badge lookups wait behind interactive
requests, and identical lookups share one answer.
A failed refresh leaves the last known result dimmed with its successful check
time; the status card marks it **Last known**. This fallback belongs to the same
host, runtime, workspace, checkout and branch; changing targets clears it. A paused branch rebase can retain
its request on detached HEAD; unrelated detached checkouts stay unresolved.

- Activating a desktop terminal preserves a docked Inspector. After prefilling
  review feedback, **Go to agent** closes it and reveals the destination terminal;
  mobile or expanded Inspectors also close on terminal activation.
- Dock right/bottom, resize, or expand without unmounting the terminal. Header
  controls restore/close; Esc dismisses transient UI, not the Inspector.
- Tab switches keep it open. Workspace switches restore the target checkout's
  view, selection, and layout. Closing returns to the originating tab if it
  exists, otherwise the active tab.
- Wide layouts show navigation beside content; narrow layouts drill into files
  with overlay/full-screen views. Resize the separator by dragging or
  Left/Right/Home/End; double-click resets it. Files and Changes save separate
  checkout-scoped widths.
- Agent browsing starts at its cwd only inside the checkout. Terminal links use
  their pane's workspace, not later focus. Changes cover the checkout, not
  proven agent ownership.
- Open closed worktrees before browsing. Missing/prunable worktrees offer cleanup,
  never sibling files. Removal clears only that checkout's resource state.
- Directory targets opened from terminal links offer a New workspace action that
  prefills the name (last directory component) and CWD, unless the directory
  already backs an open workspace.

Preview is read-only: no synthetic terminal tabs or cross-worktree merged changes.
See [resource ownership](../../../../docs/ARCHITECTURE.md#workspace-resource-ownership).

## Git Worktree Lifecycle

- Create a linked worktree from freshly fetched `origin/main` without changing
  the source branch or dirty files; a repository without an `origin` branches
  from its checked-out commit. Discover/open existing worktrees.
- See checkout paths, open/closed state, branch status, and uncommitted counts.
- Focus open worktrees, run `git pull`, or enable per-checkout branch updates.
- Remove linked worktrees with confirmation, hooks, process cleanup, and recovery
  that preserves residual files when safe removal fails.

Open **Worktree Lifecycle** from a workspace context menu or search
`worktree lifecycle` in the command menu. In World's navigator, repository
workspaces offer the same button and create/remove menu entries on desktop and
phone; a stale or failed host shows them but leaves them inert. The workspace
list clips long worktree and branch names at the start, so their distinctive
end stays visible.

Each repository can choose where its new worktrees go with **Worktree
location** (workspace context menu, command menu or Worktree Lifecycle); empty
keeps Herdr's default. **Settings → Worktree command** sets a **New
worktree command** and a **Remove worktree command** that run from the source
repository on the workspace's host instead of Herdr's own creation and
removal; after a removal command, Herdr closes the workspace. `{path}`,
`{branch}`, `{base}` and `{repo}` are replaced shell-quoted, and `{force}`
becomes `--force` for a forced removal. A repository's own **Worktree
command** and **Remove command**, set in Worktree Lifecycle, win; leave them
empty to let Herdr do it. These settings belong to the workspace's connection.
Ranger can run a configured command but never set one.

### Paseo Worktree Hooks

Define [Paseo hooks](https://paseo.sh/docs/worktrees) under `worktree` in the
repository's `paseo.json`:

```json
{
  "worktree": {
    "setup": "bun install",
    "opened": "./scripts/worktree-opened.sh",
    "teardown": "./scripts/worktree-teardown.sh",
    "removed": "./scripts/worktree-removed.sh"
  }
}
```

| Paseo hook | When Herdr World runs it | Working directory |
| --- | --- | --- |
| `setup` | After a new linked worktree has been created and opened | New worktree |
| `opened` | After an existing linked worktree has been opened | Opened worktree |
| `teardown` | Before a linked worktree is removed | Worktree being removed |
| `removed` | After removal finishes | Source checkout |

For `setup`, `opened`, and `teardown`, the target checkout's `paseo.json` wins;
only an absent file falls back to the source checkout. After removal, `removed`
normally uses the source configuration because the target no longer exists.

Commands run through `sh -c`. The following variables are available:

| Variable | Value |
| --- | --- |
| `PASEO_HOOK` | `setup`, `opened`, `teardown`, or `removed` |
| `PASEO_CHECKOUT_PATH` | Target worktree path, including the former path for `removed` |
| `PASEO_SOURCE_CHECKOUT_PATH` | Parent/source checkout path when known |
| `HERDR_WORLD_HOOK_EVENT` | `worktree.created`, `worktree.opened`, `worktree.before_remove`, or `worktree.removed` |
| `HERDR_WORLD_HOOK_CHECKOUT_PATH` | Same target path exposed under a `HERDR_WORLD_`-prefixed alias |
| `HERDR_WORLD_HOOK_SOURCE_CHECKOUT_PATH` | Same source path exposed under a `HERDR_WORLD_`-prefixed alias |

Notices show hook outcomes and bounded diagnostics (exit code, stderr, or error).
Failed `teardown` stops removal: fix/disable the hook before retrying. Other hooks
are not transactional: failed `setup`/`opened` does not undo creation/opening;
failed `removed` cannot restore a worktree.

Hooks default to enabled. Disable them per repository in **Worktree hooks** or
**Worktree Lifecycle**, which also show detected configuration and commands.
With `--ssh-host`, configuration and execution are remote. **Hooks are trusted,
unsandboxed code:** review `paseo.json` before creating, opening, or removing.

### Automatic Branch Updates

Fetch `origin/main` and merge into enabled checkouts' current branches every
10 minutes by default. The UI shows interval and last result. Manage saved
per-checkout settings in **Settings → Automatic branch updates**, workspace context
menus, or Worktree Lifecycle.

Runs skip dirty or detached checkouts, verify branch/HEAD/worktree stayed unchanged
during fetch, and abort conflicting merges. Updates run only while the workspace
is open in the current connection.

## File Explorer and Preview

- Browse a cached, expandable tree, optionally including hidden files. Search
  loaded names/paths by substring or glob: `r*md`, `?.txt`, `[abc]*`, `{md,mmd}`,
  and `**` are supported. Patterns with `/` match loaded paths; matching is
  case-insensitive. Git badges mark changed files/directories; ignored files
  are dimmed.
- Choose **Browse filesystem** in the toolbar to opt into read-only browsing
  outside the workspace on the connected host. Use **Parent directory** or enter
  an absolute directory to preview references, copy paths, or download files.
  **Workspace only** restores the tree. This mode is off by default and resets
  on browser refresh or checkout/connection changes.
- Preview text with line numbers, syntax highlighting, and `Cmd/Ctrl+F` search.
  Use **Refresh preview** beside Copy to reload the current file from disk
  without reopening it; the selected Raw/Rendered mode is preserved.
  Markdown offers Raw/Rendered views with Mermaid diagrams in code fences.
  `.mmd`/`.mermaid` files offer Diagram/Source views and accept leading comments,
  document headers, and Mermaid fences. Diagrams have independent zoom, Fit, and
  100% controls; scroll to pan or use Ctrl/Cmd + wheel to zoom.
- Follow Markdown file links within the Inspector: relative to the document,
  leading `/` from workspace root, and heading fragments within the destination.
  For absolute reference files, links resolve from the file directory and
  leading `/` resolves from the filesystem root.
  External links open a new browser tab.
- Preview SVG, PNG/APNG, JPEG, GIF, WebP, BMP, ICO, and AVIF images with zoom and
  Fit controls, plus PDFs and workspace-local Markdown images. Phones and other
  browsers without a PDF viewer draw a PDF three pages at a time, with Previous
  pages and Next pages. Unsupported binaries remain download-only; image
  decoding depends on the browser.
- Drag uploads onto the root/directory. Download files or workspace-scoped
  `.tar.gz` directories; copy absolute paths; delete with confirmation.
  Open actions by right-click or touch long-press.

File operations and previews work locally and over SSH.

## Review Annotations

- Open **Annotations** independently next to **Inspector** in the workspace bar (or
  the narrow-screen view switcher). The panel stays available when Inspector is
  closed and opening it does not change Inspector's view. The tab shows the
  current checkout's comment count, including saved drafts. Use the tab or
  Annotations shortcut to toggle the panel, or its close button to dismiss it.
- Desktop annotations float over the workspace by default.
  **Pin annotations** switches to a fixed layout beside or below the workspace;
  **Float annotations** restores the overlay. The choice stays in this browser.
  Mobile uses an explicit Annotations surface with touch controls.
- Click/drag diff line numbers or source annotation gutters to comment on lines;
  release opens the editor with file, range, and content snapshot.
- Select rendered Markdown passages to capture their text and nearest heading.
- Select terminal text with the mouse, then choose **Add comment** to capture
  the passage and pane label, even with the Inspector closed. Terminal quotes
  have no buffer coordinates and are not re-anchored; missing panes are marked
  unavailable.
- Edit, delete, or reorder mixed checkout-scoped comments. Copy compiled feedback or
  pre-fill a selected Agent pane; **delivery never submits**. Review and press
  Enter manually. After pre-fill, **Go to agent** opens the destination pane/tab.
- Copy retains the browser-local draft. Successful pre-fill removes only unchanged,
  delivered comments; edits made during delivery and failed deliveries retain work.
  Leaving the draft's workspace or connection during pre-fill retains the original draft,
  even after returning. Closing Inspector or Annotations does not discard drafts.
  Blank comments cannot be delivered.
- Refresh re-anchors matching file/diff content and marks unresolved anchors stale
  without losing captured quotes.

## Diff Viewer

- Browse a directory tree with staged, unstaged, untracked, conflicted, and
  branch-diff badges plus added/deleted counts.
- Choose **Working tree**, **Against branch**, or **Last step** (latest completed
  agent-activity snapshot, including commits/untracked files; not proof of ownership).
  Branch mode uses the repository's recorded default, then its configured default,
  main or master. Select a local or remote-tracking branch already present on the
  host; inspection never fetches. The choice is saved per repository and host.
- Read files in repository order. Large, truncated, and `linguist-generated=true`
  diffs start collapsed and render on expansion.
- Choose desktop side-by-side/unified views; mobile is unified. Wrapping saves
  independently for desktop/mobile. Search with `Cmd/Ctrl+F`, Enter/Shift+Enter,
  or previous/next controls. Text is syntax-highlighted; images have previews.
- Jump to File Explorer from a diff. Working-tree context menus (right-click,
  long-press, or keyboard menu key) offer open, copy relative/absolute path, and
  status-matched stage, unstage, mark resolved, discard unstaged, or delete
  untracked actions, with destructive-action confirmation.
- **More Git actions** (`…`, beside Refresh) offers Stage All, Unstage All,
  Discard All Unstaged, and Delete All Untracked with affected-file counts.

Scope, view mode, wrapping, and recent selection persist per checkout/browser.
Git actions recheck status/content and reject stale menus instead of destroying
newer work.
