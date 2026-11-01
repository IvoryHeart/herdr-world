import { validDeskIdentity } from "../../../shared/deskState";
import { validateEvent } from "../storage/world-bindings";
import type { BindingEntity, BindingFence } from "./binding-types";
import { deskSessionFingerprint } from "./desk-observation";

export class TerminalMarkObservationRefused extends Error {
  constructor() {
    super(
      "Terminal mark observation refused: invalid or incomplete native pane identity",
    );
  }
}

/** Validate the whole listing; filtering bad rows would fabricate absence proof. */
export function terminalEntities(
  panes: readonly Record<string, unknown>[],
  fence: BindingFence,
): BindingEntity[] {
  const entities = panes.map((pane) => ({
    native_id: typeof pane.pane_id === "string" ? pane.pane_id : "",
    terminals: typeof pane.terminal_id === "string" ? [pane.terminal_id] : [],
    ...(deskSessionFingerprint(pane.agent_session)
      ? { session: deskSessionFingerprint(pane.agent_session)! }
      : {}),
  }));
  try {
    validateEvent({ type: "listing", fence, complete: true, entities }, fence);
    if (
      entities.some(
        (entity) =>
          entity.terminals.length !== 1 ||
          !validDeskIdentity({
            connection_id: fence.instance,
            connection_generation: fence.generation,
            terminal_id: entity.terminals[0],
            agent_session_fingerprint: entity.session ?? null,
          }),
      )
    )
      throw new TerminalMarkObservationRefused();
  } catch {
    throw new TerminalMarkObservationRefused();
  }
  return entities;
}
