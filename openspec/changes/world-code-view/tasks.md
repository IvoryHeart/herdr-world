# Proposed future tasks

These are a plan for the recommended read/review-first direction, **not authorized
implementation in #981**. Research, mock and proposal are the deliverables of this
PR. The implementation tasks deliberately remain unchecked. If the owner requires
a full workbench or live saves, revise this same change before applying it.

## 1. Record the product decision

- [ ] 1.1 Record owner choice of native Code view and read/review-first scope; verify the proposal, research recommendation and acceptance scenarios agree.
- [ ] 1.2 Derive identity, ownership, stale-state and read-bound invariants from the spec; map applicable verification coverage/models and required production consumers, with reviewed alternative-evidence rationale where appropriate.

## 2. Implement qualified project resources

- [ ] 2.1 Extend/reuse project admission for room and agent-linked roots on local/SSH providers; test duplicate names, missing/moved roots, path escapes, retired generations and late replies.
- [ ] 2.2 Reuse bounded file/Git reads and capability refusals; verify current platform/remote consumer suites and provider limits, without introducing file writes.

## 3. Compose the native view

- [ ] 3.1 Add `/code`, common view selection and qualified Open in Code actions; verify browser Back/Forward, host filtering, annotation context and existing view compatibility.
- [ ] 3.2 Build the explorer/read-only code/comparison/PR surfaces with CodeMirror and current file/review components; verify checkout selection, freshness, missing evidence, safe text rendering and no on-open execution.
- [ ] 3.3 Compose TUI/core terminal consumers through current ownership/control paths; verify focus isolation, transfer, hidden detach, replaced occurrences, disconnect and no input replay for both runtimes.
- [ ] 3.4 Provide one-panel phone navigation with accessible 44 px controls; verify actual iOS/Android keyboards, selection/IME, screen readers and retained context.

## 4. Verify and document the delivered slice

- [ ] 4.1 Run all required affected consumer suites, full applicable behavioral verification, platform/SSH checks and fault controls from the approved mapping; preserve resource/identity evidence and independent review.
- [ ] 4.2 Update FEATURES, knowledge map and affected architecture/tutorial guidance to describe actual delivered behavior; synchronize capability deltas only after accepted implementation.
- [ ] 4.3 Replace or retire the design fixture as appropriate and verify exact owner preview clicks on desktop and phone; archive only after implementation and acceptance.
