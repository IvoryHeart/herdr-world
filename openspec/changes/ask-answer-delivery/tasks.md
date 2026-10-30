## 1. Contract and interaction

- [ ] 1.1 Confirm the proposal incorporates #549's explicit verb wording and all five architect-protocol conditions; verify the decision record and strict OpenSpec validation.
- [ ] 1.2 Complete the Opus design for bounded delivery notices and resend/close controls within Reception; verify answered asks remain visible without changing question counts.

## 2. Binding, intent and dispatch

- [ ] 2.1 Capture original binding schemes and answer-occurrence state conditions, version and answering actor policy; verify old/unverified/replaced targets record not sent without losing the answer.
- [ ] 2.2 Commit the reference-only answer intent with the answer, with no historical backfill; verify atomicity and no extra stored message text.
- [ ] 2.3 Implement claim/recheck/dispatching/receipt through the existing guarded Chat path; verify current lease/session/input admission, owner-only policy, version refusal and plain-text formatting.
- [ ] 2.4 Implement opaque recovery and authorized same-recipient resend/close; verify crash schedules and stale attempt/decision rejection with real temporary SQLite.

## 3. Retrieval coordination and lifecycle

- [ ] 3.1 Acknowledge exact answers only after successful stdout output by the verified asker; verify failed output, lost acknowledgement, other readers and read/send races.
- [ ] 3.2 Persist deadlines and arm waits at most 60 seconds; verify early wakes, wall-clock jumps, withdrawal and binding/policy changes prevent invalid submission.
- [ ] 3.3 Drain started effects before transport/storage shutdown; verify source/standalone compiled recovery and root reopen without automatic opaque replay.

## 4. Delivery evidence and guidance

- [ ] 4.1 Update current specs, Q29 consumer mapping, CLI skill, tutorial/features and operator guidance; verify site build and explicit limitations for dismissals and legacy records.
- [ ] 4.2 Run complete affected unit/browser/platform and behavioral gates, obtain independent review and deliver one ready PR when publication is authorized; record exact evidence without claiming Herdr deduplication.
