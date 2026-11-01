import type { BindingEntity } from "./binding-types";
import { bindingObservationAmbiguous } from "./binding-resolution";
import { askSessionFingerprint } from "./world-cli-actor";

/** A complete terminal projection may omit pane IDs; every reported identity must be unique. */
export function bindingPaneTerminals(panes: unknown): Set<string> | null {
  if (!Array.isArray(panes)) return null;
  const terminals: BindingEntity[] = [],
    native: BindingEntity[] = [];
  for (const pane of panes) {
    if (
      !pane ||
      typeof pane !== "object" ||
      Array.isArray(pane) ||
      typeof pane.terminal_id !== "string" ||
      !pane.terminal_id
    )
      return null;
    if (pane.pane_id !== undefined) {
      if (typeof pane.pane_id !== "string" || !pane.pane_id) return null;
      native.push({ native_id: pane.pane_id, terminals: [] });
    }
    // The explicit unknown session binds to its terminal, never to a shared unknown token.
    const session =
      pane.agent_session?.kind === "unknown"
        ? undefined
        : askSessionFingerprint(pane.agent_session);
    terminals.push({
      native_id: pane.terminal_id,
      terminals: [pane.terminal_id],
      ...(session ? { session } : {}),
    });
  }
  if (
    bindingObservationAmbiguous(native) ||
    bindingObservationAmbiguous(terminals)
  )
    return null;
  return new Set(terminals.map((entity) => entity.native_id));
}
