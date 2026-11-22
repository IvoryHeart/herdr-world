# Needs You notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Top-bar badge/Zen picker and the left handle open the same Needs you tab in every view.
- Town letters, Board badges, Desk Answer and Summary links open its requested item/page.
- Phones use a focus-owning full-screen list with Back; desktop can keep it beside the view.
- CLI ask/get/answer/withdraw shares the durable ledger; TUI/core placement keeps exact runtime/session.

**Code:**

- `server/src/cli/world-skill.ts`
- `server/src/cli/world.test.ts`
- `web/src/world/town/TownPostOffice.tsx`
- `web/src/world/town/townPostModel.ts`
- `web/src/world/town/townPostPaint.ts`
- `web/src/world/town/townPostFixture.ts`
- `web/src/world/town/townPostModel.test.ts`
- `web/src/world/town/TownPostOffice.dom.test.ts`
- `web/src/world/NeedsYouTab.tsx`
- `web/src/world/NeedsYouItem.tsx`
- `server/src/world/world-cli-asks.ts`
- `server/src/cli/world.ts`
- `server/src/storage/world-storage.ts`

**Tests:**

- `web/src/world/NeedsYouAskerActions.dom.test.ts`
- `web/src/world/needsYou.test.ts`
- `server/src/world/world-question-ownership.test.ts`
- `server/src/world/question-backlog-storage.test.ts`

**Pitfalls:**

- Questions, blocked agents and finished work have different close/review actions.
- Dismiss all groups only verified terminal identity across the full backlog, never matching names.
- CLI cause keys are occupant-scoped; dismissal stays closed until withdrawal.
- Recorded, notified and delivered are distinct outcomes; preserve uncertainty.
- Native prompt answers use Chat checks; a durable ask answer is a different operation.

## Usage reference

- **Needs you** in the top bar (in the view picker in Zen, including on a phone;
  outside Zen a phone shows it as an inbox icon with a count badge, hidden at
  zero, right after the view's name) counts
  open questions and the blocked agents of the hosts the Hosts filter shows, in
  every view, and opens the **Needs you** tab on the left: beside the view on
  wide landscape screens, over it on narrower ones, full screen with **Back** on a
  phone, where it takes focus, keeps the app behind it out of reach and gives
  focus back when it closes. It stays open or closed per device; while closed and anything waits, a
  **Needs you** handle sits at the left edge. Each item is a compact notification
  from its agent with Chat's formatting: one header row (its mark, name, place
  and age, then icons), the message, and answer controls only when the agent
  asked. **?** questions show their options as quick replies (the first
  highlighted; **Other…** opens a typed answer) or one answer field with a send
  icon, plus why an alert for you may not have arrived. The answer field's
  paperclip attaches files or screenshots (also by paste or drop; on a phone it
  picks photos or files). Each file uploads as a chip with a thumbnail that
  **✕** removes before sending; the answer then ends with `Attached files:` and
  one stored path per line, which the asker receives and `herdr-world ask get`
  shows. Files are stored on the asker's host with the terminal upload limits
  and retention, even after its connection restarts; while that host is down
  the file is refused rather than stored elsewhere. Only an asker World never
  tied to a connection stores files on the World host.
  **!** blocked agents show
  the agent's own question with its options as quick replies, answered and
  confirmed as Chat does (the same card, including Claude's recorded questions
  and its folder-trust choices), with **Open Terminal** when the answer could
  not be confirmed; **✓** finished work lists done agents and idle agents the service saw
  finish in the last 12 hours, with no answer row (Desk's To review lane can
  also list idle agents from recent transcript turns). Every item names its
  agent and marks an unverified asker; the name and the chat icon (**Open in
  Chat**, or **Follow up in Chat** for finished work) open the agent's Chat.
  The **✕** icon keeps each kind's own action: **Dismiss question** on a
  question, **Mark reviewed** on finished work (it marks the report shown, says
  so if the mark could not be saved, and the item offers **Retry** if the report
  could not be read); a blocked agent has none. Every icon has a label and a
  tooltip. When a verified terminal has several questions, **Dismiss all N
  questions from [asker]** closes its whole open backlog in one step, across
  pages and runtime restarts, without answering or closing another terminal's
  questions. Failed saves stay visible for retry; unverified claims are not
  grouped. Testing only: open `?questionBacklogFixture` (removed immediately)
  for 20 synthetic Atlas questions and one Beacon question; dismiss Atlas and
  Beacon stays. The fixture never contacts a runtime; reload to leave it.
  Worlds started with the same `HERDR_WORLD_INSTANCE_REGISTRY_DIR` and attached
  to the same runtime show each other's open questions (up to 60 per World,
  from up to 8 Worlds, refreshed every 5 seconds and on each question alert),
  marked **Asked in [World]** with a link. Answering or dismissing one there
  closes it in the World that holds it, which records exactly one answer and
  delivers it to the asker; a second answer, from any World, is refused as
