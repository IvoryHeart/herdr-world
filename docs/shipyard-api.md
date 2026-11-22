# Shipyard data API and CLI

Shipyard v1 reads GitHub release pipelines and local World listener reports.
Town's harbour and the Work lens's Releases tab present it through one browser
store and view model (`web/src/world/shipyard/`). Both use this one contract, independent of the Herdr TUI or herdr-core connection selected. There
are no release, tag, install, preview-start or deployment mutations.

## Try it

These commands use synthetic responses through the real acquisition/service
projection and need no World service, sign-in or network:

```bash
herdr-world shipyard demo --json
herdr-world shipyard demo --scenario stale --json
herdr-world shipyard demo --scenario limited --json
```

From a source checkout, replace `herdr-world` with `bun server/src/index.ts`.
The first returns a stable release, a prerelease, a passing main workflow, one
waiting PR and two synthetic previews. Only the fresh preview has an open URL.
The second retains the same pipeline with `state: "stale"`; the third reports
201 commits ahead, keeps 200 witnesses and sets `waiting.complete: false`.
Other scenarios: `empty`, `diverged`, `old-head`, `no-actions`, `offline`.
Demo preview addresses are illustrative; no listeners are started there.

For live data, use the existing service's CLI configuration (or the preview's
`HERDR_WORLD_URL` and matching `HERDR_WORLD_DATA_DIR`/`HERDR_WORLD_TOKEN`):

```bash
herdr-world shipyard list --json
herdr-world shipyard show example-org/widgets --json
herdr-world shipyard show example-org/widgets --refresh --json
```

Replace the synthetic repository with a repository the service user's `gh`
can read. GitHub must be on in Settings → Sources. The CLI checks loopback,
uses the existing private CLI token, refuses redirects and never opens a browser.
Exit codes: 0 for data or a refresh still running, 1 for unavailable data or
transport failure, 2 for invalid arguments. Stale retained data exits 0 and is
explicitly labelled. `demo` exits 0 even for a simulated unavailable source.

## Calls

All browser calls use the existing authenticated, same-origin World HTTP
boundary and return `Cache-Control: no-store`. No credentials or raw provider
errors appear in responses. Each response is a point-in-time observation.

| Call | Input | Response |
| --- | --- | --- |
| `GET /api/world/shipyard` | None | Catalog: `observedAt`, the GitHub `repositories` of the projects open in World's rooms and spaces, `projects` (each `{repo, name, rooms}`, `repo` null without a GitHub remote), `pending` (folders still being read), `omitted` (open folders past the bound), `instances`, `limits`. No GitHub refresh. |
| `GET /api/world/shipyard?repo=example-org/widgets` | One `repo`, github.com `owner/repository` only | Snapshot described below; starts a due bounded read. |
| `POST /api/world/shipyard/refresh?repo=example-org/widgets` | One `repo`, **no body** | Same snapshot; requests a refresh subject to five-second cooldown. |
| `POST /api/world/shipyard/cli` | Local CLI only: `{ "command": "list", "params": {} }` or `{ "command": "show", "params": { "repo": "example-org/widgets", "refresh": true } }` | `{ "ok": true, "actor": { "label": "local Shipyard CLI", "verified": false }, "result": <catalog or snapshot> }`. Errors use existing `{ok:false, code, error}`. |

The CLI route requires a loopback peer and private CLI bearer token, and rejects
any Origin header. Browser session cookies do not authorize it. Browser routes
use session admission and do not accept that token as a browser session.

Methods other than those listed return 405; unknown Shipyard paths/actions
return 404 (CLI unknown commands: 400). Invalid names, duplicate/unknown query
parameters, refresh bodies and extra CLI fields return 400 **before** GitHub is
read. Missing/invalid authentication returns 401/403 under existing policy.
A disabled, signed-out or failed source still returns a 200 snapshot describing
that state; it is not an empty successful pipeline.

## Examples and consumer mapping

