# GitHub pull request detail health

World reads the GitHub work list separately from each authored open pull
request's checks, reviewer RESULT evidence, changed files and screenshots.
A successful list refresh does not mean those details were read again.

The shared pull request card shows **GitHub details fresh**, **stale · cached
evidence**, or **unavailable**, and the time the details were read. Missing or
malformed older metadata shows an unknown read time and cannot confirm
readiness. These observations come from GitHub through the service user's
existing `gh` session; they do not authenticate the author of a RESULT claim.

## When a detail read fails

World reuses unchanged detail for up to ten minutes. An expired read, a failed
refresh, an unanswered or partial detail response, or an unavailable source
cannot renew that authority. Matching cached evidence remains useful to
inspect, with its original time and stale label. A new head or changed list
stamp never inherits the previous detail.

The browser also checks expiry when rendering and schedules retirement at the
original deadline. An idle card becomes stale, withdraws readiness and closes
an open merge sheet without waiting for the next source poll. A ready hint
supplied by its parent is also withheld unless the card's current rules pass.
Its local clock
can withhold freshness but cannot renew the detail read time. The service keeps
its independent clock and admission checks for every merge.

While detail is stale or unavailable, findings and screenshot readiness stay
unknown. Compact CI uses the separately reported list rollup instead of
presenting old detailed check dots as current. **Details** retains the cached
check and reviewer links under the health label. Choose **Refresh Sources**
to try again; the service's request and frequency bounds still apply.

**Merge…** returns only after current qualified detail is available. The service
checks detail expiry and source configuration again after its live GitHub
head/review read, before dispatching a merge. It still pins the operation to
the head the viewer confirmed and never bypasses native branch protection.
Close and Mark ready use their existing prerequisites; a detail-only failure
does not itself forbid those operations. A disabled or unavailable source
cannot authorize a new operation.

## Bounds and recovery

Detail requests contain at most ten pull requests and a refresh reads at most
twenty. Unread and changed records retain priority, followed by pending/old or
failed detail in age order. Deferred unread entries remain unavailable until
their own read succeeds. Recovery records a new detail timestamp; list success
alone leaves the previous timestamp unchanged.

Disabling or reconfiguring the source isolates its cache from older in-flight
requests. A retired result cannot populate the replacement configuration's
cache or dispatch a pending merge. This does not undo a native operation that
was already dispatched before a configuration change.

The injected clock/process and browser projection regressions are in
`server/src/sources/pullRequestFreshness.test.ts`,
`shared/pullRequestFreshness.test.ts`, and
`web/src/world/PullRequestFreshness.test.ts`. They use synthetic data and make
no claim about complete GitHub history or network availability.
`web/src/world/PullRequestExpiry.test.ts` additionally advances the observing
clock on a mounted card without supplying another source snapshot, and checks
visual retirement, merge-sheet withdrawal and timer cleanup.