### Agent CLI (`herdr-world --skill`)

Every standalone installer run and `herdr-world update` discovers supported
harnesses by their existing config folders and installs or refreshes the release's
World guide (plus Claude's limits tap). This also runs when World is already
current; `update --check` is read-only. Per-harness output says whether World's
integration was installed (new), updated (changed), already current (unchanged),
skipped or failed, and gives `herdr-world integration uninstall <harness>`.
`HERDR_WORLD_SKIP_INTEGRATIONS=1` keeps these manual, independently of
`HERDR_WORLD_SKIP_HERDR=1`. A conflict or failure is reported and other harnesses
continue; an installed World update and its service restart still complete.
Use `herdr-world integration sync` to retry discovery, or install manually with
`herdr-world integration install claude` (or `codex`, `pi`, or another
[Herdr harness](../../../../docs/harness-integrations.md)).
Start a new harness session to discover the `herdr-world` skill.
Installation is local to the host and needs no running World service.
It never overwrites an unmarked or wrong-ID user skill, nor creates a missing
harness config folder. Unreadable or unsafe files fail without replacement.
`integration status [harness]` lists the state, version and path;
`integration uninstall <harness>` removes it and records a persistent preference,
even if already absent. Later installs and updates keep it removed until explicit
CLI or Settings install reenables it. Codex, Pi and Kimi share
`~/.agents/skills/herdr-world/SKILL.md`; removing one also removes it for
the other two, which the command names; their removal preference is also shared.
OMP, Letta and MastraCode report
unsupported. See [paths and overrides](../../../../docs/harness-integrations.md).
**Settings → Integrations** shows the same state and path as a
**World skill** line under each Herdr harness on World's own host, with
Install, Update and Uninstall buttons that run the CLI's installer; uninstalling
a shared file confirms which harnesses lose it first.

The Claude install also chains the existing status line through World's limits
tap. Sessions started outside World update the host's Claude Fuel gauge; the
previous command keeps its input and output. Reinstall never chains World twice.
Uninstall restores the original settings bytes when unchanged and preserves later
user edits. See [settings safety and preview](../../../../docs/harness-integrations.md#claude-limits-tap).

Agents change World objects themselves from their pane, through the running
World service. `herdr-world --skill` prints the guide; commands answer in JSON
when piped, with stable exit codes:

- `colour set|reset`, `board card pin|unpin|move|group|ungroup|colour`: Board
  cards and tab or workspace colours. Recorded with the agent and time;
  `history` lists changes and `undo <change>` takes one back.
- `town desk move … --herdr`: reorder a desk in its room with Herdr's tab
  order, as a drag in Town does. It needs `--herdr` because it changes Herdr,
  and World cannot undo it.
- `ask "…" [--key CAUSE] [--options a,b] [--owner-only] [--wait]`: a question
  for you. It appears first in the **Needs you** tab and Town's Summary, where you
  pick an option or type an answer; `--wait` returns that answer to the asker.
  Its agent waits at reception with **?**; Board and Desk show the same mark.
  Each question names its agent as Town labels its desk, with **Open agent**
  (a shell pane without an agent opens its terminal),
  and **Dismiss** closes it without sending an answer (`--wait` then returns
  `dismissed`). A caller World cannot verify is marked unverified; it still
  reaches reception when exactly one local Herdr has the pane it names. A new
  ask follows your chime, toast and OS notification preferences, naming its
  agent with the question's first line and **Open agent** for its exact
  original seat. Reception shows failed or uncertain alert delivery while
  keeping the saved question answerable. World commits a new ask and its attention intent together in
  `world.sqlite`, then alerts you through its captured Herdr connection.
  Herdr's toasts, connected Worlds and phone notifications can receive it even
  when no World tab is open. The CLI retains a fallback alert through the asking
  pane's Herdr if World could not record it; it names the failure and exits 1.
  When no alert is confirmed yet, exit 6 (`not_delivered`) carries the recorded ID;
  `retrying: true` means the service will retry a temporary failure with backoff.
  At 20 open questions per verified terminal (or the shared unverified
  allowance), or 500 overall, new asks return `question_cap` (exit 3, HTTP 429)
  and tell the caller to wait until a question closes. These refusals never
  alert or chime, including repeated attempts; the CLI sends no fallback alert.
  The allowance follows the terminal across runtime restarts.
  Closing the ask cancels a pending alert. Duplicates are possible after a lost
  reply or restart. JSON preserves `recorded` and Herdr's `notified` evidence
  (`null` for a repeated cause), including through `--wait`. Another verified agent (never
  the asker) may answer a question that is not marked `--owner-only`.
- `ask withdraw ID` or `ask withdraw --key CAUSE`: the original verified asker
  withdraws a cleared cause, including when a creation reply lost its ask ID.
  The same freshly verified connection and stable terminal can withdraw after
  a runtime restart or session change, even when generation and occupant
  fingerprint differ. Another terminal or connection cannot. Older records
  without stable terminal identity retain their original stricter checks;
  answer delivery and receipt authority still follow the original session.
  Answering or withdrawing removes its question marks. `--key` keeps repeated
  causes to one ask; after withdrawal a recurrence can create a fresh question.
  A waiting CLI returns `withdrawn` when its question was cancelled. Repeating
  an answered key returns its answer; human withdrawal output also names any
  preserved answer. Crew recovery handles lost replies, re-arms recurrences and
  reports permanent withdrawal refusals once for you to answer.
- `result --task ID "…" [--pr N] [--status done|blocked|failed]` and
  `result ls`: task results kept by World, instead of terminal scraping.
- `task-summary "…" [--ttl-ms MS]`: a short label for the current Herdr agent
  session, expiring after 15 minutes by default. `stamp CHILD_PANE PARENT_PANE`
  records parentage directly in Herdr; both accept `--session NAME`.
- `spawned-by <parent-pane>`: the spawn stamp, made by the child itself. It
  is display-only Herdr pane metadata, so it needs no `--herdr`; the parent
  it names is the child's claim.
- `whoami`, `ls`, `history [--actor]`.
- `group create|add|remove|lead|reviewers|now|list|show|delete|promote`:
  World-owned Teams and Pods, with `pod` and `team` aliases. Lead/reviewer
  edits follow crew rule reserving roles to you or FirstMate; sender claims are attribution,
  not authenticated permission. Exclusive-role transfers need `--replace --yes`,
  deletion needs `--yes`, and Team promotion needs a complete explicit address mapping.
  `group show` includes recent sender attribution (128 changes retained globally).
  Room/Desk groups are projected from Herdr. Adding with `--herdr` reuses Town's
  move: Room moves the whole desk and prints every affected agent first; Desk
  moves one pane; `--allow-close-room` also consents to closing the source room
  when its last desk leaves. Results report confirmed Done/Partly done/Not done/Unknown
  outcomes and locations, with no automatic retry on Unknown.
  `group import FILE --yes` migrates one Pod table atomically and never overwrites
  existing Pods; explicit address mappings handle away or annotated names.
  `group list --kind pod --markdown` renders the roster; files are never synchronized.

World checks who is calling: the CLI sends its `HERDR_PANE_ID`, and the
service accepts it only when the calling process runs in that pane of a local
Herdr (the pane's shell or foreground process is among its ancestors).
The CLI reaches only a World service on the same machine, with a token
derived from the service's signing secret that cannot log a browser in.
Otherwise the change is labelled unverified, or "terminal with no pane" when
no pane is named, since any process can leave it out; `me` and `spawned-by`
need a verified pane. The CLI never
merges, deletes panes, tabs or workspaces, or reaches outside World.


  closed. A question stays with the runtime it was asked on, even if that saved
  connection is later edited to target another. A long question is shortened
  in the alert so its World's name always arrives. Places, IDs and attachments
  stay with that World. When it stops, its
  questions leave the others at the next read (a failed read keeps them 15
  seconds); answering then says it is not running. An alert whose question this
  World cannot read (no shared registry, an older World, or another runtime)
  shows as **Asked in [World]** with a link when known, no answer field, and
  **Hide alert**; up to 20 are kept until World restarts. Testing only: open
  `?siblingQuestionsFixture` (removed immediately) for one local question, one
  held by another World, and two alert-only entries; answering an alert-only
  entry is refused.
  A message longer than two lines shows **more** on its last line: it,
  or a tap on the text, shows the whole message in place with its links, and
  **less** clips it again. Keyboard focus entering the message reveals its
  links. Hovering the agent's name shows its card with
  the latest message. An answered question folds to one line until the tab
  closes. It shows a page of 30 items; **Show … more** and **Show the … before**
  turn the page, and every opener turns to its item's page. Town's post
  office sign opens it too. Town's reception
  letters, Desk's **Answer** and the **!**/**✓** badge on a Board card open it at
  that item. When Town has saved answers to check, **✉ Outbox** at the foot opens
  Town's Summary there. It replaces Town's Needs you rail.
