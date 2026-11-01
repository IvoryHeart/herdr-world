# World identity storage

`WorldStorage.ids.issue(kind)` reserves an ID in `world.sqlite` and resolves only
after the worker commits. A kind is a lowercase letter prefix; the suffix is
eight independent random symbols from `0123456789abcdefghjkmnpqrstvwxyz`.
The store checks its shared registry and retries collisions, with a bounded
failure if the random source keeps repeating. Callers await issuance before
using the ID. An unused reservation is harmless and is never recycled.

The SQLite ledger uses this allocator for asks, answer occurrences, results,
history entries, operations and attention intents. Migration registers existing
SQLite IDs and historical references without renaming them. Ledger JSON imports
retain their existing record IDs and reserve them in the import transaction.
The existing import rule still strips unverified answer-recipient, occurrence
and delivery annotations. An imported ID may use any earlier format or prefix.

Reservations survive record and replay pruning and reopening the service.
A stopped data-folder backup carries its reservations; restoring it does not
restore an allocation counter or clock. New allocations draw fresh randomness.
This does not establish mathematical uniqueness against IDs absent from the
restored copy; collision checks cover the registry that copy contains.
Close refuses new allocations and drains admitted ones through the same worker.

`WorldStorage.bindings` stores verified source captures alongside the ID registry.
Each binding has its own store-issued ID, its owning record/slot, adapter and source
instance, entity kind, native ID and terminal/session evidence. Listing/get reads
are unresolved captures. `resolve` returns an ephemeral qualified target only
when fresh evidence attaches; callers recheck the exact runtime lease before
acting. Incarnation and generation are request/target fences, never durable identity.
Each binding has a separate record revision. A caller captures that revision
before reading a source and supplies it to `resolve`; a newer binding edit
refuses the old observation without changing the saved binding.
An explicit unknown session is represented by terminal evidence without a session
fingerprint. Labels, directories and agent kinds prove no continuity.

The declared policies are:

| Record kind | Continuity | Absence | Ended lifetime |
| --- | --- | --- | --- |
| Board string | World's witnessed moves or an explicit user decision | Current observed close or qualified not-found | Needs a home |
| Appearance | World's moves and a uniquely witnessed terminal in a complete listing | Every witnessed terminal absent from a complete current list | Clear |
| Tab colour | Appearance's paths | Appearance's absence or observed tab close | Drop |
| Agent interest | Its terminal on its original source | Complete current pane list omits the terminal | Drop |
| Watchlist | Uniquely witnessed terminal on its original source | Complete current terminal absence | Clear |
| Desk marks/recent opens and completion seen | Witnessed terminal and captured known session; explicit unknown binds to terminal | Complete current terminal absence or positive known session replacement | Clear |

Offline, partial, filtered and stale observations preserve saved native IDs and
witnesses and authorize nothing. Duplicate native IDs, terminals or sessions make
a complete observation ambiguous: it attaches and ends nothing. A reused native
ID with other evidence is unconfirmed for a Board string; appearance's existing
complete-list reclamation rule still applies. Weak empty workspace/tab anchors
remain attached while their target exists and never authorize Send.

The compatible Board document is now a committed read projection over separate
SQLite concern tables. Startup imports its exact backed-up legacy JSON once;
subsequent Board writes and binding captures commit in the same worker savepoint.
Only strings, appearance, qualified tab colours and terminal interest create
bindings; layout preferences retain native-ID reuse behavior. All capture
pages are prepared before any identity is reassigned. Inheritance requires one
old match for the new record and one new match for that old record across the
complete capture set, so splits, merges and page order cannot choose an ID.
Get/patch RPCs expose acknowledged state; a patch replies only after its rows and
bindings commit. An unchanged capture performs no binding import work, so layout
edits do not create identities. Capture pages are bounded inside the atomic Board
operation. Interrupted imports cannot resolve
legacy targets until their World document has been reconciled. Import keys locate
legacy records and never become new World IDs. Appearance moves keep their
existing World record and binding IDs when exactly one disappearing legacy key
has the declared witnessed continuity; ambiguous candidates are never merged.

Board Send first resolves its saved string against a complete current native pane
list, then retains the existing fresh recipient/session and prompt checks. No
other host is tried. This does not make Herdr's read-then-prompt atomic or add an
exactly-once claim.

Appearance and interest pruning check every reported pane, terminal and known
session identity through the resolver's shared ambiguity predicate before forming
an absence set. This includes snapshot proposals and their fresh native rechecks.
Existing complete terminal-only projections retain their terminal-absence rule;
missing pane IDs and explicit unknown sessions do not invent identities.

