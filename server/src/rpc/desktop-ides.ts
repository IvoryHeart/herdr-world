import { posix, win32 } from "node:path";
import {
  desktopIde,
  desktopIdeArgs,
  detectDesktopIdes,
  launchDesktopIde,
} from "../integrations/desktop-ides";
import {
  validateConnectionGeneration,
  validateConnectionId,
} from "../connections/protocol";
import type { BridgeRpcContext } from "./context";

const DEFAULT_KEY = "desktopIde";
/** Desktop integrations belong to the World host; projects retain their owning lease. */
export async function handleDesktopIdeRpc(
  rpc: BridgeRpcContext,
): Promise<void> {
  const { method, params = {}, id, sendReply, sendError, services } = rpc;
  try {
    const runtime = services.desktopIdeRuntime ?? {
      detect: detectDesktopIdes,
      launch: launchDesktopIde,
    };
    const settings = await services.uiSettings("bridge.ui_settings.get", {});
    const saved = (settings as { ui: Record<string, unknown> }).ui[DEFAULT_KEY];
    const ides = runtime.detect();
    const defaultId =
      typeof saved === "string" && ides.some((item) => item.id === saved)
        ? saved
        : null;
    if (method === "world.ide.list") {
      sendReply(
        {
          id,
          result: {
            default_id: defaultId,
            ides: ides.map(({ executable, ...item }) => ({
              ...item,
              installed: !!executable,
            })),
          },
        },
        method,
      );
      return;
    }
    if (method === "world.ide.default") {
      if (params.ide !== null) desktopIde(params.ide);
      if (!rpc.requestIsCurrent())
        throw new Error("World connection changed; try again.");
      await services.uiSettings("bridge.ui_settings.update", {
        key: DEFAULT_KEY,
        value: params.ide,
      });
      sendReply({ id, result: { default_id: params.ide } }, method);
      return;
    }
    if (method !== "world.ide.open")
      throw new Error("Unknown desktop IDE operation.");
    const connectionId = validateConnectionId(params.connection_id);
    const generation = validateConnectionGeneration(
      params.connection_generation,
    );
    const selected = desktopIde(params.ide ?? defaultId);
    const detected = ides.find((item) => item.id === selected.id);
    if (!detected?.executable)
      throw new Error(
        detected?.reason ?? "Desktop IDE is unavailable on the World host.",
      );
    if (typeof params.workspace_id !== "string" || !params.workspace_id)
      throw new Error("Choose a current project or agent worktree.");
    if (
      params.path !== undefined &&
      (typeof params.path !== "string" ||
        params.path.length > 4096 ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(params.path))
    )
      throw new Error("Invalid IDE path.");
    if (params.scope !== undefined && params.scope !== "filesystem")
      throw new Error("Invalid IDE path scope.");
    if (
      params.path &&
      /^(?:\/|[a-z]:|\\)/i.test(String(params.path)) &&
      params.scope !== "filesystem"
    )
      throw new Error("Absolute IDE paths require explicit filesystem scope.");
    // Select exactly one manager by immutable ID; never catch and fall back.
    const core = services.coreControl;
    const isCore =
      !services.connectionManager.has(connectionId) &&
      core?.manager.has(connectionId);
    const lease = isCore
      ? core!.manager.readyRuntimeLease(connectionId)
      : services.connectionManager.readyRuntimeLease(connectionId);
    const current = () =>
      rpc.requestIsCurrent() &&
      !!lease &&
      lease.generation === generation &&
      lease.isCurrent();
    if (!current() || !lease)
      throw new Error(
        "This project host changed or is unavailable. Refresh before opening it.",
      );
    const legacy = isCore
      ? null
      : services.connectionManager.readyRuntimeLease(connectionId)!.runtime;
    const destination = isCore
      ? core!.host(connectionId)?.destination
      : legacy!.sshHost();
    const windows = isCore
      ? core!.host(connectionId)?.windows
      : legacy!.remotePlatform === "windows";
    if (destination && windows)
      throw new Error(
        "Desktop IDE handoff to Windows SSH hosts is not supported yet.",
      );
    // Fail unsupported remote forms before reading project resources.
    if (destination && selected.family === "jetbrains")
      desktopIdeArgs(selected.id, "/", destination);
    const files = isCore
      ? core!.hostRuntime(
          lease as Parameters<NonNullable<typeof core>["hostRuntime"]>[0],
        ).files
      : legacy!.files;
    // Existing bounded Files admission resolves canonical paths, worktree/session
    // witnesses and symlink containment for both runtimes. No browser root is trusted.
    const target = await files.readWorkspaceFile({
      workspace_id: params.workspace_id,
      path: params.path || ".",
      ...(params.agent_worktree !== undefined
        ? { agent_worktree: params.agent_worktree }
        : {}),
    });
    const pathApi = /^[a-z]:[\\/]/i.test(target.root) ? win32 : posix;
    const path = pathApi.isAbsolute(target.path)
      ? target.path
      : pathApi.resolve(target.root, target.path);
    const args = desktopIdeArgs(
      selected.id,
      path,
      destination,
      params.line as number | undefined,
      target.type === "directory",
    );
    if (!current())
      throw new Error(
        "This project host changed before handoff. Refresh and try again.",
      );
    await runtime.launch(detected.executable, args, {
      application: selected.mac,
    });
    sendReply(
      {
        id,
        result: { dispatched: true, ide: selected.id, label: selected.label },
      },
      method,
    );
  } catch (error) {
    sendError(`${method}-error`, error);
  }
}
