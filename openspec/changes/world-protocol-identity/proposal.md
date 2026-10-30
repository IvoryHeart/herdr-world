## Why

Every Herdr event makes every browser fetch and rebuild the whole multi-host world.
Every client also acquires its own data. World-owned records have no durable identity,
so annotations keyed by Herdr runtime IDs go stale when Herdr restarts. Planned work
(shared acquisition, `world.sqlite`, the workflow substrate, adapters) needs agreed
contracts before it is built. The architecture committee (2026-10-30, item 6) asked for
this design. The owner approved the plan with two corrections: Herdr is the only runtime,
and the workflow authoring model stays undecided.

## What Changes

- **Observation v1: changed-host replacement.** A browser names the base it holds. The
  service confirms unchanged hosts without a body and replaces changed hosts whole. Every
  reply names the service incarnation and each host's connection and runtime generation.
  An unknown base or a new incarnation recovers through the existing bounded complete
  snapshot. Browser preparation becomes incremental: unchanged hosts and rooms are reused,
  and one status change prepares only what depends on it.
- **Shared acquisition** is not specified here. The separate `shared-acquisition`
  change (committee item 14) owns stage 2: the poll replacement and its parity tests,
  service-pushed recency and catalogue, and Desk screens and turns watched once per
  pane. This change only fixes the owner key that change uses for interests: the
  connection ID and runtime generation, plus the agent session when the resource is
  session-scoped.
- **Observation v2: World subscriptions,** gated on evidence from Herdr and World's own
  consumers. Named queries, cursors of {incarnation, subscription generation, sequence},
  a watch installed before the bootstrap watermark, paged credited bootstrap, resume or
  explicit reset, three delivery lanes beside the unchanged terminal path, and the
  composition algebra for coalescing.
- **Fences and durable identity.** Fence fields stay separate. World-owned records get
  short World-issued IDs and verified source bindings, generalised from Board's terminal
  witnesses. Fields with several sources carry per-field claims with provenance. Desk
  marks, the watchlist and "seen" can later persist against these bindings.
- **Verbs with actor policy.** One static registry of typed verbs with required
  capabilities, a policy per actor, preconditions, a recovery class and staged result
  evidence. Migration keeps today's policy exactly.
- **Adapters.** Descriptors (capabilities, kinds, verbs, configuration, limits), a static
  in-repo registry, and a shared conformance suite run against a synthetic test source
  that behaves unlike Herdr. Herdr is the only real runtime.
- **Per-terminal settings in Herdr pane metadata.** Profile assignment and the Town
  master move from World's profile file to namespaced pane tokens that name their
  terminal. Every World on that Herdr then shares them, and they end with the terminal.
- **The workflow boundary.** Only the paradigm-neutral substrate: intents and effects
  through a transactional outbox, fenced attempts, a durable inbox for correlated
  signals, the recovery matrix, operation-version pinning, and clock and scheduler
  ports. No workflow authoring model.
- **Verification plan** (`verification-plan.md`): Quint models for v1 base admission,
  v2 resume, binding resolution and effect recovery; property suites for composition,
  adapter conformance and verb policy; and how Q12–Q14 and their consumer areas are
  re-mapped at each stage.

This PR is specification only. Look and feel stay identical and no feature is cut. Each
part ships with its own implementation PR, which updates the affected docs and evidence.

## Capabilities

### New Capabilities

- `world-identity`: World IDs, verified source bindings, fences kept apart from identity,
  per-field claims and explicit record lifetimes.
- `world-adapters`: adapter descriptors, the static registry, the conformance suite and
  the synthetic test source.
- `world-effects`: intents, the outbox and inbox, fenced attempts, the recovery matrix,
  operation versions, durable deadlines and the clock and scheduler ports.

### Modified Capabilities

- `runtime-federation`: service incarnation, observation v1, incremental preparation,
  event-class repair and World subscriptions v2.
