# Product screenshot capture

Use disposable demonstration projects and a real Herdr runtime to refresh
release screenshots. Capture Herdr World's actual UI and work state. Show multiple
workspaces and agents where the view supports them. Keep real
hosts, usernames, paths, sessions, and repository contents out of public assets.

## PR screenshot viewports

Use these CSS-pixel sizes for PR presentation evidence and the Town golden-image
report. They match the existing synthetic Inspector capture helper. DPR is 1 for
repeatable reference images; this does not claim high-DPR or mobile-device coverage.

| Name | Width × height |
| --- | --- |
| Phone | 390 × 844 |
| Mac laptop | 1512 × 982 |
| Half-width Linux window | 1280 × 1440 |
| Wide Linux monitor | 2560 × 1440 |
| Portrait monitor | 1440 × 2560 |

## Town golden-image report

The advisory [Town golden images workflow](../.github/workflows/town-golden.yml)
compares the production `TownCanvas` (Pixi scene and DOM overlays) with five stored
PNGs on PR changes and main pushes. It is separate from required Delivery checks.
The fixture contains only synthetic hosts, four rooms, sixteen desks and mixed
working, blocked, finished and idle agents. It does not start World or Herdr,
contact a runtime, or capture a user's browser. The surrounding World shell, rail,
Inspector, gestures and runtime effects retain their existing tests.

The fixture fixes its random seed, wall clock, 16 ms frame clock, dark theme,
100% interface scale and DPR 1. Motion stays enabled. Fonts load before layout;
WebGL initializes before mounting, then the production scene runs for 6,000 ms of
test time after its first frame so actors, roofs, camera, textures and shaders
settle before capture. CSS transitions and animations are disabled in this fixture.
All production scene/animation steps run. A fixture-only Pixi render wrapper
rasterizes the first warm-up frame and the final checkpoint; intermediate GPU
paints are batched. Receipts record scene steps and GPU paints, with at most two
GPU paints per capture. This preserves the original full-paint reference pixels
while bounding SwiftShader cost; it does not exercise intermediate GPU frames.
Existing renderer lifecycle and animation browser checks retain that coverage.
Reference fonts are bundled subsets of the Linux fallback faces (Noto Sans and
DejaVu Sans Mono); fixture-only aliases avoid host fontconfig and network fonts.
Font licences and provenance are beside the fixture. Product fonts and styling
are unchanged. This reference deliberately selects those fallback faces rather
than claiming every platform's system-font appearance.

The report requires the checksum-pinned Linux x64 Chrome from
`tools/chrome/test-chrome.json`, forces SwiftShader and sRGB, disables LCD text and
font hinting, and compares decoded RGBA pixels exactly. There is **no tolerance**,
mask or automatic golden refresh. Chrome, fonts and goldens must be reviewed
together when the reference renderer changes.

Install the pinned browser using the existing [development guidance](development.md#verification),
then run through the browser queue:

```bash
TOWN_GOLDEN=1 bun run test scripts/town-golden.browser.test.ts
TOWN_GOLDEN=1 TOWN_GOLDEN_RUNS=20 TOWN_GOLDEN_OUTPUT=.agents/town-golden-stability \
  bun run test scripts/town-golden.browser.test.ts
```

`CHROME_BIN` must name the pinned browser. A run uses a fresh Chrome profile;
each viewport gets a new page. The ordinary report captures five images once;
stability mode allows at most twenty runs (100 captures). The five images total
under 12 million pixels at DPR 1; ordinary CI has a 15-minute job ceiling. Ordinary test
gates skip the opt-in visual test, while the comparison's unit tests stay required.

Outputs default to `.agents/town-golden/`: current images, JSON receipts, Markdown
summary and, on mismatches, expected/current/magenta-diff images. CI retains these
for 14 days and puts the result in its job summary, including failures. Inspect
the images and report rather than rerunning a mismatch to get green.

For an intentional visual change, generate new images locally with
`TOWN_GOLDEN=1 TOWN_GOLDEN_UPDATE=1 bun run test scripts/town-golden.browser.test.ts`,
inspect all five images, then run the twenty comparisons without update mode.
Updates are refused in CI. Commit reviewed PNGs under
`web/src/world/testing/town-golden/images/`; do not commit the generated report
directory. [Initial stability evidence](reviews/town-golden.md) records the
reference and its limits. These test goldens are separate from release screenshots
below, which still require real synthetic runtime work.

### Hosted stability and production visual negative control

Opt into hosted acceptance by applying the `town-golden-stability` PR label before
pushing the candidate, or by selecting `stability: true` in workflow dispatch
once the workflow is available on the default branch. Label changes alone do not
start or cancel a report. Remove the label when later candidates need only the ordinary
one-run report. Both modes stay advisory; the stability job has a finite 40-minute
ceiling to cover twenty runs plus the negative control.

Stability mode first compares 100 captures against unchanged stored goldens.
It then temporarily changes the actual grass paint colour in
`web/src/world/town/townPaint.ts` and runs the same five-viewport harness in a
child test process. The child must exit nonzero specifically because pixels
differ at every viewport; startup failures do not count. The control restores the
production source byte-for-byte, runs the baseline again, requires exit zero and
five exact matches, and verifies all golden file hashes are unchanged.

To reproduce the negative control locally with the pinned `CHROME_BIN`:

```bash
TOWN_GOLDEN_NEGATIVE_CONTROL=1 \
  bun run test scripts/town-golden-negative.browser.test.ts
```

The production paint file must be clean before this command. A `finally` block and
signal handlers restore it, including on failure or interruption. The output
defaults to `.agents/town-golden-control/` (override with
`TOWN_GOLDEN_CONTROL_OUTPUT`). It includes `mutation.diff`, each child's exit code,
logs and full capture report, the actual SwiftShader renderer strings, mismatch
PNGs, and a restored-source/reference-hash check in `control.json`.
CI places it inside the same `town-golden` artifact as the complete 100-capture
report. Reports identify the checked-out source commit and GitHub run ID, so
review evidence can be tied to the exact candidate without refreshing goldens.

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
