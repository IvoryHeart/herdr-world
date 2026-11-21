import { planBoardPatch } from "../world/board-plan";
import {
  parseAppearanceTarget,
  parseAppearanceFields,
  continuingAppearance,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BridgeRpcContext } from "./context";
import { worldRuntimeLease } from "../world/runtime-lease";

/** Exact-runtime admission for World metadata and native names. */
export async function handleAppearanceRpc(
  rpc: BridgeRpcContext,
): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const { board, publishBoardChanged, publishWorldInvalidation } = rpc.services;
  try {
    if (
      method !== "world.appearance.patch" &&
      method !== "world.appearance.rename"
    )
      throw new Error("unknown appearance operation");
    const target = parseAppearanceTarget(params);
    const generation = params?.connection_generation;
    if (!Number.isSafeInteger(generation) || Number(generation) < 0)
      throw new Error("invalid appearance runtime");
    const fields =
      method === "world.appearance.patch"
        ? parseAppearanceFields(params?.fields, target.kind)
        : null;
    if (
      method === "world.appearance.rename" &&
      (target.kind !== "tab" ||
        typeof params?.label !== "string" ||
        !params.label.trim() ||
        params.label.length > 160 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(params.label))
    )
      throw new Error("invalid tab name");
    const resolved = worldRuntimeLease(
      rpc.services,
      target.connection_id,
      Number(generation),
    );
    if (!resolved) throw new Error("Appearance target is unavailable");
    const { lease, isCurrent: current } = resolved;
    const reader = lease.runtime.operations;
    const [paneResult, tabResult, workspaceResult] = await Promise.all([
      reader.listTerminals(),
      reader.listTabs(),
      reader.listWorkspaces(),
    ]);
    const panes = (paneResult as { panes?: Record<string, unknown>[] })?.panes;
    const tabs = (tabResult as { tabs?: Record<string, unknown>[] })?.tabs;
    const workspaces = (
      workspaceResult as { workspaces?: Record<string, unknown>[] }
    )?.workspaces;
    if (
      !Array.isArray(panes) ||
      !Array.isArray(tabs) ||
      !Array.isArray(workspaces)
    )
      throw new Error("Appearance target could not be verified");
    const matches = panes.filter((pane) =>
      target.kind === "tab"
        ? pane.tab_id === target.native_id
        : pane.pane_id === target.native_id,
    );
    if (
      !matches.length ||
      (target.kind === "pane" && matches.length !== 1) ||
      matches.some(
        (pane) => typeof pane.terminal_id !== "string" || !pane.terminal_id,
      )
    )
      throw new Error("Appearance target changed");
    const observed = parseAppearanceTarget({
      ...target,
      witness: matches.map((pane) => pane.terminal_id),
    });
    if (
      target.kind === "tab" &&
      (tabs.filter((tab) => tab.tab_id === target.native_id).length !== 1 ||
        target.color_key !==
          tabCardKey(
            target.connection_id,
            target.native_id,
            new Set(
              workspaces.map((workspace) => String(workspace.workspace_id)),
            ),
          ))
    )
      throw new Error("Appearance tab changed");
    if (!continuingAppearance(target, observed) || !current())
      throw new Error("Appearance target changed");
    if (fields) {
      const document = await board().patch(
        planBoardPatch([params, observed, fields], () => {
          if (!current() || !rpc.requestIsCurrent())
            throw new Error("Appearance target changed");
          return [{ op: "appearance.set", target: observed, fields }];
        }),
      );
      publishBoardChanged(document.revision);
      sendReply({ id, result: { document } }, method);
    } else {
      if (resolved.kind !== "tui")
        throw new Error("Rename this core desk in its runtime.");
      // This native operation never creates a World-owned shadow label.
      await resolved.lease.runtime.tui.call(
        "tab.rename",
        {
          tab_id: target.native_id,
          label: String(params?.label).trim(),
        },
        10_000,
      );
      if (!lease.isCurrent())
        throw new Error("Tab runtime changed during rename");
      publishWorldInvalidation(target.connection_id, lease.generation);
      sendReply({ id, result: { renamed: true } }, method);
    }
  } catch (error) {
    sendError("world-appearance-error", error);
  }
}
