# Product screenshot capture

Use disposable demonstration projects and a real Herdr runtime to refresh
release screenshots. Capture Herdr World's actual UI and work state. Show multiple
workspaces and agents where the view supports them. Keep real
hosts, usernames, paths, sessions, and repository contents out of public assets.

## Prepare a reproducible scene

1. Use the World release or branch being documented and a compatible Herdr runtime (current captures use 0.9.3 / protocol 22).
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
   agents in one workspace. Review their diffs, and capture Chat, Terminal,
   Files and Changes from panes in that synthetic workspace.
   Show completed work only when the captured session actually completed it.
   Keep demo repositories at a path without user names (such as `/tmp/demo`),
   because Chat shows the paths an agent's tools used. Agent terminals can show
   private details that the page-text privacy scan cannot see: Claude Code's
   status line (start it with a `--settings` status line of your own) and its
   remote-control session link. Do not photograph an agent's Terminal view. If
   World runs with a separate `HOME`, give it the agents' transcripts there. In
   the 0.2.7 capture, a symlink to one project folder inside a real
   `.claude/projects` folder was not found, while moving that project folder
   into the capture `HOME` worked; symlinking the whole `.claude/projects`
   folder also resolves.
5. For mobile capture, use a reachable private World URL and the
   [remote-access guidance](DEPLOYMENT.md#private-remote-access). Do not photograph
   login tokens, URLs containing credentials, or certificate/private-key content.

## Capture the shared release set

Use a consistent appearance, interface scale, and terminal font size. Existing
README screenshots use 1440 × 900 desktop and 390 × 844 mobile viewports. Capture
PNG originals without adding fictional UI or agent conversations.

| View | Shared file under `docs/images/` | Scene |
| --- | --- | --- |
| Desktop Town | `herdr-world-desktop-town.png` | Four rooms; one agent waiting at reception, one finished, one in the lounge |
| Desktop Board | `herdr-world-desktop-board.png` | The same workspaces as cards, with a synthetic note strung to an agent |
| Desktop Spaces | `herdr-world-desktop-spaces.png` | Workspace list with agent states, Zen off, and a shell running `bun test` |
| Desktop Chat | `herdr-world-desktop-chat.png` | Town with the agent window docked on Chat: request, tool rows and the agent's report |
| Desktop Files | `herdr-world-desktop-files.png` | Board Inspector previewing `docs/guide.md` with its Mermaid diagram |
| Desktop Changes | `herdr-world-desktop-changes.png` | Board Inspector with the README section the agent added (unified diff) |
| Mobile Town | `herdr-world-mobile-town.png` | Town at phone width with the Needs you tray |
| Mobile Chat | `herdr-world-mobile-chat.png` | An agent's Chat with its answer and the composer |
| Mobile Board | `herdr-world-mobile-board.png` | Close-up of a note strung to an agent and its workspace |
| Mobile Spaces | `herdr-world-mobile-spaces.png` | Focused terminal with the Composer/Direct controls |

The current set was captured for 0.2.7 from `main` at `2bd28f2f`, after the
v0.2.7 release (only documentation commits sit above it, so the Spaces version
badge reads `v0.2.7-11-g54bb8ac8`), with Herdr 0.9.3 / protocol 22, in the
default Zen layout except desktop Spaces. Three real Claude Code agents ran in
the demo workspaces: lantern-notes added a first-run section to its README (the
Chat, Changes and Files captures), orbit-api suggested a unit test (mobile Chat)
and tide-charts waited on a permission prompt (Town). The note on Board is
synthetic. One Chat path the agent ran (`/tmp/…/try`) is elided because its
original contained a session identifier; nothing else in the captures is edited.
Office, Tree and Graph images, and the earlier History capture, remain
historical assets outside the shared site set; old `/office` addresses open
Town, and `/graph` and `/tree` open Board. The Pages release badge follows
GitHub's latest stable release rather than a hardcoded version. The website's
phone row shows three of the four mobile captures.

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
