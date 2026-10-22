## Context

World is one Bun service and a same-origin browser. Optional cost metrics
(`server/src/world/observability.ts`) already show the pattern for an optional
external provider: the service performs bounded requests on demand, settings
live in `settings.json`'s `custom` block, and the browser sees display-safe
results only. Sources reuse that pattern rather than adding a plugin framework.

## Prior art

Ideas only were taken from these Herdr plugins; no code was copied.

- `wyattjoh/herdr-plugin-gh-pr` (no licence file): PR status for the focused
  pane's branch through `gh pr view` and `gh pr checks`, rolled up worst-first
  into `#123 ✓/✗/●`, written as the pane metadata token `pr` with source
  `gh-pr`. World uses the same rollup and glyphs, and reads all PRs in one
  GraphQL request instead of per-pane CLI calls.
- `a2u/herdr-jira` (no licence file) and its MIT fork
  `hanbong5938/herdr-jira-worktree`: named JQL filters, Cloud email plus token,
  `/rest/api/2|3/search/jql`, delegate an issue to a running agent, check an
  issue out into a worktree.
- `kiitosu/herdr-jira-board` (MIT): Jira kanban by status category, a Claude
  session launched per card, live session badges on cards.
- `drewbitt/herdr-jiratui` (MIT): send the selected issue to an idle agent.
- `ogulcancelik/herdr-plugin-github-start` (no licence file): start or resume a
  named Codex, Claude or Pi session from an issue, PR or discussion URL.
- Worktree problem, not implemented here: `devashish2203/herdr-worktrunk`
  (MIT) maps worktrunk worktrees to Herdr workspaces; `NathanFlurry/
  herdr-plugin-jj-workspace` (MIT) creates and removes Jujutsu workspaces as
  Herdr workspaces.

## Decisions

- **Monolith, plug and play.** Sources ship inside World; there is no
  separate install. Each source is enabled unless switched off, so
  installation gets everything and a missing prerequisite degrades to a plain
  "not connected, here's how".
- **Demand-driven refresh.** The service refreshes a source only while a
  browser asks, at most once a minute (five seconds when the user asks for
  a refresh), one request at a time per source; a
  failed refresh keeps the last items. There are no webhooks, which would need
  a public endpoint. Links are recomputed at most every 15 seconds.
- **GitHub through `gh`.** One `gh api graphql` request reads open PRs the
  user authored, was asked to review or is assigned, PRs merged in the last
  seven days and assigned issues, each with review decision, mergeability and
  the head commit's check rollup. The owner's existing sign-in is used; World
  stores no GitHub credentials.
- **Lanes.** A PR is Merged when merged; Fixing when changes are requested,
  checks fail or it conflicts; In review when a draft or checks run; Ready to
  merge when approved; Green when checks pass without approval; otherwise In
  review. Tickets use Jira's status category (To do, In progress, Done);
  assigned GitHub issues are To do.
- **Jira Cloud only.** `GET /rest/api/3/myself` checks the credentials and
  tells assigned from watched tickets; `POST /rest/api/3/search/jql` reads up
  to 100 tickets. The default filter is assigned or watched tickets that are
  not done or changed in the last week.
- **Secrets stay on the service.** The Jira token is written to a private
  0600 file, named per settings file like the session signing state. The
  browser gets `tokenSet` only and the token field is write-only.
- **Links.** For each agent pane World uses its reported checkout path, else
  its pane directory, else its workspace's checkout, and reads the branch and
  GitHub remotes there (locally, or over SSH for an SSH profile; Windows hosts
  are skipped). At most 32 checkouts are read per refresh, four at a time,
  each cached for two minutes. A PR links when its head branch matches and its
  base or head repository is one of the checkout's remotes; an agent-reported
  PR URL links directly. A ticket links when the branch names its key.
- **Views.** Board's Work lens is an overlay with its own scrolling, outside
  Board's gestures. Town's badge is part of the desk's DOM nameplate, so it is
  crisp, clickable and never overlaps neighbouring desks' chips.

## Follow-ups

- Start an agent from an issue, PR or ticket (github-start, jira-board).
- Send a ticket or PR to a running agent (jiratui, herdr-jira).
- Look up a PR for an agent branch that is not among the user's own PRs.
- Jira Server / Data Center with a personal access token; named filters.
- Worktree per ticket (jira-worktree, worktrunk, jj-workspace ideas).
- Read the `gh-pr` plugin's `pr` pane token as another link signal.
