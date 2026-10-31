import type { TerminalMarkPut } from "../terminal-marks";

export function terminalMarkInput(
  kind: TerminalMarkPut["kind"],
  terminal = "terminal-a",
): TerminalMarkPut {
  const current = {
    adapter: "herdr",
    instance: "alpha",
    service_incarnation: "synthetic-incarnation",
    generation: 1,
  };
  const entity = {
    native_id: `pane-${terminal}`,
    terminals: [terminal],
    session: "a".repeat(64),
  };
  return {
    kind,
    body:
      kind === "desk"
        ? {
            reviewed_stop: "stop-a",
            stopped_at: 1000,
            opened_at: 1000,
            observed_stop_id: "stop-a",
            stateChangeSeq: 4,
          }
        : kind === "watchlist"
          ? { label: "Synthetic watch" }
          : { stateChangeSeq: 4 },
    target: {
      adapter: "herdr",
      instance: "alpha",
      kind: "pane",
      native_id: entity.native_id,
      evidence: {
        terminals: [terminal],
        ...(kind !== "watchlist" ? { session: entity.session } : {}),
      },
    },
    event: {
      type: "listing",
      complete: true,
      fence: current,
      entities: [entity],
    },
    current,
  };
}