- `bridge-access`: registered verbs with actor policy and staged command evidence.
- `world-surfaces`: per-terminal settings live with the terminal in Herdr.

## Impact

Later implementation PRs touch:
- **Observation:** `server/src/world/snapshot.ts`, the snapshot reply and admission
  bridges, the connection manager (incarnation), `web/src/world/runtimeStore.ts` and the
  Town, Board and shell preparation;
- **Command surfaces:** RPC dispatch, `server/src/sources/` and the agent CLI;
- **Settings:** `server/src/agent/profile-store.ts` and the Herdr metadata writers;
- **New modules:** identity, effects and adapters;
- **Evidence:** the Quint models, `verification/coverage.json` and its contracts.

No new dependency is required:
- TypeBox is already a server dependency, and verbs are validated on the service.
- `bun:sqlite` ships with Bun.
- Property tests use seeded generators. Adding `fast-check` would be a separate
  dependency decision.

## Decisions already made by the owner

- Proceed with the architecture committee's plan (its 2026-10-30 report), adjusted:
  - Herdr is the only runtime. Where the plan names a second, non-Herdr source, a
    synthetic test source takes its place.
  - No workflow authoring model is designed or built here.
- Per-terminal settings (profile assignment, Town master) live in Herdr pane metadata.
- Look and feel stay identical; features are not cut.

## Defaults chosen here (the owner may override any)

1. **v1 is a based pull, not a push.** `world_invalidated` stays the trigger, so Q14's
   one-in-flight refresh model survives v1 unchanged in shape. v1 is negotiated through
   the hello capability `world_observation_v1`.
2. **Host tokens are opaque.** Equal tokens mean identical projected content for the
   same runtime generation. The default implementation is a digest of the projected host.
3. **Service incarnation** (`service_incarnation` in the WebSocket hello) is a random
   value per start. It resets every base, cursor and generation-qualified token of the
   previous process.
4. **World IDs are short and store-issued** (a kind prefix and a counter), never UUIDs or
   source IDs, following the owner's identity direction. A global name, when needed,
   uses the owner's agent URI scheme.
5. **Lifetimes don't change.** The watchlist, Desk marks and completion "seen" keep their
   current lifetimes until the owner approves persisting them.
6. **Change history retention:** observation changes live in a bounded memory ring.
   World-owned change rows are kept 24 hours or 10,000 revisions, whichever is longer.
   Pending domain state is kept until it is resolved, whatever its age.
7. **Offline intents are state-conditioned, never time-expired** (owner, 2026-10-21).
   Only verbs that declare themselves queueable can be queued. Terminal input and Chat
   sends never are.
8. **Profiles stay per World.** A profile assignment shared through Herdr resolves
   against each World's own profiles. A World that lacks the profile shows the recorded
   name with the default look.
9. **Town master uniqueness:** across all observed hosts, the claim with the highest
   revision wins; ties break by qualified terminal key. Superseded claims are cleared.
10. **The synthetic source is test-only.** It is never registered in production builds.
11. **The v2 gate** has four parts (design §6):
    - **Herdr evidence:** the event-class inventory, plus a working day of zero
      shadow-diff mismatches on 8788;
    - **Consumer evidence:** the consumer inventory mapped to queries, plus the ask,
      notice and run queries;
    - **Synthetic source:** a passing conformance run;
    - **Verification:** passing resume and composition checks, and the owner-approved
      Q12–Q14 re-mapping.

## Owner questions

None blocking. Each item above has a default.

The Herdr facts this design relies on come from the 2026-10-30 event-class inventory
(a disposable `herdr --session` run) and the Herdr 0.9.3 source (design, Context):
- Terminal IDs are allocated fresh from time and a counter, and are never restored.
- Metadata tokens are stored on the terminal. They follow `pane.move`, and a Herdr
  restart does not restore them.
- Lifecycle events are live-only. They carry no cursor and no snapshot boundary.

The per-terminal settings seat confirms the token behaviour on a disposable
`herdr --session` before shipping.
