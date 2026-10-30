## Context

See proposal.md for why. This section states only the facts the decisions rest on.

**Today's read path.**
1. A Herdr event makes the service broadcast `world_invalidated` with the connection,
   its runtime generation and a revision.
2. Each browser debounces and requests `world.snapshot`, with one request in flight and
   one queued.
3. The service re-lists the dirty host (`workspace.list`, `tab.list`, `pane.list`,
   `agent.list`), shares that work across requests and caches clean hosts. It already
   hashes each host's raw lists, but uses the hash only to decide on late
   invalidation (`server/src/world/snapshot.ts`).
4. The reply carries every host, projected per browser by its priority hints and the
   watchlist. Large replies travel as credited chunks (Q12, Q13).
5. The browser parses the whole reply, losing object identity, and prepares World,
   Office (Town) and Board topology for every host, whichever view is shown.

Besides the snapshot, five more whole-document channels refetch on change
(`world_board_changed`, `world_ledger_changed`, `world_desk_changed`,
`world_watchlist_changed`, `world_profiles_changed`). The focused store re-lists its
host every 5 s, and each open Desk polls screens and turns.

**Herdr, as observed** (event-class inventory, Herdr 0.9.3, protocol 22, disposable
session; verified against the
[v0.9.3 source](https://github.com/herdrdev/herdr/tree/v0.9.3)):
- Lifecycle events are live-only. They are ordered within one subscription entry, but
  there is no order across event classes, no replay cursor and no snapshot boundary.
- History is a 512-event ring. An overrun sends `events_lost` and closes the
  connection. World turns re-acknowledgement into `session.resync_required`, which
  invalidates the host.
- Payloads cover different subsets. Renames, order lists, one tab's layout and one
  pane's status are complete for what they carry. Creates, closes, moves and exits
  need a re-list, and `pane.moved` changes the pane ID.
- The safe baseline is: subscribe, wait for the ACK, then read while draining events.
  An event during a read makes the read dirty and forces another read. Four separate
  lists are not an atomic host snapshot.
- No event carries World's agent recency (session-file times), its connection
  catalogue or its endpoint availability.
- Terminal IDs are allocated as `term_` plus wall-clock microseconds and a counter
  ([`terminal/id.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/terminal/id.rs)).
  They survive pane and tab moves.
- A restored session keeps pane IDs and each pane's agent session, but not terminal
  IDs or metadata tokens
  ([`persist/snapshot.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/persist/snapshot.rs)).
- `pane.report_metadata` tokens are stored on the terminal (`TerminalState`), not the
  pane ([`terminal/state.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/terminal/state.rs)).
  Limits ([`app/api_helpers.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/api_helpers.rs)):
  32 keys per terminal, 16 per request, keys of at most 32 characters and values of
  at most 80. `pane.list` returns the merged token map without each token's reporter.
- World already writes up to 19 keys per terminal: 15 for checkout reports, 2 for spawn
  stamps and 2 for task summaries.

**Consumers** (consumer inventory, `origin/main` 501a78c6):
- Office and Board topology are prepared on every refresh, whichever view is shown.
- The Board document is a separate dependency: appearance and relations use it
  outside Board too.
- The 5 s poll carries six outputs: recency, status (agent and catalogue), navigation,
  availability, layouts and completions.
- Interest is per resource and per owner. Inspectors on hosts other than the selected
  one must stay current.

**Owner direction.**
- Herdr is the only runtime; interfaces stay general.
- No workflow authoring model.
- Identities are short and local, with `agent://` URIs for global names. Harness IDs
  are claims, never World's identity.
- Offline requests are state-conditioned, never time-expired.
- Per-terminal settings live in Herdr pane metadata.

**Sibling changes.**
- `shared-acquisition` (committee item 14) owns stage 2: poll replacement, pushed
  recency and catalogue, and shared Desk acquisition.
- The composition root (item 9) names the ports this design uses:
  - `Clock { now(), monotonic() }`;
  - `Scheduler { schedule(callback, delayMs) → { cancel() } }`;
  - `WorldStorage`, opened by `openStorage(paths, { clock, scheduler })`;
  - an adapter record keyed by kind, with deps
    `{ config, paths, clock, scheduler, storage, adapters }`.

## Goals / Non-Goals

**Goals**
- Contracts that stages 3–7 of the committee plan implement without re-deciding them:
  observation v1, v2 subscriptions, identity, verbs, adapters, per-terminal settings and
  the effect substrate.
- Each part is independently shippable and verifiable, with no change to look or
  features.
- A verification plan that keeps Q12–Q14 and their consumers mapped at every stage.

**Non-Goals**
- A workflow authoring model: definitions, steps, waits, composition or a DSL.
- A second real runtime, or building for one.
- Shared acquisition and the poll replacement (`shared-acquisition`).
- The `world.sqlite` schema (committee item 10). This design names only what the
  substrate needs from storage.
- Changing any current lifetime: the watchlist, Desk marks and "seen" stay as specified.
- Town scene model, level-of-detail subscriptions, worker placement and React upgrades.
- Plug-ins loaded at runtime.

## Decisions

### 1. Fences stay separate, and a service incarnation is added

| Field | Scope | Changes when | Fences |
|---|---|---|---|
| Connection ID | one saved profile | never | which host |
| Runtime generation | one connection, within one incarnation | each runtime start | late work from a replaced runtime |
| Service incarnation | one service process | each start (random, opaque) | anything that outlives a socket: bases, cursors, persisted captures |
| Transport epoch | one browser socket | each reconnect | late replies on a socket (exists) |
| Observation epoch | one browser store | each disconnect | publication authority (exists) |
| Subscription generation | one v2 subscription | each reset or bootstrap | deliveries from before a reset |
| Source revision | one entity or list, when the source has one | per the source | ordering within one source (Herdr's agent `state_change_seq`, a pane's `revision`) |
| World sequence | one incarnation | each published change | v2 cursor position |
| Record revision | one World-owned record | each commit | optimistic concurrency and history |

**Rules.**
- No field substitutes for another.
- Every dispatch rechecks its own fences.
- Anything persisted or resumable that names a runtime generation also names the
  incarnation, because two fresh connection managers both start at generation 1.

**Wire shape.** The hello carries `service_incarnation`. Pushes on a live socket
inherit it and need not repeat it. Bases, cursors and persisted captures embed it.

**Rejected alternatives.**
- Making generations unique across restarts with a persisted counter: incarnation is
  still needed for cursors and captures, and the counter adds a durable dependency to
  the connection manager.
- One combined version field: it hides which fence failed and reintroduces the
  generation-1 collision.

### 2. Observation v1: a based pull with host tokens

**Request.** `world.snapshot` gains an optional `base`:
`{ service_incarnation, hosts: [{ connection_id, generation, token }] }`. It is bounded
by the 64-profile catalogue limit, and each token is at most 64 characters. The browser
sends a base only when the hello advertises `world_observation_v1`.

**Token.** An opaque string. Equal tokens mean identical projected content for the same
runtime generation. The default implementation is a digest of the serialized projected
host plus its generation, computed once per cache entry and projection key. A cheaper
composite key (raw-list digest, priority key, watch revision) is allowed only with a
test proving that the projection reads nothing else.

**Reply.** It adds `service_incarnation`, and a `token` for every host (null when the
host has no snapshot).

**Server rule, per catalogue host.**
- **Complete observation** when:
  - the base's incarnation differs, or the base has no entry for the host;
  - the generation differs from the current snapshot generation; or
  - the token differs.
- **Unchanged confirmation** otherwise: the host's state, generation,
  `snapshot_generation`, `stale`, `actionable` and errors, its token, and no topology.

**Browser rule.**
- A reply is applied as one publication.
- An unchanged confirmation reuses the retained host object by identity. Its metadata
  is applied, and the existing per-owner revalidation still decides actionability, so
  a confirmation never restores authority the browser's qualified client has retired.
- If the reply confirms a host the browser no longer holds, the browser discards the
  reply and sends one request without a base.
- If the incarnation differs from the held one, the browser drops every retained host
  before applying. The server has already sent complete entries.
- If the service rejects `base` (an older service), the browser stops sending it on
  that socket.

**What stays.**
- `world_invalidated` remains the trigger.
- The one-in-flight, coalesced refresh (Q14) and the 15 s fallback stay.
- Chunked transfer stays for large replies (Q12, Q13).
- Old clients get today's complete reply.

**Rejected alternatives.**
- Pushing replacements on invalidation: the server would need each browser's projection
  state, and Q14's model would change. v2 does push properly.
- Per-entity deltas now: they need the keyed diff, the change ring and cursors, which
  is v2.

### 3. Incremental preparation

1. Unchanged hosts keep their prepared objects by identity.
2. For a replaced host, each room's inputs are fingerprinted: its workspace, tabs,
   panes, agents and the tokens it reads. A room with an unchanged fingerprint reuses
   its prepared room. This builds on the tab-membership index (committee item 4).
3. Host and world counts, attention and summaries are derived from per-room aggregates,
   not whole-world scans. This builds on the prepared shell summaries (item 3).
4. View models are prepared only for interested consumers (item 11, with the consumer
   inventory):
   - Office when Town or its reception consumers are mounted;
   - Board topology when Board is;
   - the Board document always, because appearance and relations use it.

   A newly selected view is prepared before it is presented.
5. **Work counts, blocking in tests.**
   - An all-unchanged reply with identical metadata rebuilds no host, room or view
     model and publishes nothing.
   - One status change prepares one room, its host's aggregates and the world summary,
     and no other room.
   - Incremental output equals a complete preparation of the same observation, checked
     as a property test.

### 4. Herdr observation and repair by event class

The service follows the inventory's baseline: subscribe, ACK, then read while
draining. An event during a read makes it dirty and forces another serialized read.
Subscription loss, `events_lost`, re-acknowledgement, unknown membership or runtime
replacement retire actionability and re-list that runtime. Buffered payloads are never
applied over a read.

An event class may **patch** the host model only when all three hold:
- its payload is complete for the fields it patches;
- its target is in the current runtime's model;
- a drift check has found no difference for that class over the evaluation period.

The drift check compares the patched model with a fresh complete listing on a timer
while patching is active. Every other event invalidates the host for a re-list, which
is today's behaviour and the default.

| Class (inventory) | Patch candidate | Otherwise |
|---|---|---|
| `workspace.renamed`, `tab.renamed` | label | re-list |
| `workspace.moved`, `workspace.reordered`, `tab.moved` | complete order list | re-list |
| `layout.updated` | that tab's layout | re-list |
| `pane.agent_status_changed` | that pane's status and presentation, after membership registration | re-list |
| `pane.updated` | that pane's record, when its workspace and tab are unchanged | re-list |
| focus classes | shared focus hint only | none |
| creates, closes, `pane.moved`, `pane.exited`, worktree and agent detection classes, unknown classes | none | re-list |

Drift is counted and repaired by replacing the host model, with no payload logging. A
class with drift loses its patch permission until reviewed. Patching is optional: the
cost the committee measured comes from browsers × events, which v1 and shared
acquisition already remove. Upstream requests A (snapshot boundary and resumable
observation) and B (output revisions) from the inventory remain drafts for the owner.

### 5. World subscriptions (v2)

v2 is negotiated through the hello capability `world_subscriptions`, which stays off
until the gate (§6).

**Queries.** A query has a registered name, a TypeBox parameter schema, a row key space
and a lane. Rows are `{ kind, key, rev, value }`.
- Observation keys are qualified by connection and runtime generation, so a new
  generation ends the old keys.
- World-owned rows are keyed by World ID.

**Protocol messages.**

| Direction | Message | Meaning |
|---|---|---|
| client → service | `subscribe { sub_id, query, params, since? }` | `sub_id` is unique per socket; `since` is a cursor |
| client → service | `credit { sub_id, sub_generation, page }` | allows one bootstrap page |
| client → service | `unsubscribe { sub_id }` | releases the subscription and its interests |
| service → client | `page { sub_id, sub_generation, page, rows }` | whole rows within the page byte bound |
| service → client | `ready { sub_id, sub_generation, cursor }` | bootstrap complete at the watermark |
| service → client | `changes { sub_id, sub_generation, through, records }` | one atomic batch; `through` is the new cursor |
| service → client | `reset { sub_id, sub_generation, reason }` | discard state; a new bootstrap follows |
| service → client | `refused { sub_id, reason }` | invalid query or parameters; nothing acquired |

**Cursor.** `{ service_incarnation, sub_generation, seq }`, meaning the client's state
reflects every change up to `seq`. `seq` is World's sequence for the incarnation, so a
filtered stream has gaps. Gaps are expected and harmless: a live socket is ordered, and
loss happens only across a reconnect, where the resume rule applies.

**Resume.** `subscribe` with `since` resumes from the next change when:
- the incarnation is current;
- `seq` is at or above the retained horizon; and
- the query and parameters are unchanged.

Otherwise the service sends `reset` and bootstraps.

**Bootstrap.**
1. One synchronous step installs the change watch for the query's key space and then
   captures the watermark, so no change falls between them.
2. Rows are the query's state at the watermark. The snapshot is taken once, copy-on-
   write or serialized, and is never read from a mutating model.
3. Pages hold whole rows. Their byte bound is counted on the wire, including JSON
   escape expansion. A page is sent only against a credit for that socket,
   `sub_generation` and page number.
4. At most two bootstraps per socket transfer at once, as with today's chunk transfers.
5. Changes after the watermark follow `ready`.

**Lanes.**

| Lane | Carries | Rule |
|---|---|---|
| Interactive | RPC replies, command acknowledgements | sent before subscription traffic that hasn't begun transmitting |
| Durable ordered | asks, notices, receipts, workflow signals | never coalesced or dropped; a subscription that can't keep up is reset and re-bootstrapped from durable state |
| Replaceable | observation rows, World-owned state rows | may coalesce by the composition rules |
| Terminal (unchanged) | terminal frames | existing rules |

Each subscription has a queued-byte bound. Past it, the subscription is reset; the
socket closes only when the terminal path's own bound requires it.

The terminal rules are unchanged:
- self-contained repaints may replace pending repaints for the same qualified endpoint;
- incremental output stays ordered and complete;
- interactive priority is limited by bytes already queued on the socket.

**Composition algebra** (replaceable lane, per key, within one entity lifetime):

| Earlier | Later | Composed |
|---|---|---|
| `upsert(v)` | `upsert(w)` | `upsert(w)` |
| `upsert(v)` | `patch(p)` | `upsert(v ⊕ p)` |
| `patch(p)` | `upsert(w)` | `upsert(w)` |
| `patch(p)` | `patch(q)` | `patch(p ⊕ q)`, later field assignment wins |
| any | `delete` | `delete` |
| `delete` | `upsert(w)` | not composed: delivered as the end of one lifetime and the start of the next |

**Composition rules.**
- Patches are ordered field assignments, never arithmetic.
- Each `changes` message is applied as one unit.
- **The law:** applying the composed records yields the same state as applying every
  original record up to `through`. This is property-tested against a reference model.
- Durable-lane records are never composed.

**Retention.**
- **Memory ring:** per incarnation, bounded by count and bytes. The v2 PR sizes it by
  measurement against the scale vector; it is not fixed here. A resume below the
  horizon resets.
- **World-owned change history:** kept 24 hours or 10,000 revisions in `world.sqlite`,
  whichever is longer (owner decision 2 default). It serves "what changed since" and
  replay. It is not a resume source across restarts, because the incarnation resets.
- **Pending durable work** (§12) is never subject to either limit.

**Initial query map** (from the consumer inventory; the v2 PRs refine it):

| Today | Consumers | v2 query | Lane |
|---|---|---|---|
| `world_invalidated` → `world.snapshot` | shell counts and navigator, Town, Board topology, Desk, selection, dialogs | `topology` (hosts, priorities; detail level reserved) | replaceable |
| focused 5 s poll | shell, Spaces, Inspectors on any host, creation, completions | per `shared-acquisition`: `topology` scoped to an owner, plus catalogue, availability and layouts | replaceable |
| `world_board_changed` | Board, appearance, relations | `board` (one document row until the split, then rows per concern) | replaceable |
| `world_ledger_changed` | asks in Town, Board and Desk | `asks` | durable ordered |
| `world_desk_changed` | Desk marks | `desk` | replaceable |
| `world_watchlist_changed` | watch controls | `watchlist` | replaceable |
| `world_profiles_changed` | profiles, Town look, chimes | `profiles` | replaceable |
| `agent_conversation_changed` | Chat, peeks | `conversation(pane)` | replaceable (message rows) |
| task notifications | notifications | `notices` | durable ordered |
| sources refresh | Work lens, Town badges | `work_items` | replaceable |

Navigation stays browser-local, and completion tracking keeps its identity rules
(inventory). Once its consumers move, the six whole-document channels retire. The
complete snapshot stays for repair until the paged bootstrap closes the same claims.

### 6. The v2 gate

v2 implementation PRs may start behind a disabled capability. No consumer may move to
v2 until all four of these hold:
1. **Herdr evidence.** The event-class inventory is published (done, 2026-10-30). The
   service's keyed per-entity diff then runs in shadow beside v1 and shows zero
   mismatches between delta-applied state and the fresh projection over a working day
   on 8788.
2. **Consumer evidence.** The consumer inventory is published (done, 2026-10-30), and
   the query map above is approved in the first v2 PR. The workflow substrate's ask,
   notice and run queries are defined (committee item 15).
3. **Synthetic source.** The adapter conformance suite passes with the synthetic
   source: partial listings, resets with ID reuse, out-of-order and duplicate events.
4. **Verification.** The resume model and composition properties pass against the
   implementation. The owner approves the Q12–Q14 and consumer re-mapping
   (`verification-plan.md`).

### 7. Durable identity and bindings

**World IDs** are short, issued by the instance's store and never reused within its
data folder: a kind prefix and a persisted counter, such as `n12` or `a7`. Records from
the JSON stores keep the IDs they already have. World IDs are not UUIDs and carry no
source identity, label or path. A global name, when one is needed, is an `agent+local`
URI under the owner's agent URI draft, composed of the instance and the local ID. It is
not built here.

**A binding** links a World record to a source entity:
`{ record, adapter, instance, kind, native_id, evidence, state, checked_at }`. For
Herdr, `instance` is the connection ID.

| Kind | Native ID | Continuity evidence | Survives |
|---|---|---|---|
| terminal | terminal ID | the ID itself (fresh per terminal, never restored) | moves, World restart, reconnect; not a Herdr restart |
| pane (seat) | pane ID | a witnessed terminal ID in it | moves, through the move result or `pane.moved` naming the same terminal |
| tab, workspace | tab or workspace ID | witnessed terminal IDs inside, or Board's weak evidence when bound while empty | IDs are reused after a Herdr restart, so they become unconfirmed |
| agent session (occupant) | harness session `{source, agent, kind, value}` | its fingerprint, seen in a terminal | a Herdr restart that resumes the session |
| work item | forge or tracker durable ID | the source's own identity | always |
| synthetic | its own IDs | its declared rule | per its descriptor |

**States** generalise Board's string states:

| State | When | Actionable |
|---|---|---|
| attached | a current, complete observation shows the native ID with matching evidence | yes, through a fresh qualified target |
| unresolved | the host is offline, stale, filtered or partially listed, or the record isn't yet observed (after a World restart) | no; the binding is kept unchanged |
| unconfirmed | the native ID exists currently, but the evidence doesn't match (ID reuse) | no; the user keeps or detaches it, or the kind's rule applies |
| ended | authoritative absence: a complete current listing omits it, a qualified get on the current generation says not found, or a close is observed on the current generation, and the binding still names that target | no; the record follows its lifetime |

**Re-resolution.** A binding moves to another native ID only by verified continuity or
by explicit user action. Verified continuity is World's own move result naming the
previous and new IDs, or a `pane.moved` event whose pane holds the witnessed terminal.
Labels, cwd, reused pane IDs, agent kinds and runtime generations never prove
continuity.

**Lifetimes** are declared per record kind:
- archive;
- clear;
- keep unresolved;
- move to "Needs a home".

Current lifetimes stay. The watchlist, Desk marks and "seen" are memory-only and clear
on restart or replacement as specified. Board strings, interest and colour keep their
current rules.

**What later persistence would bind to** (owner approval required):
- a watch → a terminal binding;
- a Desk review mark → an agent-session binding plus the observed stop identity;
- completion "seen" → an agent-session binding plus the completion identity.

**Rejected alternatives.**
- UUIDs: contrary to the owner's identity direction.
- Keying World records by runtime IDs: this is today's stale-on-restart defect.
- Automatic retargeting by matching names: it silently attaches records to the wrong
  agent.

### 8. Per-field claims

A field that more than one source can report carries claims:
`{ value, source, author?, observed_at, basis: reported | inferred, source_revision? }`.
`source` is the channel and `author` is who asserted it, when known and different. For
example, an agent reports its PR through Herdr metadata.

**Rules.**
- Single-source fields stay plain values.
- Each field declares a display rule. For example, agent recency is the latest of
  World's session-file time and Herdr's reports, and a PR link shows both the reported
  and the inferred link with provenance.
- A claim is removed only by its own source's complete listing or by an explicit
  retraction. Another source's silence never removes it.
- Authority for a verb is declared by the verb, never "the latest claim". For example,
  sending to a session requires the pane's current Herdr-reported session.
- Harness native IDs are claims on the occupant, never World identity.
- Runtime claims live in memory read models. World-authored values are records.

### 9. Verbs with actor policy

**A registry entry** has:
- a name;
- parameter and result schemas (TypeBox);
- required adapter capabilities;
- a policy per actor;
- preconditions;
- a recovery class;
- `queueable` (default false);
- the evidence stages it reports.

The registry replaces string dispatch with hand-checked parameters. An unregistered
method is refused before any acquisition or dispatch.

**Actors.**
- the owner's browser;
- the agent CLI with a verified pane;
- the agent CLI unverified;
- the assistant (Ranger, with its own permission policy);
- system reconcilers;
- automation (a future owner grant). The registry knows only "automation with grant G";
  how grants are made belongs to the authoring model.

**Policy values.** `allow`, `confirm` (a fresh owner confirmation in a browser) and
`deny`.

**Recovery classes.**

| Class | Meaning |
|---|---|
| `read` | no effect |
| `keyed` | the receiver honours a stable idempotency key |
| `reconcilable` | a decisive read tells whether the effect happened |
| `reattachable` | an external run handle can be found and observed |
| `opaque` | none of these |

These feed the recovery matrix (§12).

**Evidence stages.**
- `accepted`: in memory only;
- `stored`: durably committed;
- `sent`: dispatched and acknowledged by the source;
- `observed`: a later observation shows the effect, naming the World sequence or
  observation that showed it;
- `refused`, `failed` and `uncertain`.

The UI claims only stages it has evidence for. "Stored" requires a durable commit.

**Migration.** The registry is built from today's dispatch tables. A table test fixes
every method's current effective policy, for example:
- PR merge, close and ready: owner browser with confirmation only;
- the CLI never merges or deletes Herdr objects;
- CLI layout changes need confirmation;
- an undo is refused when what it would restore has changed.

Widening a policy is a reviewed registry change, never a side effect.

### 10. Adapters

**A descriptor** declares:
- the adapter kind and version;
- capabilities: complete listing, events, get by ID, source revisions, terminals, and
  so on;
- the kinds it produces, with payload schemas, key derivation and continuity evidence;
- the verbs it implements, with schemas and recovery class. Actor policy is World's,
  never the adapter's.
- a configuration schema, where secrets stay in private files;
- limits: concurrency, page size, rate, entity and byte bounds.

**Registration.**
- The composition root registers each adapter once, in the adapter record keyed by
  kind; each value carries its `descriptor`. Production registers `herdr`.
- GitHub and Jira become work-item adapters in stage 6.
- Harness specifics (session resolution, transcripts, readiness, launch mapping) move
  behind harness adapters in stage 6. A lint check then flags provider-name literals
  in shared code, exempting the composition root and the registry.
- The browser receives descriptors as data and loads per-kind UI lazily.
- A disabled adapter costs no acquisition, timers or eagerly loaded bytes.

**The conformance suite** runs against every adapter. It covers:
- qualification (the same native ID on two instances never aliases);
- complete and partial listings (absence only from complete ones);
- resets and ID reuse;
- out-of-order, duplicate and missing events, repaired by re-reading;
- unknown kinds and fields (ignored and counted);
- unsupported verbs (refused before dispatch);
- declared limits;
- late results after retirement (never published);
- the disabled-adapter cost.

**The synthetic test source** is registered as `synthetic`, only by test composition.
It behaves unlike Herdr:
- opaque, case-sensitive IDs with separators;
- items and threads, but no panes or terminals;
- paginated listings that can be marked incomplete;
- epoch resets that reuse IDs;
- events that arrive before listings, deletes before creates, duplicates;
- events without full payloads.

It is seeded and deterministic. It exercises the observation contract, bindings,
claims and verb refusal. It never ships enabled.

### 11. Per-terminal settings in Herdr pane metadata

**Tokens.** Source `herdr-world:terminal-settings`, no TTL and no `seq`. A `seq` is
left out because two Worlds reporting under one source name would reject each other's
writes.

| Key | Value |
|---|---|
| `world_terminal` | the terminal ID the settings were written for |
| `world_profile_0`, `world_profile_1` | the profile ID, split into 80-character parts (profile IDs are at most 128 characters) |
| `world_profile_name` | the profile's name, at most 80 characters, for Worlds that lack the profile |
| `world_master` | the Town master claim revision, present only on the holder |

That is at most 5 keys, so World's total stays at 24 of Herdr's 32 per terminal.

**Read.** Settings come from each pane row's `tokens`. They are honoured only when
`world_terminal` equals the pane's current terminal ID. This guards Herdr versions that
keep tokens per pane or restore them. Writes from another World arrive as
`pane.updated`.

**Write.**
1. Use the exact connection's current lease.
2. `pane.get` confirms the pane still holds the expected terminal.
3. Call `pane.report_metadata`.
4. Revalidate the lease after the write.

A failure is shown and never reported as saved. Clearing writes `null` for the keys.
After its own moves World checks the tokens, and re-reports them only if a Herdr
version dropped them.

**Lifetime.** The tokens end with the terminal: a Herdr restart doesn't restore them,
and a closed terminal takes them with it. An unreachable host's settings are unresolved
and kept, never cleared.

**Town master.**
- A claim's revision is one more than the highest revision among the current claims the
  assigning World observes.
- The holder is the highest revision across all current observed claims. A tie goes to
  the greatest terminal ID, because Herdr issues terminal IDs while connection IDs are
  per World.
- World clears superseded claims wherever it holds a current lease.
- Moving the role from another live agent asks first, as today.

**Profiles** stay per World. An assignment resolves against this World's profiles; an
unknown ID shows the recorded name with the default look. Profiles and chimes stay
World-owned.

**Migration.**
- An idempotent import writes each assignment's tokens when its connection is first
  observed complete on a ready runtime. An assignment whose terminal is absent from
  that observation is already stale under today's contract and is dropped. The
  assignments of hosts that are offline at first start wait until those hosts are
  observed.
- The legacy fields in `agent-profiles.json` are left in place, unread, for one release
  so a rollback keeps today's behaviour.

**Privacy.** Any client of that Herdr can read the tokens. They hold only IDs, a profile
name and a revision.

### 12. The workflow substrate (paradigm-neutral)

**Intent.**
`{ id, verb, params, targets (bindings, never fences), actor, authorization evidence,
idempotency_key, operation_version, preconditions, created_at, origin }`. `origin` is an
opaque reference from the creator (owner, CLI, a future workflow) and has no semantics
here.

**Outbox.** An intent is committed in the same transaction as the domain change that
needs it. Only durable work goes through the outbox: work that must survive a restart,
or be queued, scheduled or retried. Interactive commands stay direct, with their
existing uncertainty rules.

**Attempt.**
1. The dispatcher claims an intent with a fenced compare-and-set:
   `{ service_incarnation, attempt }`. At most one attempt per intent is active.
2. Immediately before dispatch it rechecks four things:
   - the current authorization (a committed intent never preserves a revoked
     permission);
   - the preconditions;
   - binding verification, resolved to a fresh qualified target;
   - support for the operation version.
3. It writes `dispatching` durably before calling the adapter.
4. It records the receipt, the refusal or uncertainty.

**Recovery matrix**, applied on start to attempts left `dispatching`, and after failures:

| Situation | Recovery | Progress claim |
|---|---|---|
| `keyed` | retry with the same key; record the receipt | automatic, within the provider's availability |
| `reconcilable` | decisive read first; done → receipt; not done → re-dispatch | automatic |
| `reattachable` | find the run by its handle; reattach and observe; never relaunch | automatic continuation |
| `opaque` after possible dispatch | `uncertain`, visible; no automatic retry; an authorized decision resolves it | safety only |
| claimed, not dispatched (crash) | the fence expires with the incarnation; re-claim after the authorization recheck | automatic |
| permanent refusal | record and explain | none until resolved |
| unsupported operation version | `needs-migration`: no dispatch, inbox and receipts kept; explicit recorded migration that never replays a completed effect | none until migrated |
| cancel before dispatch | fence the queued attempt; release reservations | no forbidden effect starts |
| cancel after dispatch | record the real outcome; only supported, authorized cleanup | no promise it was undone |
| authorization revoked before dispatch | prevent, record why, release reservations; if already dispatched, record the outcome and allow only currently authorized cleanup | no forbidden effect starts |

**Inbox.** A signal (an answer, an observed external event) is stored once by its dedupe
key and correlated to one exact occurrence, before its sender is acknowledged. It is
kept until a consumer resolves it, and early signals wait. How a consumer waits for a
signal belongs to the authoring model.

**Queued, state-conditioned intents** (owner rule). Only verbs that declare
`queueable` can be queued. Such an intent captures the target state it was made
against. On reconnect it is dispatched if that state is unchanged, whatever its age,
and recorded as not sent if the state has changed. There is no expiry timer. Terminal
input and Chat sends are never queueable, so there is never a second send queue.

**Time.**
- Core code reads time and defers work only through `Clock` and `Scheduler`. A lint
  rule restricts `Date.now`, `performance.now`, `setTimeout` and
  `requestAnimationFrame` in core folders.
- A durable deadline persists its wall time and is armed with
  `schedule(callback, max(0, deadline − clock.now()))`. A wake that finds
  `now() < deadline` re-arms.
- A deadline that passed while World was stopped fires once on start, after the
  authorization recheck.
- Deterministic test clocks and schedulers drive all of this without real time.

**Retention.** Unanswered asks, unmatched early signals, pending intents and the
receipts needed for idempotency or uncertainty are kept until their explicit
resolution. No age-only rule removes them.

**Not here.** How workflows are defined, how steps compose, and how waits and
compensation are declared. Ranger keeps its own durable execution and task storage;
moving it later keeps its scope, confirmation, recovery and held-queue contracts.

### 13. Verification

See `verification-plan.md` for the models, property suites and coverage re-mapping per
stage. Every implementation PR updates its contracts, adapters, consumer tests and
`verification/coverage.json` and runs the complete gate. This PR changes no current
contract, so it changes no evidence.

## Risks / Trade-offs

- [Digesting projected hosts on dense worlds costs server time] → cache the digest per
  cache entry and projection key, measure in the v1 PR, and use the composite key only
  with its purity test.
- [v2 grows before its evidence] → no consumer moves to v2 until the four gate items
  hold.
- [Other writers exhaust a terminal's 32 token keys] → World stays at 24 or fewer. A
  full terminal makes Herdr refuse the write, which is shown. Raise it upstream if
  harness integrations grow.
- [Two Worlds race to assign the Town master] → the deterministic winner rule converges
  once both observe the same claims.
- [A future Herdr stores tokens differently] → the `world_terminal` witness, plus a
  disposable-session conformance check on each Herdr upgrade.
- [Opaque effects block a workflow] → intended: honest non-progress and an owner
  decision, never a blind retry.
- [One long-lived change spans stages 3–7] → if v1 ships long before the v2 gate, the
  owner may split v2 into its own change.
- [New Quint models lengthen the gate] → each is sized like the existing models. The
  plan names domains and measures them against the 15-minute deadline.

## Migration Plan

Each part ships alone, in committee stage order, with one active effect path. Shadow
reads are allowed; dual dispatch is not.
1. **Incarnation and v1** (stage 3). Negotiated, so old clients keep complete replies.
   Rollback: stop advertising `world_observation_v1`.
2. **Per-terminal settings** (queue item). One-way import; legacy fields kept unread
   for one release.
3. **Identity bindings** with `world.sqlite` (stage 4). JSON import with a backup;
   lifetimes unchanged.
4. **Verb registry, adapters and synthetic source** (stage 6). Table tests prove the
   policy is unchanged.
5. **Effect substrate** (item 15, then stage 5). Matrix tests come first, red, and then
   the outbox goes green.
6. **v2** (stage 7). Behind a capability until the gate. The complete snapshot stays
   for repair; rollback means consumers return to v1.

## Open Questions

These are deferrable; none changes the specs or the task breakdown.
- Page byte bound, ring size and per-subscription queue bound: measured in the v2 PR.
- Topology detail-level parameters (stage 9).
- Whether completion identity can use Herdr's completion sequence (`TerminalState` has
  `last_agent_completion_seq`, but the API inventory doesn't list it). Decide in the
  "seen" change.
- Filing upstream drafts A and B: firstmate-2 and the owner decide.
