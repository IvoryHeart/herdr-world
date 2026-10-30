/**
 * Work the dense World browser suites may do, whatever the runner's speed.
 * Counts come from the production modules (devtools/renderer.ts
 * countWorldWork) and the fixtures' own instrumentation, per stress phase or
 * stage; none depends on timing. A phase or kind missing from a ceiling allows
 * none of that work, so new work in a phase fails until a reviewed change
 * names and bounds it. The values are those measured on 2026-10-30, identical
 * on an unconstrained and a single-CPU run.
 */

export type WorkByPhase = Record<string, Record<string, number>>;

/** Each count above its phase's ceiling, as a readable violation. */
export function workViolations(
  observed: WorkByPhase,
  ceilings: WorkByPhase,
  label: string,
): string[] {
  const violations: string[] = [];
  for (const [phase, work] of Object.entries(observed))
    for (const [kind, count] of Object.entries(work)) {
      const limit = ceilings[phase]?.[kind] ?? 0;
      if (count > limit)
        violations.push(`${label} ${phase}: ${kind} ${count} > ${limit}`);
    }
  return violations;
}

/** Board's projection of a 64-host dense snapshot's hosts. */
const BOARD_HOSTS = { "board.host-project": 64 };
/** Preparing one dense snapshot in production (runtimeStore.ts). */
const ONE_SNAPSHOT = {
  "world.prepare": 1,
  // Construction units (host and node batches), not slices: a slice also
  // ends after 8 ms.
  "world.build-units": 917_568,
  ...BOARD_HOSTS,
};

/** ProductionContexts: one preparation and one view projection per stage. */
export function productionWorkCeilings(view: string): WorkByPhase {
  const stage = {
    ...ONE_SNAPSHOT,
    ...(view === "board" ? { "board.project": 1 } : { "office.project": 1 }),
  };
  return { initial: stage, refresh: stage };
}

export type ConcurrentWork = {
  worldWorkByPhase: WorkByPhase;
  terminalWorkByPhase: WorkByPhase;
  boardObserverWorkByPhase: WorkByPhase;
  boardRenderByPhase: Record<string, { commits: number }>;
  worldBuildUnits: number;
  worldBuildMaxSliceNodes: number;
  /** Card observations still live after Board unmounts (-1: not recorded). */
  liveCardObservations: number;
};

/** ConcurrentContexts: dense load at either width, per stress phase. */
export function concurrentWorkViolations(
  measured: ConcurrentWork,
  width: number,
): string[] {
  const cards = width === 1440 ? 1280 : 80;
  const violations = [
    ...workViolations(
      measured.worldWorkByPhase,
      {
        // The fixture prepares and projects the snapshot once (its own
        // preparation calls count units below, not here).
        projection: { ...BOARD_HOSTS, "board.project": 1, "tree.project": 1 },
        // Mounting Board projects its World once.
        render: { "board.project": 1 },
        // A status refresh prepares the new snapshot and Board projects it.
        refresh: { ...BOARD_HOSTS, "board.project": 1 },
        // Terminal output does no World work at all.
      },
      "world work",
    ),
    ...workViolations(
      Object.fromEntries(
        Object.entries(measured.boardRenderByPhase).map(([phase, render]) => [
          phase,
          { commits: render.commits },
        ]),
      ),
      {
        render: { commits: width === 1440 ? 6 : 7 },
        refresh: { commits: 2 },
      },
      "Board",
    ),
    // Dense load mounts, fits and disposes no terminal.
    ...workViolations(
      measured.terminalWorkByPhase,
      { "outside-stress": { open: 5, dispose: 5, fit: 20 } },
      "terminals",
    ),
    // Cards register once when rendered; refresh and output re-register none.
    // Teardown releases them per card (unobserve) or all at once (Board's
    // disconnect), in an order React does not fix, so releases are bounded,
    // not counted exactly.
    ...workViolations(
      measured.boardObserverWorkByPhase,
      {
        render: { observe: cards },
        "outside-stress": { unobserve: cards },
      },
      "card observers",
    ),
  ];
  // Counters that stop reporting must not pass as "no work".
  if (measured.worldWorkByPhase.projection?.["board.host-project"] !== 64)
    violations.push("world work counters did not report Board's preparation");
  const terminals = measured.terminalWorkByPhase["outside-stress"] ?? {};
  if ((terminals.dispose ?? 0) !== (terminals.open ?? 0))
    violations.push("terminals: every opened terminal must be disposed");
  const registered = measured.boardObserverWorkByPhase.render?.observe ?? 0;
  if (registered !== cards)
    violations.push(
      `card observers: ${registered} registered while rendering, expected ${cards}`,
    );
  // Whichever path teardown takes, nothing may stay observed.
  if (measured.liveCardObservations !== 0)
    violations.push(
      measured.liveCardObservations < 0
        ? "card observers: live observations after unmount were not recorded"
        : `card observers: ${measured.liveCardObservations} still observed after unmount`,
    );
  if (measured.worldBuildUnits > 1_835_136)
    violations.push(`world build units ${measured.worldBuildUnits} > 1835136`);
  if (measured.worldBuildMaxSliceNodes > 256)
    violations.push(
      `world build slice of ${measured.worldBuildMaxSliceNodes} nodes > 256`,
    );
  return violations;
}
