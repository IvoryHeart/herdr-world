import { useSyncExternalStore } from "react";
import { bridge } from "../api";
import { pluginActionShortcutFor } from "../pluginActionShortcuts";
import { operationalStore } from "../store/operations";
import type { WorldLeafObject } from "./worldObject";

/**
 * The room's floating shell, on whichever runtime the agent runs.
 *
 * - On the TUI (herdr) it is the Herdr Float plugin's popup: World invokes the
 *   plugin's own toggle in the agent's Space, and the popup shows over World
 *   as every Herdr popup does (`PopupOverlay`).
 * - On herdr-core, which has no plugins or popups, it is World's own float
 *   shell (`world.float.*`): one per room, in the agent's folder, kept running
 *   while hidden, shown here by `FloatShellOverlay`.
 */
export type FloatShellTarget = {
  connectionId: string;
  generation: number;
  /** The agent (`tN`) whose room and folder the shell belongs to. */
  terminalId: string;
  /** The agent's name, shown in the shell's title. */
  label: string;
};

let target: FloatShellTarget | null = null;
const listeners = new Set<() => void>();

function publish(next: FloatShellTarget | null) {
  target = next;
  for (const listener of listeners) listener();
}

export function hideFloatShell() {
  publish(null);
}

export function floatShellTarget() {
  return target;
}

export function useFloatShellTarget(): FloatShellTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
  );
}

/** Whether `leaf` is an agent whose room can have a floating shell. */
export function canOpenRoomShell(leaf: WorldLeafObject | null | undefined) {
  return Boolean(leaf && !leaf.stale && (leaf.actionable || leaf.runtime));
}

/** How the TUI's Herdr Float is reached; tests replace it. */
export type HerdrFloatRoute = {
  watchPopups(connectionId: string, generation: number): Promise<unknown>;
  toggle(
    connectionId: string,
    generation: number,
    context: Record<string, unknown>,
  ): Promise<unknown>;
};

const herdrFloat: HerdrFloatRoute = {
  // The popup observer of a connection runs once someone watches it; this
  // browser may never have looked at this agent's host before.
  watchPopups: (connectionId, generation) =>
    bridge
      .connection(connectionId, generation)
      .call("terminal.watch_popup", {}),
  // The same qualified toggle as the Ctrl+Alt+F shortcut.
  toggle: (connectionId, generation, context) => {
    const action = pluginActionShortcutFor("plugin.herdrFloat.toggle");
    return operationalStore({
      connectionId,
      runtimeGeneration: generation,
    }).togglePluginPopup(action.pluginId, action.actionId, context);
  },
};

/** Opens (or, on the TUI, toggles) the floating shell of `leaf`'s room. */
export async function openRoomShell(
  leaf: WorldLeafObject,
  route: HerdrFloatRoute = herdrFloat,
): Promise<void> {
  if (leaf.runtime === "herdr-core") {
    publish({
      connectionId: leaf.connectionId,
      generation: leaf.generation,
      terminalId: leaf.pane.terminal_id,
      label: leaf.label,
    });
    return;
  }
  await route.watchPopups(leaf.connectionId, leaf.generation).catch(() => null);
  await route.toggle(leaf.connectionId, leaf.generation, {
    workspace_id: leaf.workspaceId,
    focused_pane_cwd: leaf.pane.foreground_cwd ?? leaf.pane.cwd,
  });
}
