# Specifications

Specifications in this directory record important product decisions. They are
not required for routine upstream synchronization, bug fixes, dependency
updates, refactors, tests, documentation, or releases.

Use a spec when the repository owner asks for one or when a genuinely new
cross-cutting product/API contract needs a decision. Prefer one short current
document for one coherent outcome. Do not create a new number for each
implementation tranche, review correction, release candidate, or repository
move.

## Lightweight workflow

1. State the problem, decision, boundaries, and observable acceptance criteria.
2. Get the repository owner's approval when the decision is not already
   explicit in the task.
3. Implement and validate it in normal reviewable commits.
4. Update or supersede the document if the product direction changes. Git
   history preserves the earlier decision.

Delivery summaries and extensions are optional. Create one only when it adds
useful information that is not already clear from the pull request, tests,
changelog, and Git history.

Historical specs and summaries remain evidence of earlier work. A current spec
may explicitly supersede several drafts so future agents have one place to
look.
