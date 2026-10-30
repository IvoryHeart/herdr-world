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
- Payloads cover different subsets, and `pane.moved` changes the pane ID.
- The inventory recommends a stricter discipline: subscribe, wait for the ACK, read
  while draining, and treat an event during a read as dirty. World today reads before
  the ACK, reconciles after every ACK and publishes dirty reads before reading again
  (§4). Four separate lists are not an atomic host snapshot.
- No event carries World's agent recency (session-file times), its connection
  catalogue or its endpoint availability. `PaneInfo` has no activity time, so recency
  has one source: World.
- Terminal IDs are allocated as `term_` plus wall-clock microseconds and a counter
  ([`terminal/id.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/terminal/id.rs)).
  They survive pane and tab moves.
- A restored session keeps pane IDs and each pane's agent session, but not terminal
  IDs or metadata tokens
  ([`persist/snapshot.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/persist/snapshot.rs)).
- `pane.report_metadata` tokens form one flat map per terminal (`TerminalState`),
  patched key by key, and listed without each token's reporter
  ([`terminal/state.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/terminal/state.rs)).
  - **Limits**
    ([`app/api_helpers.rs`](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/api_helpers.rs)):
    32 keys per terminal across all sources, 16 per request, keys of at most 32
    characters.
  - **Values** are trimmed, stripped of control characters and silently truncated to
    80 characters. An empty value clears the key.
  - **Refusals:** only key-shape and key-count violations are refused.
  - **Events:** a write emits `pane.updated` only when a value changes.
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
- `shared-acquisition` (committee item 14, PR #551) owns stage 2: poll replacement,
  pushed recency and catalogue, and shared Desk acquisition.
- The composition root (item 9) builds the service with `createWorldService` and
  these deps: `{ config, paths, clock, scheduler, storage, adapters,
  scheduleProcessExit }`. This design uses its port names:
  - `Clock { now(), monotonic() }`;
  - `Scheduler { schedule(callback, delayMs) → { cancel() } }`;
  - `WorldStorage`, opened by `openStorage(paths, { clock, scheduler })`;
  - an adapter record keyed by kind.
- `world.sqlite` (committee item 10) ships the first outbox: asks, results and owner
  alerts.

## Goals / Non-Goals

**Goals**
- Contracts that stages 3–7 of the committee plan implement without re-deciding them:
  observation v1, v2 subscriptions, identity, verbs, adapters, per-terminal settings and
  the effect substrate.
- Each part is independently shippable and verifiable, with no change to look or
  features.
- A verification plan that keeps Q12–Q14 and their consumers mapped at every stage.

**Non-Goals**
- A workflow authoring model: definitions, runs, steps, waits, composition or a DSL.
- A general signal inbox. It is added with its first consumer.
- A second real runtime, or building for one.
- Shared acquisition and the poll replacement (`shared-acquisition`).
- The `world.sqlite` schema. This design names only what the substrate needs from
  storage.
- Changing any current lifetime or binding rule: the watchlist, Desk marks, "seen",
  Board strings, appearance, colour and interest stay as specified.
- Applying Herdr event payloads to the model.
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
2. Each room's inputs are fingerprinted. The fingerprint covers **every input the room
   reads**:
   - its slice of the observation: workspace, tabs, panes, agents, and the tokens it
     reads;
   - the World documents and marks it reads:
     - the Board document's appearance and relations for its tabs and panes;
     - the profiles document's looks for its agents;
     - the watchlist entries, seen marks and Town master that touch it.

   A room with an unchanged fingerprint reuses its prepared room. A change to a
   document re-prepares only the rooms whose fingerprints include it. This builds on
   the tab-membership index (committee item 4).
3. Host and world counts, attention and summaries are derived from per-room aggregates,
   not whole-world scans. This builds on the prepared shell summaries (item 3).
4. View models are prepared only for interested consumers (item 11, with the consumer
   inventory):
   - Office when Town or its reception consumers are mounted;
   - Board topology when Board is;
   - the Board document always, because appearance and relations use it.

   A newly selected view is prepared before it is presented.
5. **Work counts, blocking in tests.**
   - An all-unchanged reply with identical metadata and unchanged documents rebuilds no
     host, room or view model and publishes nothing.
   - One status change prepares one room, its host's aggregates and the world summary,
     and no other room.
   - Incremental output equals a complete preparation of the same inputs: observation,
     documents and marks. This is a property test, and P6 varies the documents as well
     as the observation.

### 4. The Herdr observation baseline

The baseline is today's behaviour, written down:
- **Events invalidate.** Every event invalidates its host for a re-list. Event payloads
  are never applied to the model.
- **Reads before the ACK.** Reads may start before the subscription's ACK, and every
  ACK, including after a reconnect, forces a reconciling re-list
  (`session.resync_required`, `server/src/connections/runtime.ts`).
- **Dirty reads.** A read with an event during it is still published; it is cached as
  dirty, and a late invalidation queues another read (`server/src/world/snapshot.ts`).
  Continuing events therefore never starve a host of current readings.
- **Loss and re-acknowledgement.** Subscription loss, `events_lost` and
  re-acknowledgement invalidate and re-list the host. They do not retire actionability.
  A host whose subscription keeps failing stays readable and actionable through the 15 s
  fallback. Runtime replacement and connection loss retire actionability, under the
  existing qualified-admission rules.

The inventory's stricter discipline would change behaviour: wait for the ACK before
reading, never publish a dirty read, retire actionability on loss. A ready host whose
subscription keeps failing would then get no reads, and a busy SSH host could starve.
Adopting any part of it needs its own requirement and a progress bound; it is not
proposed here.

Patching the model from event payloads (for example renames, order lists, one tab's
layout or one pane's status) is **deferred**. The measured cost is browsers × events,
which v1 and shared acquisition already remove. Payload patching would add a second
model-update path, with drift checks and per-class permissions, for no measured
payoff. Revisit it with a measurement after v1 and shared acquisition (Open
Questions). Upstream requests A (snapshot boundary and resumable observation) and B
(output revisions) from the inventory remain drafts for the owner.

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
| Durable ordered | asks, notices, receipts, intents | never coalesced or dropped; a subscription that can't keep up is reset and re-bootstrapped from durable state |
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
- **World-owned change history:** kept in `world.sqlite` for at most 24 hours and at
  most 10,000 revisions, whichever limit is reached first, matching `world.sqlite`'s
  replay cap. It serves "what changed since" and replay. It is not a resume source
  across restarts, because the incarnation resets.
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
| (new, substrate) | intent and receipt status | `intents` | durable ordered |

Navigation stays browser-local, and completion tracking keeps its identity rules
(inventory). Once its consumers move, the six whole-document channels retire. The
complete snapshot stays for repair until the paged bootstrap closes the same claims.

### 6. The v2 gate

v2 implementation PRs may start behind a disabled capability. No consumer may move to
v2 until all four of these hold:
1. **Herdr evidence.**
   - The event-class inventory is published (done, 2026-10-30).
   - A shadow then runs on 8788 through the **real delivery path**: keyed per-entity
     diff, change ring and composition, then a shadow client applying the batches.
     After every observation, its state is compared with the fresh projection.
   - The run includes a simulated disconnect and resume, and one slow-consumer reset.
   - It meets a **minimum workload**, recorded with the evidence:
     - per-class event counts, including `pane.moved` and closes;
     - at least one World-to-Herdr reconnect;
     - at least one runtime replacement.

     A quiet day does not count.
   - It ends with zero mismatches.
2. **Consumer evidence.** The consumer inventory is published (done, 2026-10-30), and
   the query map above is approved in the first v2 PR. The substrate's own queries are
   defined: asks, notices, intents and receipts. Queries over workflow runs belong to
   the authoring model; they are added when it is chosen, outside this gate.
3. **Synthetic source.** The adapter conformance suite passes with the synthetic
   source, and the synthetic source's entities are served through a v2 query. That run
   covers:
   - terminal-less rows;
   - a reset that ends lifetimes;
   - ID reuse as a new lifetime;
   - a partial listing that emits no deletes.
4. **Verification.** The resume model, the page credits and the composition properties
   (M2, M3, P1) pass against the implementation. The owner approves the Q12–Q14 and
   consumer re-mapping (`verification-plan.md`).

### 7. Durable identity and bindings

**World IDs** are short and issued by the instance's store: a kind prefix and 8 random
base32 characters, such as `n-7k2m9q4x`. The store checks each new ID against existing
IDs before inserting it.
- They are not counters or clocks, because restoring a stop-and-copy backup would roll
  those back and issue the same ID twice. A late `ask answer` could then reach a
  different ask.
- Records from the JSON stores keep the IDs they already have.
- World IDs are not UUIDs and carry no source identity, label or path.
- A global name, when one is needed, is an `agent+local` URI under the owner's agent URI
  draft, composed of the instance and the local ID. It is not built here.

**A binding** links a World record that claims identity with a source entity to that
entity: `{ record, adapter, instance, kind, native_id, evidence, state, checked_at }`.
For Herdr, `instance` is the connection ID. Layout preferences claim no identity
(`world-surfaces`, "Board persistence and identity"), so they are not bindings. They
stay keyed by native ID, and a reused ID inherits them.

**Evidence kinds** (Herdr, verified facts):

| Kind | Native ID | Continuity evidence |
|---|---|---|
| terminal | terminal ID | the ID itself (fresh per terminal, never restored, survives moves) |
| pane (seat) | pane ID | a witnessed terminal ID in it |
| tab, workspace | tab or workspace ID | witnessed terminal IDs inside, or Board's weak evidence when bound while empty |
| agent session (occupant) | harness session `{source, agent, kind, value}` | its fingerprint, seen in a terminal |
| work item | forge or tracker durable ID | the source's own identity |
| synthetic | its own IDs | its declared rule |

**States:**
- **attached:** a current, complete observation shows the native ID once, with matching
  evidence. Actions go through a fresh qualified target.
- **unresolved:** the source is offline, stale, filtered or partially listed; the record
  isn't yet observed (after a World restart); or the match is ambiguous. The saved
  binding is kept unchanged.
- **unconfirmed:** the native ID is present in a current observation, but the evidence
  doesn't match (ID reuse). The user keeps or detaches it, or the kind's declared rule
  applies.
- **ended:** the kind's absence rule is met, while the binding still names the checked
  target.

**Per-kind rules.** Each record kind declares four things:
- its evidence;
- the continuity paths it accepts, from a closed set;
- its absence rule, from a closed set;
- its lifetime.

There is no general rule that overrides a kind's declaration.

**Continuity**, the only ways a binding moves to another native ID:
- **C1.** A witnessed terminal ID appears under a new native ID in a current complete
  listing of the same runtime. Terminal IDs are fresh and never restored, so this is
  verified.
- **C2.** A result of World's own move names the new native ID for the witnessed
  terminal.
- **The user** moves it explicitly.

Herdr events, labels, working directories, agent kinds, reused pane IDs and runtime
generations never prove continuity. Events are lossy invalidation and can fall into an
`events_lost` window.

**Absence**, the only ways a binding ends:
- **A1.** A close is observed on the current runtime generation for the bound target.
- **A2.** A qualified get on the current generation answers not found.
- **A3.** A complete current listing omits every witnessed terminal.

**Ambiguity.** When a native ID, terminal or session appears more than once in one
current observation, the binding stays unresolved: never attached and never ended. This
matches today's watchlist rule (a duplicate terminal is never admitted or guessed) and
Codex thread binding (bind only on an exact single match). Records whose session is
the explicit unknown identity bind to the terminal instead.

**Today's rules, written down unchanged:**

| Record kind | Evidence | Continuity | Absence | When ended |
|---|---|---|---|---|
| Board string (pane, tab or workspace anchor) | witnessed terminals; weak evidence when bound while empty | C2 only. After a failed or rolled-back move, only the terminals the outcome positively observed | A1, A2; a target missing from the topology is unresolved | moves to "Needs a home" |
| Terminal appearance (a tab's colour and status message, a pane's avatar) | witnessed terminals | C1 and C2: kept while any witnessed terminal is present, including after a lost move acknowledgement | A3 | record and colour alias reclaimed |
| Tab colour | as appearance | as appearance; a tab World moves keeps the colour it showed | A1 (an observed tab close), or A3 | dropped |
| Agent interest | terminal on its host, without generation | the terminal itself | A3; never on a failed, stale or partial listing | dropped |
| Per-terminal settings (§11) | stored on the terminal in Herdr; `world_terminal` witness | the terminal itself | the terminal ends | gone with the terminal |
| Watchlist pin | connection, generation and terminal (memory) | none | runtime replacement or service restart | cleared (current contract) |
| Desk marks | connection, generation, terminal and session, or the explicit unknown session (memory) | none | runtime or session replacement, or service restart | cleared (current contract) |
| Layout preference (Board card position, pin and fold; workspace and host colour) | **not a binding**: connection profile and native ID only, with no evidence | none; inherited when an ID is reused | none | kept (current contract) |

Whether Board strings should also follow moves made outside World, through C1, is an
optional owner decision. It would be a MODIFIED Board requirement; this change keeps
today's rule.

**What later persistence would bind to** (owner approval required):
- a watch → a terminal binding;
- a Desk review mark → an agent-session binding plus the observed stop identity, or a
  terminal binding when the session is unknown;
- completion "seen" → an agent-session binding plus the completion identity.

**Rejected alternatives.**
- UUIDs: contrary to the owner's identity direction.
- Counters: a restored backup issues them again.
- Keying World records by runtime IDs: this is today's stale-on-restart defect.
- One general continuity and absence rule for every kind: it contradicts Board's and
  appearance's current contracts.
- `pane.moved` events as evidence: they are lossy.
- Automatic retargeting by matching names: it silently attaches records to the wrong
  agent.

### 8. Per-field claims

A field that more than one source can report carries claims:
`{ value, source, author?, observed_at, basis: reported | inferred, source_revision? }`.
`source` is the channel and `author` is who asserted it, when known and different. For
example, an agent reports its PR through Herdr metadata.

**The multi-source fields today:**
- **Agent status:** Herdr's reported status, and World's status inferred from the
  transcript.
- **PR links:** the link an agent reports with `agent-checkout --pr`, and the link
  inferred from its checkout branch.

Agent recency is not one of them. Herdr reports no activity time, so recency stays a
plain World value.

**Rules.**
- Single-source fields stay plain values.
- Each field declares a display rule. For example, a PR link shows both the reported
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

Every browser RPC method, resource operation, agent CLI command and assistant action is
registered, including reads, which have the `read` class. An unregistered method is
refused before any acquisition or dispatch.

**Actors.**
- the owner's browser;
- the agent CLI with a verified pane;
- the agent CLI unverified;
- the assistant (Ranger, with its own permission policy);
- system reconcilers;
- automation (a future owner grant). The registry knows only "automation with grant G";
  how grants are made belongs to the authoring model.

**Policy values.**

| Value | Meaning | Today's examples |
|---|---|---|
| `allow` | runs | reads; Board edits from the browser |
| `acknowledge` | runs only when the caller passes an explicit flag that names the effect | CLI `--herdr` for Herdr layout changes (desk moves, room and desk adds); `--replace --yes` for exclusive role transfers; `--yes` for a one-time pod import; `--allow-close-room` |
| `confirm` | runs only after a fresh confirmation by the owner in a browser | PR merge, close and ready |
| `deny` | refused | merges and Herdr deletions from the CLI |

**Recovery classes.**

| Class | Meaning |
|---|---|
| `read` | no effect |
| `keyed` | the receiver honours a stable idempotency key |
| `reconcilable` | a decisive read tells whether the effect happened |
| `reattachable` | an external run handle can be found and observed |
| `repeatable` | a duplicate is harmless, so a retry is allowed, as for owner alerts (`notification.show`). Never used for terminal input, Chat sends or pane answers |
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
every method's current effective policy, including:
- `acknowledge` for each CLI flag above;
- `confirm` for PR merge, close and ready;
- `deny` for CLI merges and deletions;
- undo refused when what it would restore has changed.

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
claims and verb refusal. Once v2 exists, it is also served through a v2 query, for the
v2 gate (§6). It never ships enabled.

### 11. Per-terminal settings in Herdr pane metadata

**Tokens.** Source `herdr-world:terminal-settings`, no TTL and no `seq`. A `seq` is
left out because two Worlds reporting under one source name would reject each other's
writes.

| Key | Value |
|---|---|
| `world_terminal` | the terminal ID the settings were written for |
| `world_profile` | the profile ID: Herdr's agent-name rule, at most 32 characters |
| `world_profile_name` | the profile's name, for Worlds that lack the profile |
| `world_master` | the Town master claim revision (decimal), present only on the holder |

That is at most 4 keys, so World's total stays at 23 of Herdr's 32 per terminal.

**Values.** World validates every value before writing, because Herdr changes values
silently. Each value must already be:
- trimmed;
- free of control characters;
- non-empty;
- at most 80 characters.

A profile name is shortened at a character boundary to fit. Clearing writes `null`.

**Read.** Settings come from each pane row's `tokens`. They are honoured only when
`world_terminal` equals the pane's current terminal ID. This guards Herdr versions that
keep tokens per pane or restore them. Writes from another World arrive as
`pane.updated`.

**Write.**
1. Use the exact connection's current lease.
2. `pane.get` confirms the pane still holds the expected terminal.
3. Call `pane.report_metadata`.
4. Revalidate the lease after the write.

A failure is shown and never reported as saved. This includes Herdr's refusal past 32
keys. After its own moves World checks the tokens, and re-reports them only if a Herdr
version dropped them.

**Lifetime.** The tokens end with the terminal: a Herdr restart doesn't restore them,
and a closed terminal takes them with it. An unreachable host's settings are unresolved
and kept, never cleared.

**Town master: the newest assignment wins.**
- A claim's revision is a hybrid logical clock: `max(clock.now(), highest seen + 1)`.
  "Highest seen" is the largest revision this World has observed or written. It is kept
  with this World's profiles, so it survives a restart.
- The holder is the claim with the highest revision across all current observed claims.
  A tie goes to the greater terminal ID, because Herdr issues terminal IDs while
  connection IDs are per World.
- An offline holder that returns after a newer assignment loses, because its revision
  is older. This also holds when no World saw its claim at assignment time, or a World
  restarted meanwhile.
- World clears superseded claims wherever it holds a current lease.
- Moving the role from another live agent asks first, as today.
- **Residual risk:** clock skew between machines larger than the gap between two
  assignments. Within one World, the revision is monotonic.

**Profiles** stay per World. An assignment resolves against this World's profiles; an
unknown ID shows the recorded name with the default look. Profiles and chimes stay
World-owned.

**Migration.**
- Each assignment in `agent-profiles.json` is imported once, when its connection is
  first observed complete on a ready runtime. An assignment whose terminal is absent
  then is already stale under today's contract and is dropped. The assignments of hosts
  that are offline at first start wait until those hosts are observed.
- Import completion is recorded per connection in the profiles document. A later start
  never re-imports, so it cannot overwrite a newer assignment made through tokens by
  either World.
- The legacy fields are left in place, unread after import, for one release so a
  rollback keeps today's behaviour.

**Privacy.** Any client of that Herdr can read the tokens. They hold only IDs, a profile
name and a revision.

### 12. The workflow substrate (paradigm-neutral)

**Intent.**
`{ id, verb, params, targets, actor, authorization evidence, idempotency_key,
operation_version, preconditions, created_at, origin }`. `origin` is an opaque reference
from the creator (owner, CLI, a future workflow) and has no semantics here.

**Targets.** An intent's targets are bindings. Until bindings exist (stage 4), and for
the first outbox in `world.sqlite`:
- The intent captures the binding's fields inline: adapter, connection ID, kind, native
  ID, and the terminal or session evidence. It never captures a bare runtime
  generation as its target.
- Each attempt records its own fences when it is claimed and checks them at dispatch.
- A target with no pane resource, such as an owner alert, captures only the connection
  ID. Each retry binds to that connection's current runtime lease.

**Resolution.** Before every dispatch, including the first after an incarnation change,
targets resolve by binding state (§7):
- **attached:** dispatch, under the recovery matrix;
- **unresolved:** wait and stay pending, with no time limit. This covers right after a
  restart, before any host is observed; an offline host; and a partial listing;
- **ended or unconfirmed:** record "not sent", but only when no attempt reached
  `dispatching`. Otherwise the recovery matrix decides, so an opaque intent whose pane
  closed after a possible send becomes `uncertain`, never a false "not sent".

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
   - the target, resolved to a fresh qualified target;
   - support for the operation version.
3. It writes `dispatching` durably before calling the adapter.
4. It records the receipt, the refusal or uncertainty.

**Recovery matrix**, applied on start to attempts left `dispatching`, and after failures:

| Situation | Recovery | Progress claim |
|---|---|---|
| `keyed` | retry with the same key; record the receipt | automatic, within the provider's availability |
| `reconcilable` | decisive read first; done → receipt; not done → re-dispatch | automatic |
| `reattachable` | find the run by its handle; reattach and observe; never relaunch | automatic continuation |
| `repeatable` | retry, accepting a possible duplicate | automatic |
| `opaque` after possible dispatch | `uncertain`, visible; no automatic retry; an authorized decision resolves it | safety only |
| claimed, not dispatched (crash) | the fence expires with the incarnation; re-claim after the authorization recheck | automatic |
| permanent refusal | record and explain | none until resolved |
| unsupported operation version | `needs-migration`: no dispatch, receipts kept; explicit recorded migration that never replays a completed effect | none until migrated |
| cancel before dispatch | fence the queued attempt; release reservations | no forbidden effect starts |
| cancel after dispatch | record the real outcome; only supported, authorized cleanup | no promise it was undone |
| authorization revoked before dispatch | prevent, record why, release reservations; if already dispatched, record the outcome and allow only currently authorized cleanup | no forbidden effect starts |

**Signals.** World's one durable signal today, an ask's answer, is stored on the ask
by `world.sqlite`. A general signal inbox (dedupe, correlation, early arrival) is
added with its first consumer, together with its model witnesses. How a consumer waits
for a signal belongs to the authoring model.

**Queued, state-conditioned intents** (owner rule). Only verbs that declare
`queueable` can be queued. Such an intent captures the target state it was made
against. On reconnect it is dispatched if that state is unchanged, whatever its age. If
the state has changed, it is recorded as not sent, provided no attempt reached
`dispatching`. There is no expiry timer.

The generic terminal input and Chat send verbs are never queueable, so there is never a
second send queue. A declared verb that delivers one stored record to its bound
recipient may be queueable. For example, `world.ask.deliver-answer` in the
ask-answer delivery change delivers an ask's answer to its asker. Such a verb must
meet four conditions:
- it reads the record's text at dispatch and copies none of it into the intent;
- it is conditioned on the recipient's binding and on the record still awaiting
  delivery;
- it is `opaque`;
- it dispatches through Chat's guarded send checks: current lease, session fence and
  input admission.

The answering actor's policy is rechecked at dispatch.

**Time.**
- Core code reads time and defers work only through `Clock` and `Scheduler`. A lint
  rule restricts `Date.now`, `performance.now`, `setTimeout` and
  `requestAnimationFrame` in core folders.
- A durable deadline persists its wall time. It is armed with
  `schedule(callback, min(60_000, max(0, deadline − clock.now())))` and re-armed on
  every wake until `now() ≥ deadline`. Monotonic timers stop while a machine sleeps, so
  this bounds the lateness after sleep to 60 seconds.
- A deadline that passed while World was stopped fires once on start, after the
  authorization recheck.
- Deterministic test clocks and schedulers drive all of this without real time,
  including sleep across a deadline.

**Retention.** Unanswered asks, pending and uncertain intents, and the receipts needed
for idempotency or uncertainty are kept until their explicit resolution. No age-only
rule removes them.

**Not here.** How workflows are defined, how runs and steps compose, and how waits and
compensation are declared. Ranger keeps its own durable execution and task storage;
moving it later keeps its scope, confirmation, recovery and held-queue contracts.

### 13. Verification

See `verification-plan.md` for the models, property suites and coverage re-mapping per
stage. Every implementation PR does three things:
- updates its contracts, adapters, consumer tests and `verification/coverage.json`;
- runs the complete gate;
- syncs its own deltas into the current specs.

This PR changes no current contract, so it changes no evidence.

## Risks / Trade-offs

- [Digesting projected hosts on dense worlds costs server time] → cache the digest per
  cache entry and projection key, measure in the v1 PR, and use the composite key only
  with its purity test.
- [A room fingerprint misses an input and shows a stale look] → the fingerprint covers
  every input the room reads, and P6 varies documents as well as observations.
- [v2 grows before its evidence] → no consumer moves to v2 until the four gate items
  hold, including a recorded minimum workload.
- [Other writers exhaust a terminal's 32 token keys] → World stays at 23 or fewer. A
  full terminal makes Herdr refuse the write, which is shown. Raise it upstream if
  harness integrations grow.
- [Clock skew between Worlds reorders two Town master assignments] → the hybrid
  logical clock orders them correctly within the skew. Larger skew is a documented
  residual risk for a single shared role.
- [A future Herdr stores tokens differently] → the `world_terminal` witness, plus a
  disposable-session conformance check on each Herdr upgrade.
- [Opaque effects block a workflow] → intended: honest non-progress and an owner
  decision, never a blind retry.
- [One long-lived change spans stages 3–7] → each stage syncs its own deltas when it
  ships. If v1 ships long before the v2 gate, the owner may split v2 into its own change.
- [New Quint models lengthen the gate] → each is sized like the existing models. The
  plan names domains and measures them against the 15-minute deadline.

## Migration Plan

Each part ships alone, in committee stage order, with one active effect path. Shadow
reads are allowed; dual dispatch is not. Each stage syncs its own deltas into the
current specs.
1. **Incarnation and v1** (stage 3). Negotiated, so old clients keep complete replies.
   Rollback: stop advertising `world_observation_v1`.
2. **Per-terminal settings** (queue item). The import is recorded per connection;
   legacy fields are kept unread for one release.
3. **Identity bindings** with `world.sqlite` (stage 4). JSON import with a backup;
   per-kind rules and lifetimes unchanged.
4. **Verb registry, adapters and synthetic source** (stage 6). Table tests prove the
   policy is unchanged.
5. **Effect substrate** (item 15, then stage 5). The first outbox in `world.sqlite`
   follows §12's rule for targets before bindings exist. Matrix tests come first, red,
   and then the outbox goes green.
6. **v2** (stage 7). Behind a capability until the gate. The complete snapshot stays
   for repair; rollback means consumers return to v1.

## Open Questions

These are deferrable; none changes the specs or the task breakdown.
- Page byte bound, ring size and per-subscription queue bound: measured in the v2 PR.
- Topology detail-level parameters (stage 9).
- Patching from Herdr event payloads: revisit with a measurement after v1 and shared
  acquisition (§4).
- Whether Board strings should follow moves made outside World (§7): an optional owner
  decision that would modify the Board requirement.
- Whether completion identity can use Herdr's completion sequence (`TerminalState` has
  `last_agent_completion_seq`, but the API inventory doesn't list it). Decide in the
  "seen" change.
- Filing upstream drafts A and B: firstmate-2 and the owner decide.
