# Aggregate reply assembly and decoder ownership

## Intended behavior

Requirements: [runtime federation](../../openspec/specs/runtime-federation/spec.md)
and [bridge access](../../openspec/specs/bridge-access/spec.md).
Owners: `web/src/api.ts`, `web/src/worldSnapshotDecode.ts`; source delivery PR #186.

Allowed: independent interleaved aggregate replies; complete, ordered chunks enter
request-owned decoding; a completed read-only result may remain cached after later
retirement. Forbidden: resolving from partial bytes, mixing requests, accepting
out-of-order/duplicate/changed-total/qualified aggregate chunks, old socket callbacks
finishing a current request, and retired decoders resolving pending queries.

## Model and implementation mapping

`chunk-assembly.qnt` has two logical request cells and four calls per scenario.
Each call gets a fresh actual Bridge request ID; the adapter asserts uniqueness
within the Bridge lifetime, including reconnect. Cell ordinal identifies that
request incarnation; `epoch` is transport authority, not runtime generation.
`next` counts the three admitted chunks. `decoded`, `finished` and `aborted`
distinguish decoder start, completion and retirement. Done results are historical
read-only observations, not a current action lease.

`chunk-assembly.ts` uses a real Bridge over synthetic same-origin sockets. Only
its existing public decoder dependency is controlled: the callback records the
actual received parts and signal, waits on an owned gate, then executes real
`decodeWorldSnapshot`. Partial progress is observed through pending outcome;
complete assembly is observed through the decoder callback's parts/start. Public
RPC outcomes and decoded payload identity are checked after every transition.
No private pending-map or partial-buffer inspection supplies the expected result.
ITF's flat variables are projected into the adapter record before validation.

`fragment` delivers the next actual frame. Explicit malformed transitions reject
the real pending query. `finishDecode` releases actual parsing and waits for its
caller. Disconnect rejects queries, aborts active decoders and advances transport
epoch; reconnect creates another actual socket. `oldSocket` delivers a final
fragment for the current request through a retained old callback, which must do
nothing. The final-fragment case makes the socket fence immediately observable
through decode start. Finally closes transport, releases gates, drains all query
and decoder tasks and restores owned browser globals, including error paths.

## Properties, witnesses and negative controls

`safety` independently prohibits old-socket admission, requires complete/unaborted
decoding before publication, and ties active decoding to captured transport epoch.
Actual per-seed witnesses cover completed result, cancelled decoding, malformed
rejection, parallel requests and old-socket suppression. Direct regressions also
exercise interleaving, all malformed variants, extra chunks during decoding and
late completion after reconnect.

The model fault admits an old final fragment. Counterexample replay must fail
`assembly.decode.starts` against production. A compiled receive-fence mutation
must fail a named assembly observation; a separate index-check mutation must fail
`assembly.outcome` or unexpected decode start. A cleanup regression induces a
real Bridge teardown exception after a valid model mismatch: the generic cleanup
error must propagate and browser globals must be restored. It cannot count as a
successful negative control.

## Domain, environment and limitations

Two cells, four request incarnations, three small chunks per result, transport
epochs 0–2, seeds 42/73/103, 500 simulation samples and 100 replay traces per seed,
up to 25 transitions. TLC verifies finite safety. The decoder dependency preserves
real parsing but controls completion; it does not simulate worker threading.

Real chunk-character/count limits, large off-thread decoding, worker capacity,
worker credit/URL cleanup and browser scheduling remain actual API/decoder/browser
regressions. The [credit contract](chunk-credits.md) owns sender batch admission;
the protocol composition test connects sender, admission, Bridge and World store.
Runtime generation and observation epoch are separate consumer authority. No
network delivery, arbitrary-size or temporal progress guarantee is inferred.

## Evidence and promotion

Canonical verification runs this model and both code controls; focused development
may select only this case and produces a correspondingly scoped manifest. Normal
Bun tests execute the nine direct assembly regressions plus protocol composition.
Q12/Q13 are modeled with explicit consumer/platform boundaries.  Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged; gate/resource delivery still requires final review.