Card positions, pins, folds, and workspace/host colours remain native-keyed layout
preferences. They carry no binding and are inherited on ID reuse. Profiles and chimes now use the
[SQLite storage port](DEPLOYMENT.md#agent-profile-storage); their existing
browser record-creation protocol remains unchanged. Store-issued profile and
remaining JSON-owned ID creation are separate work. Desk marks, watchlists and
completion seen state now use the [durable terminal-mark family](DEPLOYMENT.md#desk-watchlist-and-completion-storage).
Watch replies carry the World record's `watch_id` for exact removal even while
unresolved; a runtime-qualified tuple alone cannot distinguish a reused capture.
Pending agent commands use separate process-local ownership tokens, including
explicit unknown identities. These tokens fence admission without extending any
saved record's lifetime.

The [identity contract](../verification/contracts/world-identity.md) maps M4,
mutation controls and mandatory consumers. The complete `verification:gate`
checks all maintained models; a focused M4 run does not replace it. SQLite tests
use temporary databases; Herdr/OS durability and production consumer behavior
retain their separate integration and platform boundaries.


## Runtime field claims

Conversation replies carry additive `field_claims` for `agent_status` and `session`.
The sources snapshot carries additive `linkClaims`, qualified by connection,
runtime generation, pane, terminal and session, with a `pr_links` field. Each
field exposes all `claims` and its declared `display` projection. Each claim has
its value, delivery channel, author when known and different, observation time,
reported/inferred basis, and an opaque source revision when available. Session
and thread IDs describe an occupant; they never become World IDs.

| Field | Sources | Display rule | Action authority |
| --- | --- | --- | --- |
| Agent status | Current Herdr agent report; World transcript inference | Reported status first; inference only when no report exists | Neither status claim selects a session |
| PR links | Agent report through Herdr metadata; checkout branch matched to GitHub | Both links, retaining each source's provenance, including disagreement | Neither link authorizes merge, close or mark ready |
| Session | Herdr's agent report; a complete Codex thread named by its current title; transcript resolution | Codex title when present, then report, then inference | Send uses the pane's fresh native report/title under its existing qualification checks |

An open transcript tool or latest user message infers working; a latest assistant
message with no open tool infers idle. No supported evidence means no inferred
status. The transcript revision records the file observation used. PR branch
claims keep the checkout read's actual time, including when the resolver reuses
its cache. Checkout observations are scoped by connection, generation, host and
path; a replacement never receives the prior runtime's cached evidence. An
agent-reported PR retains the session fingerprint as its author and
Herdr's state-change sequence when supplied. A reported URL need not appear in
GitHub's fetched items to remain a claim.

A channel replaces or retracts only its own claim. Omission of a reported
session does not prove a new occupant or erase transcript/branch evidence. A
successful complete read can
remove that channel's omitted field; a failed read, a partial listing, another
channel's silence, or ambiguous native identity cannot remove it. For example,
a missing transcript retains prior inference, and a failed git lookup retains
its prior branch claim while a complete metadata observation can independently
remove the agent report. Complete native occupant absence, terminal/session
replacement, and runtime disposal retire that occupant's read model. A positively
resolved Codex title thread is compared with the preceding selected thread ID,
whether it came from a native report, an earlier title or a resolved transcript.
A different positive thread retires the preceding transcript claims even when its
own transcript has not appeared. A matching thread or missing identity evidence
preserves them. A stale native report cannot retire inference for an unchanged
titled thread; the report remains as its own claim. A
missing session witness can carry forward only on the same runtime and terminal.
The source service reads live connection/generation owners separately from
topology, so replacement/removal retires old link claims even while the replacement
is offline, partially listed or still returning a stale snapshot. Older
conversation reads cannot publish over a newer read, and retired source-service
refreshes cannot publish their claim updates.

GitHub connection health is separate from PR catalogue completeness. Every open-PR
search must explicitly reach its last page, and every merged-page result must be
known and reach its last page, before a missing branch match can remove an earlier
claim. A successful bounded or unknown-completeness result can add a positive link
but cannot prove absence. The existing list display stays bounded.

These claims live in memory. They do not write `world.sqlite` or persist marks,
watches or seen state. Existing `agent_status`, conversation binding/fingerprint,
and reported-first Work links remain the compatibility projections, so current
controls and rendering are unchanged. A `display` claim is observation evidence;
it supplies neither a lease nor freshness for an action. PR verbs require
GitHub's own qualified record and existing head/detail checks. Conversation Send
re-reads the pane before applying its declared reported-session/title authority;
it never acts from saved or inferred claim arrays.
