# Product screenshot capture

Use disposable demonstration projects and a real Herdr runtime to refresh
release screenshots. Capture Herdr World's actual UI and work state. Show multiple
workspaces and agents where the view supports them. Keep real
hosts, usernames, paths, sessions, and repository contents out of public assets.

## Prepare a reproducible scene

1. Use the World release or branch being documented and a compatible Herdr runtime (current Town/Board captures use 0.9.3 / protocol 22).
   Record their exact versions and source revisions with the untracked capture
   originals. See [development](development.md) for a source build.
2. Create disposable demo repositories with synthetic project names, source,
   Markdown, and images. Use a dedicated Herdr session and a fresh browser
   profile, without personal history or saved credentials. Keep the World
   listener on loopback for desktop capture.
3. Open a workspace and terminal tab in Herdr, then connect World to that local
   runtime. Add only synthetic profile labels. Confirm the Hosts filter and each
   open resource's owning host before photographing any view.
4. Follow the [tutorial's review task](TUTORIAL.md#daily) in a demo
   repository. Run actual supported agents in separate panes, including multiple
   agents in one workspace. Review their diffs, and capture Terminal, Files,
   Changes, and Agent History from panes in that synthetic workspace.
   Show completed work only when the captured session actually completed it.
5. For mobile capture, use a reachable private World URL and the
   [remote-access guidance](DEPLOYMENT.md#private-remote-access). Do not photograph
   login tokens, URLs containing credentials, or certificate/private-key content.

## Capture the shared release set

Use a consistent appearance, interface scale, and terminal font size. Existing
README screenshots use 1440 × 900 desktop and 390 × 844 mobile viewports. Capture
PNG originals without adding fictional UI or agent conversations.

| View | Shared file under `docs/images/` | Scene |
| --- | --- | --- |
| Desktop Town | `herdr-world-desktop-town.png` | Four disposable workspace rooms and live shell tables |
| Desktop Board | `herdr-world-desktop-board.png` | The same workspaces as cards, terminal tabs and synthetic planning notes |
| Desktop Spaces | `herdr-world-desktop-spaces.png` | Focused workspace and live terminal |
| Desktop Files | `herdr-world-desktop-files.png` | Same agent's file resource |
| Desktop Changes | `herdr-world-desktop-changes.png` | Same agent's changed files and readable diff |
| Desktop History | `herdr-world-desktop-history.png` | Same agent's real session history |
| Mobile Town | `herdr-world-mobile-town.png` | Town at phone width |
| Mobile Board | `herdr-world-mobile-board.png` | Board cards and a planning note at phone width |
| Mobile Spaces | `herdr-world-mobile-spaces.png` | Focused terminal and mobile controls |

The current Town/Board captures follow main after the Board merge, using Herdr
0.9.3 with disposable projects, real shell panes and synthetic planning notes.
Their empty attention counts reflect the runtime; notes do not imply completed
agent work. Label current-main captures in the README and tutorial; consult release
notes for stable availability. Office, Tree and Graph images remain historical
assets and are no longer part of the shared site set. Do not remove their source
or verification coverage merely because the public gallery changes. The Pages
release badge follows GitHub's latest stable release rather than a hardcoded version.

Inspect every image for private data, clipped controls, stale host indicators,
and misleading agent status before adding it to Git. Preserve raw capture
originals and version notes outside tracked directories. If screenshot names or
coverage change, update the README, site showcase, tutorial references, and
`scripts/build-pages.ts` together. The site builder copies the shared PNGs;
do not maintain separate screenshot copies in `site/assets/`.

## Verify presentation

Run `bun run build:site` and inspect the generated `.pages-dist/` homepage and
tutorial at desktop and phone widths. Check each screenshot link and its alt
text, keyboard navigation, and tutorial reading with JavaScript disabled. Keep
generated output out of commits. Site deployment remains gated on a working
stable installer; see the [release process](release.md).
