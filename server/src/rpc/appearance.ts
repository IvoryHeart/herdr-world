import {
  parseAppearanceTarget,
  parseAppearanceFields,
  continuingAppearance,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BridgeRpcContext } from "./context";

/** Exact-runtime admission for World metadata and native names. */
export async function handleAppearanceRpc(
  rpc: BridgeRpcContext,
): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const {
    board,
    publishBoardChanged,
    publishWorldInvalidation,
    connectionManager,
  } = rpc.services;
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
    const lease = connectionManager.readyRuntimeLease(target.connection_id);
    if (!lease || lease.generation !== generation || !lease.isCurrent())
      throw new Error("Appearance target is unavailable");
    const call = (method: string, values: Record<string, unknown> = {}) =>
      lease.runtime.herdr.call(method, values, 10_000);
    const [paneResult, tabResult, workspaceResult] = await Promise.all([
      call("pane.list"),
      call("tab.list"),
      call("workspace.list"),
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
    if (!continuingAppearance(target, observed) || !lease.isCurrent())
      throw new Error("Appearance target changed");
    if (fields) {
      const document = await board().patch(() => {
        if (!lease.isCurrent() || !rpc.requestIsCurrent())
          throw new Error("Appearance target changed");
        return [{ op: "appearance.set", target: observed, fields }];
      });
      publishBoardChanged(document.revision);
      sendReply({ id, result: { document } }, method);
    } else {
      // This native operation never creates a World-owned shadow label.
      await call("tab.rename", {
        tab_id: target.native_id,
        label: String(params?.label).trim(),
      });
      if (!lease.isCurrent())
        throw new Error("Tab runtime changed during rename");
      publishWorldInvalidation(target.connection_id, lease.generation);
      sendReply({ id, result: { renamed: true } }, method);
    }
  } catch (error) {
    sendError("world-appearance-error", error);
  }
}
