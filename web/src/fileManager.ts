import { bridge, type ConnectionClient, type ConnectionSummary } from "./api";
import type { ShortcutPlatform } from "./shortcutBindings";
import { store, useStoreSelector } from "./store";

type RevealClient = Pick<ConnectionClient, "call" | "isCurrent">;

export function canRevealInFileManager(
  connection: Pick<ConnectionSummary, "type" | "ssh_destination"> | undefined,
  capability: unknown,
) {
  return (
    capability === true &&
    connection !== undefined &&
    connection.type !== "ssh" &&
    !connection.ssh_destination
  );
}

export function useCanRevealInFileManager() {
  return useStoreSelector((state) =>
    canRevealInFileManager(
      state.connections.find(
        (candidate) => candidate.id === state.activeConnectionId,
      ),
      state.status === "connected" && bridge.hello?.capabilities.file_reveal,
    ),
  );
}

// A browser platform does not identify the host platform.
export function revealMenuLabel(
  directory: boolean,
  platform?: ShortcutPlatform,
) {
  if (!platform) {
    return directory ? "Open folder on host" : "Reveal on host";
  }
  if (platform === "linux") {
    return directory ? "Open folder" : "Open containing folder";
  }
  const fileManager = platform === "mac" ? "Finder" : "File Explorer";
  return directory ? `Open in ${fileManager}` : `Reveal in ${fileManager}`;
}

/** Files open their containing folder; directories open themselves. */
export async function revealInFileManager(
  client: RevealClient,
  workspaceId: string,
  path: string,
  source?: "changes",
) {
  try {
    await client.call("file.reveal", {
      workspace_id: workspaceId,
      path,
      ...(source === "changes"
        ? { source }
        : /^(?:[\\/]|[a-z]:[\\/])/i.test(path)
          ? { scope: "filesystem" }
          : {}),
    });
  } catch (error) {
    if (!client.isCurrent()) return;
    store.notify({
      kind: "error",
      message: "Failed to open folder",
      detail: (error as Error).message,
    });
  }
}
