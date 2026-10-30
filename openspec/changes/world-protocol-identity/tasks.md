Stage numbers follow the committee plan. Stage 2 (shared acquisition and the poll
replacement) is the separate `shared-acquisition` change (PR #551). Each group ships in
its own PR. That PR carries its docs, changelog fragment, coverage updates and complete
required verification, and syncs the requirements it implements into the current specs
with the `openspec-sync-specs` skill.

## 1. Agree the design

- [x] 1.1 Write the proposal, design, spec deltas and verification plan. Verify with
  `bun run spec:check` and an independent PR review.
- [ ] 1.2 Owner review of the change and its listed defaults. Record any override in
  `proposal.md` and the affected deltas before stage 3 starts.

## 2. Service incarnation

- [ ] 2.1 Generate `service_incarnation` at each start and send it in the hello.
  Verify with a direct test: two in-process services from the composition root
  (item 9) report different incarnations, while both connection managers start at
  generation 1.
- [ ] 2.2 Embed the incarnation in observation bases, subscription cursors and
  persisted captures. Verify that a base or capture issued before a restart is refused
  as current after it. Add the "Service incarnation and fences" area to
  `verification/coverage.json`, and sync the incarnation requirement into
  `runtime-federation`.

## 3. Observation v1 (stage 3)

- [ ] 3.1 Compute host tokens in the snapshot service: a digest of the projected host
  and its generation, cached per cache entry and projection key. Verify with:
  - a test that tokens are equal exactly when projected content and generation are
    equal;
  - the digest cost on the dense fixture, recorded in the PR.
- [ ] 3.2 Accept `base` on `world.snapshot`, apply the service rule and advertise
  `world_observation_v1`. Verify with tests that:
  - a confirmation is sent only when incarnation, generation and token all match;
  - a malformed base is refused without default routing;
  - a request without a base gets today's reply.
- [ ] 3.3 Browser: send the base and apply each reply as one publication. Reuse
  unchanged hosts, discard a confirmation for a dropped host, reset on a new
  incarnation, and stop sending bases after a refusal. Verify with runtime store tests
  and M1 replay.
- [ ] 3.4 Incremental preparation, building on committee items 3 and 4. Each room's
  fingerprint covers its observation slice and every document and mark it reads; host
  and world values come from per-room aggregates. Verify with P6:
  - an all-unchanged reply rebuilds and publishes nothing;
  - one status change prepares one room;
  - a profile look or appearance edit re-prepares only the rooms that read it;
  - the output equals a complete preparation of the same observation and documents.
- [ ] 3.5 Prepare only consumed views (committee item 11), keeping the Board document
  for appearance and relations. Verify the consumer-inventory cases: Town without
  Board topology, and a view switch prepared before it is presented.
- [ ] 3.6 Add the M1 `observation-base` model with replay, witnesses and controls.
  Update Q10, Q11, Q14, Q15 and Q20 in `verification/coverage.json`, and their
  contracts. Verify with a complete `bun run verification:gate`.
- [ ] 3.7 Update `docs/ARCHITECTURE.md` (observation path) and `docs/knowledge-map.md`,
  add a changelog fragment, and sync the v1 and preparation requirements into
  `runtime-federation`. Verify with `bun run check:docs`.

## 4. Herdr observation baseline

- [ ] 4.1 Add direct tests for today's baseline, and map them to Q04:
  - a read may start before the acknowledgement, and every acknowledgement forces a
    reconciling re-list;
  - a dirty read is published and followed by another read, so continuing events don't
    starve the host;
  - loss and re-acknowledgement invalidate and re-list without retiring actionability;
  - a ready host with a failing subscription stays readable and actionable;
  - event payloads are never applied.

  Sync the baseline requirement with stage 3's docs. Event payload patching stays an
  open question until a measurement after v1 and shared acquisition.

## 5. Per-terminal settings

- [ ] 5.1 On a disposable `herdr --session`, confirm and record in the PR that:
  - tokens follow `pane.move`;
  - tokens are gone after a Herdr restart;
  - a write past the 32-key limit is refused;
  - values are trimmed, stripped and truncated as the design states.
- [ ] 5.2 Write and read `world_terminal`, `world_profile`, `world_profile_name` and
  `world_master`. Writes go through the exact current lease, with the terminal witness
  and validation of every value before writing. Verify with P5, including a refused
  write that is shown as failed.
- [ ] 5.3 Add the Town master hybrid-clock revision, its highest-seen value kept with
  the profiles, and the clearing of superseded claims. Verify with:
  - P7's exhaustive convergence check;
  - a test of two in-process Worlds on one disposable Herdr, covering an offline
    holder returning after a newer assignment.
- [ ] 5.4 Add the import from `agent-profiles.json`, recorded as done per connection in
  the profiles document. Leave the legacy fields unread for one release. Verify that:
  - the import runs once per connection;
  - an offline host's assignments wait for its first observation;
  - a restart after a newer token assignment does not import again;
  - a rollback keeps today's behaviour.
- [ ] 5.5 Sync the per-terminal settings requirement into `world-surfaces`. Reconcile
  the Town master storage text in the `chimes` and `agent-profiles` changes in the same
  PR, so the current specs never keep "kept by the service". Update `FEATURES.md` and
  `docs/TUTORIAL.md` if the shared Town master is visible to users, plus the knowledge
  map. Verify with `bun run check:docs`.

## 6. Identity and bindings (stage 4)

- [ ] 6.1 Issue World IDs from `WorldStorage`: a kind prefix and 8 random base32
  characters, checked against existing IDs. The JSON import keeps existing IDs. Tell
  the `world.sqlite` seat, whose draft issues UUIDs. Verify that:
  - new IDs don't collide with imported ones;
  - a restored copy of the data folder doesn't reissue IDs.
- [ ] 6.2 Build the binding resolver with per-kind declarations. Write Board strings,
  appearance, tab colour and interest down with today's rules, and move them onto it
  without changing their visible states. Layout preferences stay off the resolver:
  Board card positions, pins and folds, and workspace and host colours stay keyed by
  native ID and are inherited on reuse. Verify with:
  - M4 replay for both policies;
  - the existing Board and appearance witness tests, unchanged;
  - a test that a reused workspace ID still inherits its card layout and colour.
- [ ] 6.3 Add claims for the multi-source fields, agent status and PR links, each with
  its display rule. Verify each field: claims coexist, silence doesn't remove a claim,
  and authority is declared by the verb.
- [ ] 6.4 Sync the `world-identity` requirements, and add the "Durable identity and
  bindings" area to `verification/coverage.json`. Verify with a complete
  `bun run verification:gate`.

## 7. Verbs, adapters and the synthetic source (stage 6)

- [ ] 7.1 Build the verb registry from today's dispatch tables. Verify with the P4
  table:
  - every policy is unchanged, including `acknowledge` for `--herdr`, `--replace --yes`,
    `--yes` and `--allow-close-room`;
  - every browser-called method is registered;
  - unregistered methods are refused before dispatch.
- [ ] 7.2 Add staged command evidence. "Stored" appears only after a durable commit;
  coordinate with the grey-tick wording fix in the ui-fixes seat. Verify with a test
  that memory-only acceptance shows `accepted`.
- [ ] 7.3 Add adapter descriptors and the registry in the composition root. The Herdr
  adapter wraps today's runtime. Verify with a test that a disabled adapter makes no
  requests, holds no timers and loads no browser code.
- [ ] 7.4 Add the conformance suite (P3) and the test-only synthetic source. Verify
  that the suite passes for the Herdr fixtures and for the synthetic source, and that a
  production build cannot register the synthetic source.
- [ ] 7.5 Add the provider-name lint for shared code, then move harness specifics
  behind harness adapters. Verify that the lint is clean, with the composition root and
  registry exempt.
- [ ] 7.6 Sync the `bridge-access` and `world-adapters` requirements, and add the verb
  and adapter areas to `verification/coverage.json`. Verify with `bun run check:docs`.

## 8. Workflow substrate (item 15, then stage 5)

- [ ] 8.1 Route substrate time through `Clock` and `Scheduler`, and add the lint rule
  for core folders. Durable deadlines re-arm at least every 60 s. Verify with:
  - the lint failing on a direct `Date.now` in a core folder;
  - P8, including sleep across a deadline.
- [ ] 8.2 Check in the recovery-matrix tests, red (committee item 15 exit). Verify that
  every row of the matrix in `design.md` §12 has a named test, including `repeatable`.
- [ ] 8.3 Apply the target rule to the `world.sqlite` outbox: binding fields captured
  inline, no bare generation, and connection-only targets for owner alerts. Resolution
  follows the binding state: attached dispatches, unresolved waits, and ended or
  unconfirmed is "not sent" only before any dispatching. Verify with tests:
  - a restart at the same generation number waits, then dispatches once the binding
    is attached;
  - an offline host keeps the intent pending;
  - a pane that closes after `dispatching` yields `uncertain`.
- [ ] 8.4 Build the outbox, attempts, version pinning and durable deadlines on a
  temporary `world.sqlite`. Verify with the matrix tests green and M5 replay with crash
  points.
- [ ] 8.5 Define the substrate's ask, notice, intent and receipt queries (v2 gate,
  item 2). Verify by approval in their PR.
