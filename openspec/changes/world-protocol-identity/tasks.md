Stage numbers follow the committee plan. Stage 2 (shared acquisition and the poll
replacement) is the separate `shared-acquisition` change. Each group ships in its own
PR, with that PR's docs, changelog fragment, coverage updates and complete required
verification.

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
  as current after it.

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
- [ ] 3.4 Incremental preparation: room fingerprints and per-room aggregates, building
  on committee items 3 and 4. Verify with P6:
  - an all-unchanged reply rebuilds and publishes nothing;
  - one status change prepares one room;
  - the incremental output equals a complete preparation.
- [ ] 3.5 Prepare only consumed views (committee item 11), keeping the Board document
  for appearance and relations. Verify the consumer-inventory cases: Town without
  Board topology, and a view switch prepared before it is presented.
- [ ] 3.6 Add the M1 `observation-base` model with replay, witnesses and controls.
  Update Q14, Q15 and Q20 in `verification/coverage.json` and their contracts. Verify
  with a complete `bun run verification:gate`.
- [ ] 3.7 Update `docs/ARCHITECTURE.md` (observation path) and `docs/knowledge-map.md`,
  and add a changelog fragment. Verify with `bun run check:docs`.

## 4. Herdr event-class repair

Optional. It can start any time after stage 3.

- [ ] 4.1 Add direct tests for the observation baseline: a read during events is read
  again, lost events and re-acknowledgement retire and re-list, and buffered payloads
  are never applied over a read. Map the tests to Q04.
- [ ] 4.2 Add the drift check and its counter. Patch permission is off by default for
  every class. Verify that drift replaces the host model and withdraws that class's
  permission.
- [ ] 4.3 Enable patching for a class only after a working day of zero drift on 8788.
  Record the evidence in the enabling PR.

## 5. Per-terminal settings

- [ ] 5.1 On a disposable `herdr --session`, confirm and record in the PR that:
  - tokens follow `pane.move`;
  - tokens are gone after a Herdr restart;
  - a write past the 32-key limit is refused.
- [ ] 5.2 Write and read `world_terminal`, `world_profile_0`, `world_profile_1`,
  `world_profile_name` and `world_master` under the exact current lease, with the
  terminal witness. Verify with P5, including a refused write that is shown as failed.
- [ ] 5.3 Add the Town master revision rule and the clearing of superseded claims.
  Verify with a test of two in-process Worlds on one disposable Herdr: both show the
  same holder after concurrent assignments.
- [ ] 5.4 Add the import from `agent-profiles.json`. It runs per connection at that
  connection's first complete observation, and leaves the legacy fields unread for one
  release. Verify that:
  - the import is idempotent;
  - an offline host's assignments wait for its first observation;
  - a rollback keeps today's behaviour.

  Reconcile the Town master storage text in the `chimes` and `agent-profiles` changes
  when they archive.
- [ ] 5.5 Update `FEATURES.md` and `docs/TUTORIAL.md` if the shared Town master is
  visible to users, plus the knowledge map. Verify with `bun run check:docs`.

## 6. Identity and bindings (stage 4)

- [ ] 6.1 Issue World IDs (a kind prefix and a persisted counter) from `WorldStorage`.
  The JSON import keeps existing IDs. Verify that IDs are never reused across a reopen
  and that imported IDs don't collide with new ones.
- [ ] 6.2 Build the binding resolver with evidence per kind, and move Board strings and
  colours onto it without changing their visible states. Verify with M4 replay and the
  existing Board identity tests.
- [ ] 6.3 Add claims for the multi-source fields (agent status, recency, PR links), each
  with its display rule. Verify each field: claims coexist, silence doesn't remove a
  claim, and authority is declared by the verb.

## 7. Verbs, adapters and the synthetic source (stage 6)

- [ ] 7.1 Build the verb registry from today's dispatch tables. Verify with the P4
  table: every policy is unchanged, every browser-called method is registered, and
  unregistered methods are refused before dispatch.
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

## 8. Workflow substrate (item 15, then stage 5)

- [ ] 8.1 Route substrate time through `Clock` and `Scheduler`, and add the lint rule
  for core folders. Verify that the lint fails on a direct `Date.now` in a core folder.
- [ ] 8.2 Check in the recovery-matrix tests, red (committee item 15 exit). Verify that
  every row of the matrix in `design.md` §12 has a named test.
- [ ] 8.3 Build the outbox, attempts, inbox, version pinning and durable deadlines on a
  temporary `world.sqlite`. Verify with the matrix tests green and M5 replay with crash
  points.
- [ ] 8.4 Define the ask, notice and run queries (v2 gate, item 2). Verify by approval
  in their PR.

## 9. World subscriptions v2 (stage 7)

- [ ] 9.1 Run the keyed per-entity diff and change ring in shadow beside v1. Verify
  with P2: zero mismatches over a working day on 8788 (gate item 1).
- [ ] 9.2 Implement subscribe, credit, pages, ready, changes and reset behind a
  disabled capability. Verify with M2, M3 and P1.
- [ ] 9.3 Add lanes and per-subscription queue bounds. Verify with tests: a slow
  consumer is reset while its socket and terminals continue, asks are never coalesced,
  and replies go ahead of queued pages.
- [ ] 9.4 Check the four gate items. The owner approves the Q12–Q14 and consumer
  re-mapping. Verify with the approval recorded in the PR.
- [ ] 9.5 Move consumers query by query, and retire each refetch channel once its
  consumers have moved. Verify that each moved consumer's parity tests pass, and that a
  channel is removed only with no remaining subscriber.
- [ ] 9.6 Commit the coverage re-mapping and update `docs/ARCHITECTURE.md` and the
  knowledge map. Verify with a complete `bun run verification:gate` and
  `bun run check:docs`.

## 10. Close the change

- [ ] 10.1 After implementation and verification, synchronize the deltas into the
  current specs and archive the change. If v1 ships long before the v2 gate, ask the
  owner whether to split v2 into its own change first. Verify with
  `bun run spec:check`.
