# Work Sources notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Settings enables/configures GitHub and Jira; Board Work and Town desk badges show their items.
- Pull-request cards and confirmation sheets expose head-qualified merge/close/ready actions.
- Phone cards use the same source facts and confirmations.
- TUI/core agent links require qualified checkout/session evidence; sources run on the World service.

**Code:**

- `shared/worldSources.ts`
- `server/src/sources/service.ts`
- `server/src/sources/github.ts`
- `server/src/sources/actions.ts`
- `web/src/world/worldSources.ts`

**Tests:**

- `server/src/sources/github.test.ts`
- `server/src/sources/actions.test.ts`
- `server/src/sources/pullRequestDetail.test.ts`
- `server/src/sources/links.test.ts`

**Pitfalls:**

- Weather and Shipyard have separate specs; the warehouse reuses source observations.
- A successful list refresh cannot refresh expired PR action detail.
- Shared GitHub login does not establish reviewer identity; explicit sender claims do.
- Exact head, source generation, detail expiry and protection still apply at dispatch.
- PR action verbs are intentionally absent from the World CLI.

## Usage reference

### Sources: GitHub and Jira

World reads your pull requests and tickets itself; there is nothing else to
install. These two work sources are on by default. Open **Settings → Integrations**
to see each source's state, switch it off or configure it under **Settings**.
The separate [Weather source](../../world-weather/notes.md#weather-source) is off by default.

- **GitHub** uses the GitHub CLI signed in as the user that runs World (`gh
  auth login`): open pull requests you opened, were asked to review or are
  assigned, pull requests you opened that were merged in the last 7 days
  (change the window in **Settings → Integrations**, 1 to 90 days) and issues
  assigned to you, each with review state, checks and mergeability. World
  stores no GitHub credentials. Work's **Merged** and **Done** columns group
  cards by the day each was merged or resolved, newest day open; tap an older
  day to open it. GitHub history is bounded to 400 pull requests and one
  minute per refresh, after your open PR action details. If history is
  shortened, World keeps its last complete list, reports the oldest merge
  date actually observed (or no confirmed date), and asks you to shorten the
  window in **Settings → Integrations**; partial history does not authorize actions.
- **Jira Cloud** needs a site, your account email and an API token. The token
  stays in World's private storage on the service and is never shown again;
  changing the site or email removes it, so enter the token again with them.
  The filter (JQL) defaults to tickets assigned to you or that you watch.
- An agent is linked to the pull request whose branch its checkout is on (the
  branch's own repository, or fork, is a GitHub remote of that checkout), to a
  pull request it reported with
  `herdr-world agent-checkout --pr`, and to a ticket whose key its branch names
  (for example `abc-12-fix-login` and `ABC-12`). Its Town desk shows the badge
  on its nameplate (`#123 ✓`, `#123 ✗`, `#123 ●` or `ABC-12`), its Board tab
  card shows the same badge, and Board's Work lens names it on the card. Town's warehouse shows every open pull
  request for you as a crate, including those whose agent has gone. A link holds only for the agent session and
  Herdr runtime it was made in.
- **Your open pull requests** get a card in Work with CI on the head (a dot
  per check), each explicitly attributed rev agent's latest `RESULT #N: …`
  from a formal review or comment, and your merge rules: not a draft, every finding confirmed, CI
  green on the head, mergeable, and screenshots for a change to the web app
  or site. Each rule shows ✓, ✗ or ? (World can't tell; a confirmation of an
  older head is ?). **Details** lists the failing checks with links, the
  reviewers, the head commit and how far it is behind its base. RESULT posts
  without a clear reviewer claim stay visible as **Unknown reviewer**, with
  **View RESULT source** links, and cannot confirm readiness. Names are sender
  claims, not verified identities; a shared GitHub login does not identify a
  crew reviewer. Reviewed heads come only from review commit metadata or an
  explicit, unambiguous SHA, never a timestamp. A card says
  **Ready to merge** when every rule holds, and **Stalled** when CI failed on
  the head and its agent is idle.
- Cards show GitHub detail health and its own read time. Expired or failed
  reads retain matching **stale · cached evidence**; list success does not
  refresh it. Findings/screenshots stay unknown and World requires fresh
  detail before merging. Use **Refresh Sources** to retry. See
  [detail health and bounds](../../../../docs/github-pr-detail-health.md).
- **Merge…**, **Close…** and **Mark ready…** (for a draft) open a sheet that
  says exactly what happens; nothing runs until you confirm. Merge makes a
  merge commit, keeps the branch and refuses if anyone pushed since you
  looked; failing rules make it **Merge despite N failing rules**. GitHub's
  answer, or its reason for refusing, shows on the card. World never bypasses
  branch protection: while GitHub requires a review, the card offers **Open
  on GitHub** and **Copy merge command** instead of Merge. The same card
  opens from the pull request's badge on its agent's Town desk (a sheet on a
  phone).
- A source that is not signed in or configured says how to connect it (Work
  shows a quiet **Connect** button for one you never set up, which opens
  Integrations at that source); the views work
  without it. The service refreshes at most once a minute while a visible
  browser tab shows sources, answers at once with what it has while a refresh
  runs, and the browser never contacts GitHub or Jira.
