# Aggregate observation progress assessment

## Requirement and selected evidence

`openspec/specs/runtime-federation/spec.md`, “Return bounded aggregate observation
with host-local progress”, requires a complete catalogue within 20 seconds, at
most four concurrent observations, independent host publication, fair priority
admission and background attempts as bounded slots become available. This is a
progress requirement, distinct from the browser models' stale-publication safety.

The independently accepted executable alternative is the actual `WorldSnapshotService` controlled scheduler suite in `server/src/world/snapshot.test.ts`, accepted with these assumptions in review 5516249164. Browser/lease reachability witnesses cannot discharge this requirement; no temporal Quint proof is claimed. Mandatory scheduler/transport/lease consumers remain required by delivery.

## What the implementation evidence establishes

- “32-host catalogue preserves healthy background progress with three stalled
  priority owners” holds the three priority transports, waits for all 29 healthy
  hosts to complete, checks all 32 unique attempts and maximum concurrency four,
  and only then releases the stalled transports. This demonstrates healthy work
  progressing before the stalled owners, not just after test cleanup.
- “completion of the open owner releases the fourth slot to healthy background
  work” holds three stalled peers and one open owner. Only releasing the open
  owner must cause actual healthy-host admission on a cooperative task turn.
- “repeated priority invalidations rotate initial admissions and preserve
  background progress without refetching cached hosts” uses eight hosts, five
  priorities, overlapping reversed requests and eight rounds. Each round admits
  three priority and one background owner initially; every host is eventually
  attempted once after release. Initial turns rotate across both groups, and
  cache reuse does not consume another observation attempt.
- The stalled-host deadline scenario uses the production response-deadline seam
  at 15 ms. It checks the complete catalogue and non-actionable unfinished topology
  while the native request remains held. Production's default is 20,000 ms; the
  accelerated test is deadline-mechanism evidence, not a real-time proof for every
  workload or machine. Retirement/construction and ordinary-task-turn regressions
  separately retain authority and control responsiveness evidence.

## Assumptions and excluded claims

The event loop must eventually run timers and cooperative turns. Projection is
bounded and returns; real downstream calls must honor their requested 5-second
budget or settle/cancel so a slot becomes available. The finite catalogue/work
queue must retain its owned lease or be retired; lifetime-invalid work is skipped.
A snapshot response deadline does not cancel arbitrary noncompliant transports
or itself release their observation slots. Four permanently occupied slots
therefore do not guarantee a fifth attempt until completion/retirement frees one.
Likewise, the tests do not establish eventual success for a permanently failing
host or fairness under every infinite arrival/invalidation schedule.

The scheduling code caps active work at four, gives background turns after three
priority starts when a background slot is available, reserves room for selected
work when background work is active, and rotates initial groups across newly
scheduled hinted rounds. These code mappings explain the tested scenarios; they
are not substituted for an independently reviewed temporal proof.

## Assessment decision and promotion

Candidate decision: retain the controlled real scheduler/deadline tests as the
progress evidence, separate from maintained model safety. The progress assessment
is complete and its adequacy remains an explicit contract-specific review item.
If review requires an all-schedules eventual-attempt claim, first define queue,
arrival, completion/failure and weak/strong fairness assumptions, then add a
separate temporal model and real scheduler mapping. Do not relabel successful
reachability witnesses as liveness or silently weaken the current product promise.
