import { TERMINAL_SIZE_FLOOR } from "../../../shared/terminalSize";
import { paneBinding } from "./conversation-binding";
import type { ConversationLatest } from "./conversation";
import type { ConversationDelivery } from "./conversation-delivery";
import { inputWitness } from "./menu-send-guard";
import type { AgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";
import { isRecord } from "./session-utils";

type MenuRead = (target: {
  pane_id: string;
  menus?: boolean;
}) => Promise<ConversationLatest>;

/** Add a measured size explanation to an unreadable current command menu only. */
export function withMenuSize(
  args: { herdrCall: HerdrCall; context: AgentSessionResolverContext },
  deliveries: { list(paneId: string): ConversationDelivery[] },
  read: MenuRead,
): MenuRead {
  const agentInfo = async (paneId: string) => {
    const result = await args.herdrCall("agent.get", { target: paneId });
    return isRecord(result) && isRecord(result.agent) ? result.agent : null;
  };
  return async (target) => {
    // Capture before any await: an old read cannot explain a newer command.
    const command = target.menus
      ? deliveries.list(target.pane_id).at(-1)
      : undefined;
    if (command?.kind !== "command") return read(target);
    const info = await agentInfo(target.pane_id).catch(() => null);
    const witness = inputWitness(info);
    const shown = await read(target);
    if (
      !info ||
      info.pane_id !== target.pane_id ||
      typeof info.terminal_id !== "string" ||
      !info.terminal_id ||
      shown.status !== "ok" ||
      shown.pending_prompt ||
      !["idle", "done"].includes(shown.agent_status ?? "") ||
      shown.session_binding === "guessed" ||
      !shown.session_fingerprint ||
      command.fingerprint !== shown.session_fingerprint ||
      paneBinding(shown.agent ?? "", info, args.context)?.fingerprint !==
        shown.session_fingerprint
    )
      return shown;
    try {
      // All reads use the captured connection/runtime. Neither a layout
      // rectangle nor a default size supplies a terminal measurement.
      const result = await args.herdrCall("pane.get", {
        pane_id: target.pane_id,
      });
      const pane =
        isRecord(result) && isRecord(result.pane) ? result.pane : null;
      const rows =
        pane && isRecord(pane.scroll) ? pane.scroll.viewport_rows : undefined;
      if (
        pane?.pane_id === target.pane_id &&
        (pane.terminal_id === undefined ||
          pane.terminal_id === info.terminal_id) &&
        typeof rows === "number" &&
        Number.isInteger(rows) &&
        rows > 0 &&
        rows < TERMINAL_SIZE_FLOOR.rows &&
        inputWitness(await agentInfo(target.pane_id)) === witness &&
        deliveries.list(target.pane_id).at(-1)?.id === command.id
      )
        return {
          ...shown,
          menu_unreadable: { reason: "terminal_too_small", rows },
        };
    } catch {
      // A failed or retired read is unknown, never a size or input refusal.
    }
    return shown;
  };
}
