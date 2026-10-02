# Product screenshot capture

Use one disposable demonstration project and a real Herdr runtime to refresh
release screenshots. Capture Herdr World's actual UI and work state. Keep real
hosts, usernames, paths, sessions, and repository contents out of public assets.

## Prepare a reproducible scene

1. Use the World release or branch being documented and Herdr 0.9.0 / protocol 22.
   Record their exact versions and source revisions with the untracked capture
   originals. See [development](development.md) for a source build.
2. Create a disposable demo repository with synthetic project names, source,
   Markdown, and images. Use a dedicated Herdr session and a fresh browser
   profile, without personal history or saved credentials. Keep the World
   listener on loopback for desktop capture.
3. Open a workspace and terminal tab in Herdr, then connect World to that local
   runtime. Add only synthetic profile labels. Use the connection selector to
   confirm the selected host before photographing any view.
4. Follow the [tutorial's review task](TUTORIAL.md#daily) in the demo
   repository. Run an actual supported agent for history or status shots, review
   its diff, and keep the same pane selected for Terminal, Files, and Agent History.
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
| Desktop Office | `herdr-world-desktop-office.png` | Selected-host rooms and agents |
| Desktop Tree | `herdr-world-desktop-tree.png` | Connected hierarchy and Inspector |
| Desktop Graph | `herdr-world-desktop-graph.png` | Readable relationships, fitted to viewport |
| Desktop Spaces | `herdr-world-desktop-spaces.png` | Focused workspace and live terminal |
| Desktop Files | `herdr-world-desktop-files.png` | Same agent's file resource |
| Desktop Changes | `herdr-world-desktop-changes.png` | Same agent's changed files and readable diff |
| Desktop History | `herdr-world-desktop-history.png` | Same agent's real session history |
| Mobile Office | `herdr-world-mobile-office.png` | Office and usable touch controls |
| Mobile Tree | `herdr-world-mobile-tree.png` | Hierarchy at phone width |
| Mobile Spaces | `herdr-world-mobile-spaces.png` | Focused terminal and mobile controls |

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
