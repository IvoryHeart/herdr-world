import type { FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import {
  resolveTerminalWindowArrangement,
  type TerminalWindowArrangementPlacement,
  type TerminalWindowArrangementPreset,
  type TerminalWindowArrangementResult,
  type TerminalWindowArrangementStage,
  type TerminalWindowArrangementWindow,
} from "./terminalWindowArrangement";

export type TerminalWindowArrangementParticipant<TPresentation> =
  TerminalWindowArrangementWindow & {
    /** The caller's dock, inline leaf, or Spaces presentation at first arrangement. */
    presentation: TPresentation;
  };

export type TerminalWindowArrangementBaseline<TPresentation> = {
  geometry: FloatingTerminalGeometry | null;
  presentation: TPresentation;
};

export type TerminalWindowArrangementScope<TPresentation> = {
  preset: TerminalWindowArrangementPreset | null;
  restorePreset: TerminalWindowArrangementPreset | null;
  baselines: Readonly<
    Record<string, TerminalWindowArrangementBaseline<TPresentation>>
  >;
  /** Only windows participating in the most recent explicit preset have placements. */
  placements: readonly TerminalWindowArrangementPlacement[];
};

export type TerminalWindowArrangementState<TPresentation> = {
  /** Include selected connection and runtime generation in this key. */
  leaseKey: string;
  /** Use distinct keys for visual Inspectors and each Spaces workspace. */
  scopes: Readonly<
    Record<string, TerminalWindowArrangementScope<TPresentation>>
  >;
};

export function createTerminalWindowArrangementState<TPresentation>(
  leaseKey: string,
): TerminalWindowArrangementState<TPresentation> {
  return { leaseKey, scopes: {} };
}

/** A changed lease retires every scope and its restore snapshots. */
export function terminalWindowArrangementForLease<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  leaseKey: string,
): TerminalWindowArrangementState<TPresentation> {
  return state.leaseKey === leaseKey
    ? state
    : createTerminalWindowArrangementState<TPresentation>(leaseKey);
}

export function applyTerminalWindowArrangement<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  input: {
    leaseKey: string;
    scopeKey: string;
    preset: TerminalWindowArrangementPreset;
    stage: TerminalWindowArrangementStage;
    windows: readonly TerminalWindowArrangementParticipant<TPresentation>[];
    activeId: string | null;
    /** A fresh Spaces scope starts in Single; visual scopes normally use null. */
    initialPreset?: TerminalWindowArrangementPreset | null;
  },
): {
  state: TerminalWindowArrangementState<TPresentation>;
  result: TerminalWindowArrangementResult;
} {
  const current = terminalWindowArrangementForLease(state, input.leaseKey);
  const result = resolveTerminalWindowArrangement(
    input.preset,
    input.stage,
    input.windows,
    input.activeId,
  );
  if (!result.available) return { state: current, result };

  const existing = current.scopes[input.scopeKey];
  const openIds = new Set(input.windows.map((window) => window.id));
  const baselines: Record<
    string,
    TerminalWindowArrangementBaseline<TPresentation>
  > = {};
  for (const [id, baseline] of Object.entries(existing?.baselines ?? {})) {
    if (openIds.has(id)) baselines[id] = baseline;
  }
  const newSnapshot = Object.keys(baselines).length === 0;
  for (const window of input.windows) {
    baselines[window.id] ??= {
      geometry: window.geometry ? { ...window.geometry } : null,
      presentation: window.presentation,
    };
  }
  const scope: TerminalWindowArrangementScope<TPresentation> = {
    preset: input.preset,
    restorePreset: newSnapshot
      ? (input.initialPreset ??
        (existing?.preset === "single" ? "single" : null))
      : existing!.restorePreset,
    baselines,
    placements: result.placements.map((placement) => ({
      id: placement.id,
      geometry: { ...placement.geometry },
    })),
  };
  return {
    state: {
      ...current,
      scopes: { ...current.scopes, [input.scopeKey]: scope },
    },
    result,
  };
}

