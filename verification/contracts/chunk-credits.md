# Socket-local snapshot credit contract

## Intended behavior

Requirements: [runtime federation](../../openspec/specs/runtime-federation/spec.md)
and [bridge access](../../openspec/specs/bridge-access/spec.md).
Owner: `server/src/bridge/world-snapshot-admission.ts`; accepted source PR #186.

Allowed: up to two concurrent aggregate transfers per socket; one expected batch
credit per transfer; independent colliding IDs on other sockets; released capacity
can admit a fresh transfer. Forbidden: another socket/request/index releasing a
wait, duplicate pending waits, a third live transfer, and retired transfers keeping
pending promises/timers. Credits are read-only protocol frames, never downstream
runtime operations. Closing an already resolved wait does not reject it again.

## Model and implementation mapping

`chunk-credits.qnt` models three candidate requests on one socket and one colliding
request on another. The reduced asymmetric domain retains capacity overflow and
cross-socket ownership without duplicating unrelated permutations. `slots` records
new/open/waiting/closed handles and expected logical batch index; `live` bounds
caller retirement. Event fields identify wire socket/request/index and observed
release/rejection. Logical batch indices 0/1/2 replay as actual wire indices 3/7/11.

`chunk-credits.ts` invokes the real admission class. Open/duplicate-open and wait
failures are checked against their documented capacity/pending/retired errors.
Acknowledgement compares newly resolved counts and the actual captured
socket/request/index of the resolved promise. All outstanding waits are checked
for pending/settled state and expected index. Close/retire checks new rejection
and settlement of every affected wait. Finally retires both sockets and drains
all owned tasks; no timer is left for the supervisor to ignore.

## Properties, witnesses and negative controls

`safety` independently constrains capacity, released socket/request/index authority,
and absence of active retired ownership. Actual witnesses cover fresh-capacity
denial, wrong socket/index, duplicate pending waits, cancellation on retirement
and capacity reuse. Every seed replays all 500 sampled paths and must reach each
actual witness. The direct regression exercises all six and confirms that closing
a previously credited handle leaves its promise settled.

The faulty model releases a peer socket's matching request: counterexample replay
must fail `credits.released`. A compiled storage/lookup fault shares credits across
sockets and must fail a named credit observation. A separate compiled index-guard
fault must fail `credits.released` when the expected batch differs. Trace, generic
adapter and cleanup errors cannot count as kills. A direct regression also checks
retained closed-handle behavior after a new transfer reuses its ID.

## Composition assumptions and limitations

Wire credits have socket, request ID and batch index; no runtime generation is
encoded. The Bridge caller supplies monotonically increasing request IDs within
its lifetime/socket, and retired socket callbacks cannot create new transfers.
The model opens each request ID once per socket. Reusing an ID and batch index
would make an old acknowledgement indistinguishable from a new one; the admission
class alone cannot prove immunity to that caller violation. Closed-handle identity
protection does not create an on-wire generation fence.

The domain has two sockets, four modeled handles, three valid batch indices and
one active wait per handle. Two same-socket transfers exercise capacity two;
colliding peer requests exercise isolation. Larger chunk counts, malformed frame
shape, real timeout and the four-chunk sender window retain actual protocol tests.
No temporal progress or network delivery guarantee is claimed. The protocol integration regression connects the real sender, admission, Bridge
assembly and World store: partial chunks remain unpublished, queued credits are
suppressed after transport retirement, and runtime replacement during byte
admission stales only the captured owner. Dedicated browser assembly modeling
remains pending.

## Evidence and promotion

Use the full maintained verification command. Focused development may run
`bun experiments/quint/run.ts --case chunk-credits`; its manifest covers only that
selected model and cannot substitute for the full command. TLC checks finite
safety; all three seeds require production witnesses and both code controls.
This contract and consumer assumptions await independent promotion review.
Q12 records partial credit evidence while assembly/composition remains pending.