Catalog example (instance records are the same as the snapshot's):

```json
{
  "observedAt": 1767484800000,
  "repositories": ["example-org/widgets"],
  "projects": [
    { "repo": "example-org/widgets", "name": "widgets", "rooms": 2 },
    { "repo": null, "name": "scratch-notes", "rooms": 1 }
  ],
  "pending": 0,
  "omitted": 0,
  "instances": { "items": [], "complete": true, "detail": null },
  "limits": { "repositories": 64, "pipelines": 96, "concurrentReads": 4, "releases": 50, "tags": 100, "workflows": 100, "commits": 200, "prsPerCommit": 5, "instances": 64, "refreshMs": 60000, "forcedRefreshMs": 5000, "deadlineMs": 60000, "requestMs": 10000, "outputBytes": 4194304, "waitMs": 2000, "instanceLeaseMs": 45000 }
}
```

Snapshot example (the `limits` object is identical to the catalog; SHA values
below are shortened for readability, actual responses use full 40-character
SHAs). GET and refresh return the same shape; CLI `show` wraps it in `result`:

```json
{
  "observedAt": 1767484800000,
  "repo": "example-org/widgets",
  "source": "github",
  "state": "fresh",
  "detail": "GitHub release pipeline observed. Section limits apply.",
  "checkedAt": 1767484800000,
  "lastSuccessAt": 1767484800000,
  "refreshing": false,
  "retryAfterMs": 5000,
  "data": {
    "repo": "example-org/widgets",
    "main": {
      "branch": "main", "sha": "aaaa…", "health": "pass",
      "workflows": {
        "items": [{ "id": 17, "workflowId": 7, "name": "Checks", "sha": "aaaa…", "status": "completed", "conclusion": "success", "updatedAt": 1767398400000, "url": "https://github.com/example-org/widgets/actions/runs/17" }],
        "complete": true, "detail": null
      },
      "url": "https://github.com/example-org/widgets/actions?query=branch%3Amain"
    },
    "releases": {
      "items": [{ "id": 1, "tag": "v1.0.0", "version": "1.0.0", "name": "v1.0.0", "publishedAt": 1767225600000, "channel": "stable", "url": "https://github.com/example-org/widgets/releases/tag/v1.0.0" }],
      "complete": true, "detail": null
    },
    "tags": {
      "items": [{ "name": "v1.0.0", "sha": "bbbb…", "url": "https://github.com/example-org/widgets/tree/v1.0.0" }],
      "complete": true, "detail": null
    },
    "waiting": {
      "state": "ready", "baseline": { "releaseId": 1, "tag": "v1.0.0", "sha": "bbbb…", "channel": "stable" },
      "mainSha": "aaaa…", "aheadBy": 1, "commits": ["cccc…"],
      "pullRequests": [{ "number": 42, "title": "Ship the synthetic widget", "mergedAt": 1767398400000, "mergeSha": "cccc…", "url": "https://github.com/example-org/widgets/pull/42" }],
      "complete": true, "detail": null,
      "compareUrl": "https://github.com/example-org/widgets/compare/bbbb…...aaaa…",
      "pullRequestsUrl": "https://github.com/example-org/widgets/pulls?q=is%3Apr%20is%3Amerged%20base%3Amain"
    }
  },
  "instances": {
    "items": [{ "id": "111111111111111111111111", "generation": "11111111-1111-4111-8111-111111111111", "version": "1.0.0", "repo": "example-org/widgets", "branch": "preview/widgets", "sha": "aaaa…", "kind": "source", "port": 19091, "startedAt": 1767484700000, "reportedAt": 1767484800000, "expiresAt": 1767484845000, "state": "fresh", "openUrl": "http://127.0.0.1:19091/", "releaseId": 1 }],
    "complete": true, "detail": null
  }
}
```

The shared compile-time model is `shared/shipyard.ts`. Consumers map (`web/src/world/shipyard/shipyardModel.ts`):

- Main health → `data.main.health`, head SHA and `workflows` provenance. It
  summarizes the latest observed attempt of each workflow on that head. It does
  **not** evaluate branch protection or authorize shipping. No runs, unknown
  conclusions or a shortened workflow window cannot produce `pass`.
- Waiting cargo → `data.waiting.pullRequests`; use `complete` and `state`
  before displaying totals or “nothing waiting”. `commits` lists every commit in
  the comparison; it does not say how a commit reached main (a PR merged with a
  merge commit also brings its feature commits), so never call the commits
  outside `mergeSha` direct pushes. This is all-author repository data, independent
  of Sources' personal PR filters and merged-days window.
- Release ships → `data.releases.items` (`stable`/`prerelease`, publication date,
  version and safe URL). Drafts are excluded; bare tags are separate evidence.
- Deployments → `instances.items`, joined through `releaseId` only for the same
  repository and an exact normalized tag/version. This is an observation, not a
  claim that a version string verifies installed contents. Unknown matches stay
  null. Instances are included independently of GitHub availability.
- Navigation → release/PR/compare URLs and fresh `openUrl`. The PR-list link is
  the repository's broad merged-main search; the exact next-release list is the
  returned PR array. No timestamp filter guesses ancestry. Open these as ordinary
  links in a new tab with `noopener`; never embed another World origin into this
  app or send the current session/token to it. Loopback preview links work from
  a browser on the **service machine**, not a phone on another machine.

A snapshot with no successful read has `data: null`, null success timestamp and
`state: "unavailable"`, `"not_connected"` or `"disabled"`. For example a disabled
read returns `state: "disabled"`, `detail: "GitHub is switched off in Sources."`,
`data: null`, `refreshing: false`; local instances can still be present.
After a failed refresh, retained data has `state: "stale"` and its original
`lastSuccessAt`; `checkedAt` records the failed attempt. Treat every nested
GitHub value as stale, including previously passing health. Optional section
failures instead have `complete: false` and explanatory `detail`. A fresh outer
snapshot does not make an incomplete section complete. Retained successful data
also becomes stale after 60 seconds until refreshed.

## Evidence and bounds

The baseline is GitHub's designated latest published stable release, read
separately so it survives a full display window. With no stable release and a
complete display window, use its newest published prerelease. Without a provable
baseline, report `no_baseline`. Resolve the tag to a commit, pin main, compare
those immutable SHAs and read associated PRs in batches of 25 commits. Only merged
PRs targeting main whose merge commit is in that comparison are waiting. A
moved tag is observed at read time; this does not attest historical tag integrity.
Divergence reports `diverged`. Missing GitHub permissions or comparison data
reports `unavailable`. Shortened commit/PR associations report `limited`. Dates
never determine membership. A complete zero-PR list can still contain
commits; use `aheadBy` too.

Each source read has a 60-second total deadline, 10 seconds per request and a
4 MiB accepted-output limit per response. Limits: 50 releases (including the
separately read latest stable), 100 tags, 100 head-qualified workflow runs, 200
comparison commits, five associated PRs per commit, at most 17 external calls
including authentication. Full release/tag display windows conservatively set `complete` false; workflow
counts and comparison counts can prove their exact bounded window complete. At most 96 repository cache entries exist and **four** repository
refreshes run at once; others wait for a slot. When every entry is reading or
waiting, a new repository is not admitted: it returns `refreshing` with a retry
hint and is asked again. Normal reads refresh after 60 seconds; forced reads wait at least
five seconds after an attempt. Requests wait up to two seconds, then return
`refreshing` and `retryAfterMs`. No background GitHub polling or automatic retry
runs. While a repository waits for a slot it returns its current observation and
a retry hint. The catalog is the projects open in World, not an inventory of
every accessible repository: each room or space on a current, non-stale
connection with a folder (checkout, else its own, else its first terminal's),
read with read-only `git rev-parse`/`git remote -v` on that connection's host
(PowerShell on Windows), cached per connection ID, generation and folder for 60
seconds, at most four at a time with a six-second deadline. The GitHub remote is
`origin`'s, else the first github.com remote; projects sharing one are one.
A folder that is not a Git checkout, has no GitHub remote or cannot be read is
a project with `repo` null, never dropped.
Folders past 64 are counted in `omitted`, never dropped silently. Cached
topology of a failed host contributes nothing. Disabling/changing the GitHub settings
invalidates its cache and fences in-flight results. Credentials stay in gh;
World stores no new credentials.

## Local instance registry

Only listeners running this implementation self-report. Each instance writes a
private 0600 file in `<data directory>/instances`, renews its 45-second lease every
15 seconds, and removes its own report on graceful stop. A crash leaves a stale
report after expiry. The stable ID is an opaque hash of the data-folder identity;
the generation changes on restart. Source metadata is captured from World's own
checkout at startup, not an agent's cwd; installed builds know their version and
World repository, with unknown branch/commit. Filesystem paths, remote URLs,
PIDs and secrets never enter responses. Registry reads examine at most 64 entries
and 4 KiB per report; malformed, symlinked, oversized or overflowing entries mark
the window incomplete. Old stale reports remain display-only until that data
folder next reports or its registry is removed outside World.

Different isolated data folders are separate by default. To see several local
previews together, explicitly set `HERDR_WORLD_INSTANCE_REGISTRY_DIR` to the
**same private directory** for each World process when starting it. There is no
network registration endpoint, port scanning, remote probing, remote host URL
collection or inference from runtime connections. A fresh record confirms only
that World recently reported; it does not promise the port still answers.
Expired records have no open URL. A listener on a specific non-loopback interface
also has no guessed open URL. IPv4/IPv6 loopback links contain no login token.

A shared registry also lets Worlds attached to the same runtime show each
other's open owner questions in Needs you. Each report carries a small `asks`
block: the World's display name, a random token for this run, and hashed keys of
the runtimes it is attached to or holds open questions for. That block is never returned by
`shipyard.instances.get`. Another World reads or closes those questions only
through `POST /api/world/ask-peers` on loopback, with that token and no
browser `Origin`; the question's own World records the one answer and delivers
it on the asker's own connection.

## Verification map

- Acquisition and graph/health limits: `server/src/shipyard/github.test.ts`.
- Cadence, single flight, retention, cache bounds and generation fencing:
  `server/src/shipyard/service.test.ts`.
- Local lease, expiry, private files, URL restrictions and malformed reports:
  `server/src/shipyard/instances.test.ts`.
- Calls, invalid input and loopback/token refusals:
  `server/src/shipyard/http.test.ts`.
- Native CLI, rare-state demos and output:
  `server/src/cli/shipyard.test.ts`.
- Real composed listener admission, actual ephemeral port and native transport:
  `server/src/service/shipyard.test.ts`.

Presentation: `web/src/world/shipyard/shipyardModel.test.ts` (view model),
`shipyardStore.test.ts` (reads, refresh, repository choice),
`web/src/world/town/townHarbour.test.ts` (lot geometry) and the isolated DOM
suite `web/src/world/town/TownShipyard.dom.test.ts` (harbour, fold, Releases
tab, links and refresh).
