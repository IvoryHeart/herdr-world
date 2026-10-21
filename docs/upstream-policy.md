# Upstream adoption policy

The owner sets adoption policy. Integration agents propose a disposition; independent
reviewers check source coverage, evidence and fidelity. Neither agent may turn a
new feature deferral into standing policy. Protected human approval accepts new
or changed deferrals/divergences, including resolving an outstanding item.

Existing boundaries retain World identity, immutable connection/generation ownership,
one-origin service architecture, isolated state, the React major recorded in UPSTREAM.md and browser evidence.
World owns its service, packaging, release and agent tooling. This is a compatibility
constraint, not a blanket rejection of improvements in those areas. Compatible
adaptation is preferred; a feature requiring a migration is deferred explicitly.
Changing the recorded React major requires explicit review of input, focus and
responsiveness evidence. Changes to this policy and the tracked follow-up backlog
require human approval.

## Dispositions and authority

`upstream/dispositions.json` is the source-controlled, cumulative ledger. Bootstrap
starts at the recorded v0.8.2 baseline; it does not claim a retrospective audit of
older source history. Every commit in each subsequent frozen upstream range,
including release/dependency commits, needs exactly one entry:

- `adopted`: behavior incorporated directly.
- `adapted`: equivalent upstream intent implemented within World boundaries.
- `deferred`: useful behavior pending specified work.
- `divergent`: intentionally different behavior with an explicit policy rationale.

Each entry identifies the full upstream SHA, title, reason, evidence paths/links,
and `reviewedFor` source target. Deferred/divergent entries also require a durable
`followUp` link (`docs/upstream-follow-ups.md` anchor or GitHub issue) and `revisitWhen` condition.
The follow-up describes ownership and acceptance, not merely a label. Do not copy
machine data or credentials into records. Do not put a fabricated human approval
field in the ledger: acceptance is the protected, revision-bound PR review.

The trusted helper compares the ledger with real Git history at export, local and
hosted publication, review planning and final review posting. Missing, duplicate,
unexpected or stale entries fail closed. Historical entries cannot disappear.
Outstanding decisions must be reconsidered against every new frozen target,
including changes outside their original files, with the result explained in the
integration report. Updating `reviewedFor` is an attestation for independent review,
not proof that a model performed semantic analysis.

New deferrals/divergences and changes to historical decisions require human approval;
an agent approval becomes a comment and cannot queue automatic merge. Routine
adoptions/adaptations remain eligible subject to existing sensitive-path controls.
Unchanged outstanding decisions do not block all later syncs, but their revisit
conditions must be checked, and unmet acceptance remains visible.

The reviewer compares the complete range and base policy with the proposed ledger,
not only its summaries. Inaccurate adopted/adapted labels, unsupported exclusions,
unresolved policy decisions or stale follow-ups require changes. Git ancestry,
commit coverage and green tests do not establish feature parity. A merged upstream
commit is not automatically re-offered by a later merge; the ledger and follow-up
are the explicit recovery path for deferred work.
