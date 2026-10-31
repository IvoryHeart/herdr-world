# Verb registry and actor policy (P4)

## Requirements and boundary

The registered browser/agent boundary in `openspec/specs/bridge-access/spec.md`
requires unchanged actor policy, explicit acknowledgements, refusal of unknown
methods and honest staged evidence. The full protocol change also plans separate
resource and assistant catalogs and observation-linked command tracking. This
contract does not claim those later integrations.

Allowed scenarios: ordinary CLI edits from either CLI actor; a verified answer
from another agent; native layout edits with their existing flags; the owner's
browser-confirmed PR action. Forbidden scenarios: unknown native forwarding;
CLI forge mutations/Herdr deletions; missing effect flags; unverified answers and
spawn claims; a retired runtime sending; memory-only success labelled stored.

## Evidence

- `server/src/verbs/policy.test.ts`: every registry entry × six actors equals the
  independently recorded policy table; production literal browser calls are
  registered. Interactive input, Chat sends and pane answers remain opaque.
- `server/src/verbs/compatibility.test.ts`: all 31 existing CLI commands × both
  CLI actors retain pre-registry success/refusal codes and native effects. The
  fixture was recorded by executing the base implementation's `world-cli.ts`
  against the same synthetic topology, not by reading the new registry.
- `server/src/verbs/admission.test.ts`: TypeBox inputs/results, conditional flags,
  browser-only confirmation, current authorization/capabilities/preconditions.
- `server/src/verbs/dispatch.test.ts`: actual dispatcher refuses before native
  calls; socket authority and runtime currency are rechecked; acknowledged native
  effects and uncertain input retain exact ownership.
- `server/src/verbs/cli-entry.test.ts`: actual CLI refuses missing flags before
  host acquisition; memory-only replies stay accepted; unverified limits hold.
- `server/src/world/world-cli-authorization.test.ts`: deterministic held native
  reads/sends, snapshots and queued ledger mutations across service stop retain a
  current runtime lease but refuse the revoked command without effects. Answer
  recording also rechecks after held recipient resolution and ledger work.
- `server/src/verbs/recovery.test.ts`, dispatcher link resolution and
  `server/src/bridge/endpoint-terminal-session.test.ts`: PR/link reads remain
  reads, file-manager launch is opaque, and the actual page-key path sends native
  input and therefore declares opaque recovery.
- `server/src/verbs/evidence.test.ts`: durable and observation receipts are
  mandatory for their stages; sent/uncertain evidence requires runtime ownership.
- `server/src/service/world-service.test.ts`: the composed service's ask commits
  before issuing its durable ledger receipt, including shutdown with a held read.
- Existing CLI/group, group-move, Sources, settings and terminal suites remain
  mandatory consumers of their unchanged domain-specific policy and validation.

P4 uses a direct exhaustive policy table rather than a Quint model: the policy
domain is finite, and the meaningful evidence is execution through the real
admission/dispatch boundaries. Existing runtime and storage models retain their
own ordering/recovery claims; this table does not expand those claims.
The held-work schedules directly exercise the CLI service's independent abort
authority with a deliberately current lease. This boundary is not represented
by the runtime retirement model; deterministic callback gates distinguish the
authorization checks without adding a second lifecycle model.

## Negative controls

Each new test was run against a fault that makes it fail: allow a denied actor;
skip TypeBox; skip acknowledgements; skip confirmation; skip authorization;
mislabel acceptance as stored; accept unqualified dispatch evidence; bypass CLI
admission; change the baseline actor policy; drop a browser registration; forward
unknown methods; omit the native send recheck; omit sent evidence; deny formerly
allowed CLI edits; omit the durable-store receipt. These controls establish
sensitivity, not completeness of every domain owner's validation.
Review repair additionally demonstrated the authorization schedules failing on
the original implementation and recovery assertions failing on the incorrect
declarations; removing the answer-record guard or restoring those recovery
declarations is a negative control.

## Required checks and acceptance

Run `bun run test server/src/verbs/` and the affected consumer suites. The normal
pre-push `check:changed` and protected CI `Delivery checks` remain required; CI
runs full selected behavioral verification for changed contract inputs. Independent
PR review accepts this new boundary and its consumer mapping separately from the
existing model acceptance. The new Q45 mapping is pending that review and CI.
