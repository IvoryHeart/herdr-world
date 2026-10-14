# Browser observation foundation contract

## Intended behavior

Source requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `web/src/world/runtimeStore.ts`. Accepted source delivery: PR #145;
reviewed foundation: PR #188 at `5d73319b`.

Allowed: repeated refresh requests coalesce while one request is outstanding;
disconnect retains unavailable topology; a fresh successful request restores
current observation. Forbidden: an old epoch publishes after disconnect, admitted
owners disappear silently, or ownership is substituted while reporting success.

## Model and implementation mapping

`quint/browser-refresh.qnt` maps `epoch` to observation authority,
`pending` to the request's captured epoch, `queued` to coalesced refresh intent,
`issued` to actual calls, `admitted` to the last published epoch, and `revision`
to publication count. `replayRefresh` invokes the real store through a recording
public refresh entry point and controlled client replies. `disconnect` invokes
the actual status listener. `complete` releases the pending reply and awaits real
preparation, publication and any queued dispatch. These are one model transition;
mid-preparation interleavings are not explored by this foundation.

Every boundary checks status, revision and catalogue cardinality. An admitted
connection must have its expected synthetic ID, generation and actionability.
Observation epoch is not a connection generation; consumer qualification remains
separate evidence.

## Properties, witnesses and negative controls

`safety` prevents publication from retired observation epochs and bounds in-flight
requests. Actual replay counts `lateReply`, `coalescedFollowup` and `restored`.
A faulty model bypasses epoch authority and must fail `refresh.status` in production
counterexample replay. A compiled epoch-guard mutation must fail an allowed refresh
observation. A separate dropped-catalogue mutation must fail
`refresh.connections.count`. Owner and generation substitutions have cheap harness
regressions. Codec, adapter, unrelated assertions and cleanup errors fail the run.

## Domain, environment and limitations

Epochs 0–3, at most six requests, successful well-formed replies, seeds 42/73/103,
500 samples and 100 production replays per seed, up to 25 transitions. Larger
epoch/request bounds 5/10 provide separate finite sensitivity. TLC verifies finite safety;
no temporal claim. Fixtures use one connection and a null snapshot. Per-host
retirement during preparation/admission, failure, priority changes and real
browser debounce/fallback timers are outside this foundation. The preparation
companion covers per-host stages, failures and priority follow-ups. Real browser tests
remain necessary; this model does not establish their timing or rendering.

## Evidence and promotion

Use the maintained verification commands and complete input-fingerprinted manifest.
  Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
