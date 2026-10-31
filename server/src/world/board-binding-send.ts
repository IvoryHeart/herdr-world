import type { WorldBindings } from "../storage/world-bindings";
import type { BindingEntity, BindingFence } from "./binding-types";
import { askSessionFingerprint } from "./world-cli-actor";

/** Current complete native evidence qualifies the saved string; no other host is tried. */
export async function qualifyBoardSend(
  bindings: WorldBindings,
  request: {
    record_id: string;
    slot: string;
    pane_id: string;
    terminal_id: string;
    fence: BindingFence;
    isCurrent(): boolean;
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
  },
): Promise<boolean> {
  if (!request.isCurrent()) return false;
  const saved = (await bindings.list({ record_id: request.record_id })).find(
    (entry) => entry.slot === request.slot && entry.policy === "board-string",
  );
  if (
    !saved ||
    saved.adapter !== request.fence.adapter ||
    saved.instance !== request.fence.instance ||
    saved.kind !== "pane" ||
    saved.native_id !== request.pane_id ||
    !saved.evidence.terminals.includes(request.terminal_id)
  )
    return false;
  let listed: unknown;
  try {
    listed = await request.call("pane.list", {});
  } catch {
    return false;
  }
  const panes = (listed as { panes?: unknown } | null)?.panes;
  if (!request.isCurrent() || !Array.isArray(panes)) return false;
  const entities: BindingEntity[] = [];
  for (const pane of panes) {
    if (
      !pane ||
      typeof pane.pane_id !== "string" ||
      !pane.pane_id ||
      typeof pane.terminal_id !== "string" ||
      !pane.terminal_id
    )
      return false;
    const session = askSessionFingerprint(pane.agent_session);
    entities.push({
      native_id: pane.pane_id,
      terminals: [pane.terminal_id],
      ...(session ? { session } : {}),
    });
  }
  const resolution = await bindings.resolve(
    saved.id,
    { type: "listing", fence: request.fence, complete: true, entities },
    request.fence,
  );
  return (
    request.isCurrent() && resolution?.target?.native_id === request.pane_id
  );
}
