## 1. Architecture review batch — this PR

- [x] 1.1 Write the proposal, one-diagram design and proposed behavior delta;
  verify they separate future behavior from current implementation.
- [x] 1.2 Record the three bounded relay spike attempts in design.md, including
  Codex idle/draft/user-standing evidence, blocked Claude and sender probes,
  and the unproven receipt-ID mapping; verify no private identifiers remain.
- [ ] 1.3 Validate the change with OpenSpec strict validation and repository
  checks; obtain independent architecture review before owner acceptance.
- [ ] 1.4 Obtain owner approval of the design and implementation sequence;
  preserve unresolved adapter prerequisites in the approved task list.

Later sections are proposed implementation batches, not authorization to start
them. Pod leads own their work lists and integrate related items as commits on
one batch branch. Use typecheck and focused tests per item, one complete gate
at batch close, and one commit-by-commit review from the pod's pair. No per-item
pushes or full gates. Reconcile existing accepted work instead of rebuilding it.

## 2. Worktree read-model batch — coordinate with Chat

- [ ] 2.1 Reconcile the separately authorized Inspector resolver with the
  qualified subject/candidate/observation envelope; verify foreground, own
  session, reported-checkout and inferred-branch evidence remain distinguishable.
- [ ] 2.2 Share one revalidated target across Files and Changes; test detached
  HEAD, outside-Git cwd, ambiguous candidates, explicit alternate selection,
  session turnover, stale hosts and target-host path canonicalization.
- [ ] 2.3 Expose accepted observation/revision changes for later capture without
  a ledger dependency; verify that changing Inspector's target does not change
  the observed agent work claim or native selection.
- [ ] 2.4 Update affected current contracts, consumer mappings and usage docs;
  run the complete batch gate and capture required Inspector browser evidence
  without changing existing latency budgets.

## 3. Capture and replay batch — Platform

- [ ] 3.1 Define bounded retention/payload settings and the initial source set
  using synthetic workload measurements; record the approved limits and their
  gap/reset behavior before implementing persistence.
- [ ] 3.2 Implement qualified capture and source deduplication with durable
  cursors; verify duplicate observations, source restart, reordered timestamps,
  stale generations and absence-versus-positive-deletion cases.
- [ ] 3.3 Implement consistent snapshot/cursor recovery and rebuildable read
  models; verify reconnect, retention gaps, partial capture and source outages.
- [ ] 3.4 Map ordering/recovery requirements to maintained verification models
  and consumers, run complete verification and the batch gate, and update
  architecture/operation documentation.

## 4. Message intent batch — Platform and Integrations

- [ ] 4.1 Persist explicit threads, sender claims, messages and per-recipient
  outbox records atomically; verify duplicate submissions, crash recovery and
  retention of pending intents without introducing an expiry timer.
- [ ] 4.2 Add conditional recipient/shift bindings and monotonic evidence
  reduction; verify handover holds, changed targets, lost outcomes, refusal,
  ambiguous transcript matches and no automatic resend of uncertain effects.
- [ ] 4.3 Add UI/CLI intent admission using shared service contracts; verify
  sender claim versus authentication and keep ask answers on their own verb.
- [ ] 4.4 Update relevant contracts, CLI/user documentation and verification
  coverage; run the complete batch gate and independent batch review.

## 5. Delivery adapter batches — evidence before enablement

- [ ] 5.1 In disposable sessions only, establish Codex queue receipt correlation
  and versioned admission behavior; test user standing, busy/open asks,
  interruption and restart. Keep unverified unsafe cases held/unavailable.
- [ ] 5.2 Establish a supported Claude non-child path and documented outcome
  mapping using its own disposable process identity; do not bypass tool review
  or infer success from a socket write. Record blocked cases explicitly.
- [ ] 5.3 Establish tool-process sender binding for each harness with synthetic
  identities; test multiple attached sessions/shared-daemon conditions. Do not
  replace unknown identity with inherited environment or a text prefix.
- [ ] 5.4 Implement only the adapters whose prerequisites passed, through the
  target connection/generation; verify occupant changes, SSH-host execution,
  standing, draft preservation, lost results and rollback without resend.
- [ ] 5.5 For each enabled adapter batch, update capability/receipt documentation
  and model/consumer evidence, then run its complete gate and review.

## 6. Shared views and coordinator batch

- [ ] 6.1 Feed Town, Board, Chat and Inspector from shared qualified read models;
  verify equivalent attention/thread/receipt states, stale rendering and
  unchanged viewer seen/reviewed authority across surfaces.
- [ ] 6.2 Move accepted Chat sends to one message-intent path with no duplicate
  legacy send; verify asks still use their answer verb and explicit failures
  preserve recoverable evidence.
- [ ] 6.3 Add cursor-based coordinator inbox/digest consumption referencing
  explicit threads; verify replay does not duplicate a digest or grant owner
  authority to a peer message.
- [ ] 6.4 Run the complete batch gate and viewport evidence, update tutorial,
  features and operation guides, and synchronize accepted delta requirements
  only after implementation acceptance. Archive only after all required work
  and evidence are complete.
