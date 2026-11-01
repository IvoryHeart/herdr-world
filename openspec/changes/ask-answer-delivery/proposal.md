## Why

An agent that asks without `--wait` does not receive the owner's answer in its
pane. Add delivery of one stored answer to its verified original asker while
preserving retrieval and honest recovery when submission is uncertain.

## What Changes

- Declare `world.ask.deliver-answer` as a queueable, state-conditioned, opaque
  verb under #549's effect rules. Store one reference-only intent with the answer.
- Capture the original session binding; check the answering actor's current
  policy, unchanged target state and supported version before dispatch.
- Use Chat's existing guarded send path. Keep Chat and terminal input direct.
- Coordinate with `ask get`/`--wait` through an exact-answer acknowledgement after
  successful stdout output; avoid backfilling historical answered asks.
- Expose delivery notices for answered asks and explicit owner resend/close
  decisions. Preserve the existing Reception look through an Opus design pass.
- Keep dismissals in retrieval; do not invent an answer or add dismissal prompts.

## Capabilities

### New Capabilities

- `ask-answer-delivery`: Delivery and recovery of one stored answer to its bound
  asker, including verified CLI acknowledgements and authorized owner decisions.

### Modified Capabilities

None. This proposal adds a consumer under world-effects without making Chat sends
queueable. The existing storage, authority and direct-send contracts remain binding.

## Impact

Depends on the SQLite foundation, its reviewed lifecycle, and #549's identity and
effect contracts. Affects ask answer/get handlers, the declared-verb/outbox
consumer, the existing Chat adapter, CLI output/acknowledgement and a bounded
Reception delivery-notice query. No new runtime, transcript store, Chat queue,
workflow authoring model or third-party dependency. Design authorized; this
proposal records planned PR 2, not an implemented or accepted capability.
