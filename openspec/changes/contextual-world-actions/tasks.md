## 1. Specification and baseline

- [x] 1.1 Validate this OpenSpec change and reconcile the current branch against its selected-host,
  Inspector, and hidden-Spaces requirements.
- [x] 1.2 Identify and remove the forced visual-to-Spaces routing introduced by the cleanup branch.

## 2. Shared command boundary

- [x] 2.1 Add a handled-action result to the shared command runner and apply it to pointer,
  keyboard-number, and other action entry points.
- [x] 2.2 Keep one World query surface and the complete shared model-action catalog while making
  target-sensitive visual focus handling explicit and generation-qualified.

## 3. World contextual dispatcher

- [x] 3.1 Register a view-aware World action handler from the mounted visual control plane.
- [x] 3.2 Resolve tab and agent focus targets from the selected current-generation
  WorldObject with deterministic multi-pane behavior.
- [x] 3.3 Reuse the existing exact-focus and Inspector admission path without changing view,
  selected host, or terminal ownership.
- [x] 3.4 Preserve shared model-action fallthrough and fail closed only for stale, foreign, missing,
  or rejected visual focus targets.

## 4. Verification and delivery

- [x] 4.1 Add unit coverage for shared action handling, target resolution, and fail-closed behavior.
- [x] 4.2 Extend mounted browser coverage for visual action parity and a view-preserving terminal
  focus handoff.
- [x] 4.3 Run formatting, lint, typecheck, focused tests, `npm run spec:check`, and the complete
  repository check.
- [ ] 4.4 Update the changelog/PR description with the contextual action contract and deliver the
  corrected branch through an independently reviewed PR.
