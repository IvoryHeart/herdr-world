# Code: the real IDE, in World's frame

**Design study.** Code's first version shipped from it (#1009); the current
behaviour, limits and refusals are in [the Code view notes](../../../openspec/specs/world-code-view/notes.md#code-view).
The study's standalone mock was retired when Code shipped. What follows is the
proposal it tested. SSH hosts shipped: Code runs the host's own IDE over
the connection's OpenSSH destination. Desktop handoff was dropped: nothing
in Code opens an IDE on a desktop. The parts not yet built (the World
terminal-profile extension, PR review handoff) stay open in the
[OpenSpec change](../../../openspec/changes/world-code-view/tasks.md).
The [research](research.md) and [architecture](../../../openspec/changes/world-code-view/design.md)
explain the licence, single-origin and full-shell trust gates.

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

## Failure states and desktop presentation

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
Controls use text state labels, keyboard focus, Escape dismissal, modal focus
containment and polite status announcements. Actual IDE browser/keyboard and
accessibility behavior must be verified against the installed product before
shipping; synthetic rendering cannot establish compatibility.
