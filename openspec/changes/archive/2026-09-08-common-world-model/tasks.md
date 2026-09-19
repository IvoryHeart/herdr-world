## 1. Shared model

- [x] 1.1 Add the pure host → space → agent/terminal World model with stable terminal-qualified IDs,
  generic parent links, configured-host state, and admitted tab/action metadata; verify focused model
  tests cover duplicate native IDs, snapshotless hosts, stale state, sibling leaf kinds, and stable
  reclassification.
- [x] 1.2 Preserve validated optional workspace worktree metadata in browser snapshot admission and
  verify malformed data is rejected without exposing repository paths in presentation text.

## 2. Theme projections

- [x] 2.1 Compute the shared World model once in the application and adapt Office to consume it;
  verify existing Office projection and component tests retain their behavior.
- [x] 2.2 Adapt Graph to consume the model and present bounded host roots with space and
  agent/terminal descendants; verify projection tests cover ownership, equal cross-host IDs,
  unavailable hosts, stale descendants, stable identity, priority bounds, and exact overflow.
- [x] 2.3 Generalize Graph layout, search, selection, collapse, details, saved preferences, and
  conversation anchoring for the host-first hierarchy; verify visual and semantic component tests
  cover both collapse levels and leaf activation.

## 3. Contract and validation

- [x] 3.1 Synchronize the implemented delta into the maintained World surfaces specification and
  update source-navigation documentation; verify OpenSpec strict validation passes.
- [x] 3.2 Add the user-facing change to the Unreleased changelog and run focused Graph, Office,
  runtime-admission, lint, build, and repository checks with clean results.
- [x] 3.3 Exercise the host-first Graph in the browser at desktop and compact widths, including
  multi-host, unavailable-host, selection, collapse, search, and terminal overlay behavior; retain
  reviewable evidence in the repository's ignored evidence location.