- [ ] 8.6 Sync the `world-effects` requirements, and add the effects area to
  `verification/coverage.json`. Verify with a complete `bun run verification:gate`.

## 9. World subscriptions v2 (stage 7)

- [ ] 9.1 Run the real delivery path in shadow beside v1 on 8788: keyed diff, ring and
  composition, then a shadow client. It covers a simulated disconnect and resume and one
  slow-consumer reset. Verify with P2 and zero mismatches over the recorded minimum
  workload:
  - per-class event counts, including `pane.moved` and closes;
  - at least one reconnect;
  - at least one runtime replacement.

  This is gate item 1.
- [ ] 9.2 Implement subscribe, credit, pages, ready, changes and reset behind a
  disabled capability. Verify with M2, M3 and P1.
- [ ] 9.3 Add lanes and per-subscription queue bounds. Verify with tests: a slow
  consumer is reset while its socket and terminals continue, asks are never coalesced,
  and replies go ahead of queued pages.
- [ ] 9.4 Serve the synthetic source through a v2 query in the conformance run. Verify
  the run covers terminal-less rows, a reset that ends lifetimes, ID reuse as a new
  lifetime and a partial listing that deletes nothing (gate item 3).
- [ ] 9.5 Check the four gate items. The owner approves the Q12–Q14 and consumer
  re-mapping. Verify with the approval recorded in the PR.
- [ ] 9.6 Move consumers query by query, and retire each refetch channel once its
  consumers have moved. Verify that each moved consumer's parity tests pass, and that a
  channel is removed only with no remaining subscriber.
- [ ] 9.7 Commit the coverage re-mapping, update `docs/ARCHITECTURE.md` and the
  knowledge map, and sync the v2 requirements. Verify with a complete
  `bun run verification:gate` and `bun run check:docs`.

## 10. Close the change

- [ ] 10.1 After the last stage, check that every delta is synchronized and archive the
  change. If v1 ships long before the v2 gate, ask the owner whether to split v2 into
  its own change first. Verify with `bun run spec:check`.