/** Remove closed participants promptly so a later instance never inherits their baseline. */
export function retainTerminalWindowArrangementWindows<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  input: { leaseKey: string; scopeKey: string; openIds: readonly string[] },
): TerminalWindowArrangementState<TPresentation> {
  const current = terminalWindowArrangementForLease(state, input.leaseKey);
  const scope = current.scopes[input.scopeKey];
  if (!scope) return current;
  const open = new Set(input.openIds);
  const baselines = Object.fromEntries(
    Object.entries(scope.baselines).filter(([id]) => open.has(id)),
  ) as Record<string, TerminalWindowArrangementBaseline<TPresentation>>;
  const placements = scope.placements.filter(({ id }) => open.has(id));
  if (
    Object.keys(baselines).length === Object.keys(scope.baselines).length &&
    placements.length === scope.placements.length
  ) {
    return current;
  }
  return {
    ...current,
    scopes: {
      ...current.scopes,
      [input.scopeKey]: { ...scope, baselines, placements },
    },
  };
}

/** Keep an explicitly moved or resized participant's latest desktop geometry. */
export function updateTerminalWindowArrangementGeometry<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  input: {
    leaseKey: string;
    scopeKey: string;
    id: string;
    geometry: FloatingTerminalGeometry;
  },
): TerminalWindowArrangementState<TPresentation> {
  const current = terminalWindowArrangementForLease(state, input.leaseKey);
  const scope = current.scopes[input.scopeKey];
  if (!scope || scope.preset === "single") return current;
  if (!scope.placements.some(({ id }) => id === input.id)) return current;
  return {
    ...current,
    scopes: {
      ...current.scopes,
      [input.scopeKey]: {
        ...scope,
        placements: scope.placements.map((placement) =>
          placement.id === input.id
            ? { id: input.id, geometry: { ...input.geometry } }
            : placement,
        ),
      },
    },
  };
}

/** Read-only presentation; a later open stays normally placed in multiwindow modes. */
export function terminalWindowArrangementPlacements<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  input: {
    leaseKey: string;
    scopeKey: string;
    stage: TerminalWindowArrangementStage;
    windows: readonly TerminalWindowArrangementWindow[];
    activeId: string | null;
    compact?: boolean;
  },
): TerminalWindowArrangementPlacement[] | null {
  if (state.leaseKey !== input.leaseKey) return null;
  const scope = state.scopes[input.scopeKey];
  if (!scope && !input.compact) return null;
  if (input.compact || scope?.preset === "single") {
    const single = resolveTerminalWindowArrangement(
      "single",
      input.stage,
      input.windows,
      input.activeId,
    );
    return single.available ? single.placements : null;
  }
  if (!scope || !scope.preset) return null;
  const openIds = new Set(input.windows.map((window) => window.id));
  return scope.placements
    .filter(({ id }) => openIds.has(id))
    .map(({ id, geometry }) => ({ id, geometry: { ...geometry } }));
}

/** Return only still-open first snapshots; interpretation belongs to the shell. */
export function restoreTerminalWindowArrangement<TPresentation>(
  state: TerminalWindowArrangementState<TPresentation>,
  input: { leaseKey: string; scopeKey: string; openIds: readonly string[] },
): {
  state: TerminalWindowArrangementState<TPresentation>;
  targets: {
    id: string;
    baseline: TerminalWindowArrangementBaseline<TPresentation>;
  }[];
  preset: TerminalWindowArrangementPreset | null;
} {
  const current = terminalWindowArrangementForLease(state, input.leaseKey);
  const scope = current.scopes[input.scopeKey];
  if (!scope) return { state: current, targets: [], preset: null };
  const open = new Set(input.openIds);
  const targets = Object.entries(scope.baselines)
    .filter(([id]) => open.has(id))
    .map(([id, baseline]) => ({
      id,
      baseline: {
        geometry: baseline.geometry ? { ...baseline.geometry } : null,
        presentation: baseline.presentation,
      },
    }));
  const scopes = { ...current.scopes };
  if (scope.restorePreset === null) {
    delete scopes[input.scopeKey];
  } else {
    scopes[input.scopeKey] = {
      preset: scope.restorePreset,
      restorePreset: null,
      baselines: {},
      placements: [],
    };
  }
  return {
    state: { ...current, scopes },
    targets,
    preset: scope.restorePreset,
  };
}
