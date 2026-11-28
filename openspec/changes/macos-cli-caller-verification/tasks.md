## 1. Caller verification

- [x] 1.1 Reproduce platform selection and refusal/uncertainty failures.
- [x] 1.2 Add bounded macOS socket and ancestry lookup through the shared resolver.
- [x] 1.3 Cover platform, runtime and wrong-pane authority with an injected lookup.
- [x] 1.4 Cover numeric macOS socket/process parsing, ambiguity and limits.

## 2. Ask outcomes and documentation

- [x] 2.1 Preserve refused asks without fallback and retain unknown recording as null.
- [x] 2.2 Exhaust CLI refusal/recording outcomes and actual lost HTTP replies.
- [x] 2.3 Update capability notes, installed guide and verification consumer mapping.

## 3. Verification and delivery

- [x] 3.1 Run focused consumers, quick typecheck, strict delta validation and the full verification gate; record executed evidence in the PR.
- [x] 3.2 Format the intended candidate and inspect the staged diff for scope and whitespace.
- [x] 3.3 Document real macOS verification limits and release follow-up in the handoff design.

## Workflow follow-up

- Push crew/1492 and open a ready PR; the dispatcher owns independent review and CI.
- Owner verifies real macOS callers in an isolated runtime if available.
- After release, the dispatcher posts the shipped version on #1393; this worker does not comment.
