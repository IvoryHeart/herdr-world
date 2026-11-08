# Work-item quests: proposal

**Status: a prototype for owner approval (#510). Nothing here is built.**
The [clickable mock](index.html) opens in a browser with no build step and
uses synthetic data only. The Town drawing is a concept, not Town art.

## What it is

A work item is one GitHub issue that the crew delivers through a pull request.
A work-item quest is one quest per item: the issue's acceptance criteria
plus the delivery steps the crew moves it through. World assembles it from
records it can already read. It doesn't ask an LLM.

The quest is the parent of its agents' own quests. Agent quests are the
checklists, plans, goals and loops World reads from each agent's transcript
today (#282, `server/src/agent/quest.ts`). A worker's "Build lamp dimming
5/5" belongs to the item's "#41 Desk lamps dim when idle 4/9".

It uses World's existing quest words and look: the ⚑ pennant, progress as
"4/9", step marks (✓ done, ▸ active, ! blocked, · pending) and the status
words In progress, Blocked and Complete. The colours are the same as well:
blue for active, amber for blocked and green for done.

## Try the mock

1. Open `index.html`. Town shows the Lantern room with two work-item tables.
2. Click the #41 table's pennant. The quest opens with 4 of 9 steps done. The
   current step, Review, is held by the fixer, and ▾ marks the fixer's seat.
3. Choose **Blocked on CI**. The pennant turns amber, and the CI step and the
   banner say why.
4. Switch to **Board** and **Chat**. They show the same quest and progress.
   In Chat, the agent's quest row has a ↑ line naming its work item. Click it
   to open the item's quest.
5. Click #43's pennant. Its issue has no acceptance section, so the quest
   shows the seven delivery steps only.

Other scenarios: **Blocked: your answer**, **Blocked: finding**, **Ready to
try** and **Done**. The URL hash keeps the state, for example
`index.html#s=ci&v=board&q=41`.

## Steps and their records

Every step is read from a GitHub record or a crew label. The crew's labels
are the ones the herdr-crew dispatcher sets.

| Step | Read from | Done when | Blocked when |
| --- | --- | --- | --- |
| Each acceptance criterion | Items under the issue body's `## Acceptance` heading, checkbox or bullet | Its box is ticked (see decision 1) | A review names it as not met |
| Ready | `crew:ready` label on the issue | The label was applied | — |
| Claimed | `crew:working` label | A worker took the item | — |
| PR opened | The pull request that closes the issue (`Closes #N`) | It exists | `crew:blocked`: the worker asked one question on the issue |
| Review | The PR's reviews, plus `crew:review` and `crew:fixing` | The review passes, or its fix is checked | A blocking finding remains after the one fix run |
| CI | The PR's checks; `Delivery checks` is the required aggregate (`crew:ci` while it waits) | `Delivery checks` passes | It fails |
| Ready to try | `crew:try` label | The preview is up | — |
| Merged | The PR's merged state; the issue is closed | You merged it (until then you hold this step) | — |

- **Who holds a step.** A step's holder is the seat in the item's Herdr tab
  (`crew-<issue>`) whose run is on that step: worker, reviewer, fixer or
  checker. When the step waits on you, the holder is "you". World already
  links agent panes to their pull requests by branch through its work links
  (`server/src/sources/links.ts`), and crew branches are named `crew/<issue>`.
  An agent's quest is linked to its item the same way.
- **Status.** A quest is blocked when any step is blocked, done when every
  step is done, and active otherwise. The banner names the blocking record:
  the open question, the failing check or the finding.
- **Fixed step count.** Review is one step. Its rounds show as notes, such as
  "Round 1: 2 findings → fixed → checked". A new round never adds a step, so
  progress doesn't go backwards (decision 3).
- **No acceptance section.** The quest shows delivery steps only and says so.

## Where it shows

- **Town.** A pennant and progress bar stand on the item's table, and its
  seats sit around it with their own small pennants. Tables depend on pods as
  tables (#460, PR #521). The mock only borrows the idea, and this proposal
  doesn't change that work.
- **Board.** The item's card shows the quest chip ("⚑ 4/9"), a progress bar,
  the current step with its holder, and each seat's own quest chip with ↑.
  It could also sit on a Board group frame (#356).
- **Chat.** The agent's compact quest row gets a second line, "↑ Part of #41
  … ⚑ 4/9", which opens the item's quest.

The existing agent quests (#282) stay as they are. This proposal only adds a
link from each one up to its item.

## Out of scope

Product code, server reads, GitHub calls, changes to agent quests, and pods
as tables. Reading the records reuses World's GitHub source
(`server/src/sources/github.ts`). A build would add issue bodies and labels to
what it reads.

## Decisions for the owner

1. **Who ticks acceptance boxes?** *Recommended:* the reviewer's result lists
   which criteria it confirmed by number, and the dispatcher ticks those boxes
   in the issue body. The issue stays the one record, and no LLM reads prose.
   *Alternatives:* only you tick them while trying the preview, or criteria
   count as done only at merge.
2. **Which items get a quest?** *Recommended:* crew items first, meaning
   issues with a `crew:*` label, because their records are complete.
   *Alternative:* every issue or pull request World's GitHub source already
   lists, with only the delivery steps that apply.
3. **One Review step, or one step per round?** *Recommended:* one Review step,
   with its rounds as notes. The step count stays fixed, so progress never
   goes backwards. *Alternative:* one step per round, which shows every round
   but makes "4/9" become "4/11" when a new round starts.
4. **When a quest waits on you, where do you answer?** *Recommended:* the
   blocked step links to the existing Needs you entry, and the quest adds no
   inbox of its own. *Alternative:* answer directly in the quest window.
5. **Where does the Town pennant go before tables exist?** *Recommended:*
   build the read model with Board and Chat first, and put the Town pennant on
   tables when #460 lands. *Alternative:* show an interim pennant at the
   holding seat's desk now.
