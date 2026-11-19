import { bridge, type ConnectionClient } from "./api";

export type DesktopIde = {
  id: string;
  label: string;
  installed: boolean;
  ssh: boolean;
  reason?: string;
};
export type DesktopIdes = { default_id: string | null; ides: DesktopIde[] };
export type DesktopIdeTarget = {
  client: ConnectionClient;
  workspaceId: string;
  label?: string;
  path?: string;
  line?: number;
};
let selected: DesktopIdeTarget | null = null;
const listeners = new Set<() => void>();
export const desktopIdeTarget = {
  get: () => selected,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
export function openInDesktopIde(target: DesktopIdeTarget | null) {
  selected = target;
  for (const listener of listeners) listener();
}

// Testing-only, page-lifetime preview. Never reaches the service or launches apps.
let preview = false;
let previewDefault: string | null = "vscode";
export function consumeDesktopIdeFixture() {
  const url = new URL(location.href);
  if (url.searchParams.get("ideFixture") !== "1") return;
  preview = true;
  url.searchParams.delete("ideFixture");
  history.replaceState(history.state, "", url);
}
export const desktopIdeFixture = () => preview;
export async function desktopIdeCall(
  method: "list" | "default" | "open",
  params: Record<string, unknown> = {},
): Promise<any> {
  if (preview) {
    if (method === "default") {
      previewDefault = params.ide as string | null;
      return { default_id: previewDefault };
    }
    if (method === "open") {
      if (params.ide === "cursor")
        throw new Error(
          "Preview: the desktop launcher failed. Check the desktop session and try again.",
        );
      if (params.ide === "idea")
        throw new Error(
          "JetBrains SSH handoff needs a configured Gateway backend link. Choose VS Code, Cursor or Zed.",
        );
      return {
        dispatched: true,
        ide: params.ide,
        label: params.ide === "vscode" ? "VS Code" : "Zed",
      };
    }
    return {
      default_id: previewDefault,
      ides: [
        { id: "vscode", label: "VS Code", installed: true, ssh: true },
        { id: "cursor", label: "Cursor", installed: true, ssh: true },
        { id: "idea", label: "IntelliJ IDEA", installed: true, ssh: false },
        {
          id: "zed",
          label: "Zed",
          installed: false,
          ssh: true,
          reason: "Desktop launcher not found on the World host.",
        },
      ],
    };
  }
  return bridge.call(`world.ide.${method}`, params);
}
export function parseDesktopIdes(value: unknown): DesktopIdes {
  const data = value as DesktopIdes;
  if (
    !data ||
    !Array.isArray(data.ides) ||
    (data.default_id !== null && typeof data.default_id !== "string") ||
    data.ides.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        typeof item.label !== "string" ||
        typeof item.installed !== "boolean" ||
        typeof item.ssh !== "boolean" ||
        (item.reason !== undefined && typeof item.reason !== "string"),
    )
  )
    throw new Error("Invalid desktop IDE list. Refresh and try again.");
  return data;
}
export async function dispatchDesktopIde(
  target: DesktopIdeTarget,
  ide: string,
) {
  const client = target.client;
  if (!client.isCurrent() || client.serverRuntimeGeneration === null)
    throw new Error(
      "This project host changed or is unavailable. Refresh before opening it.",
    );
  if (client.agentWorktree === null)
    throw new Error(
      "Choose a current agent worktree before opening it in an IDE.",
    );
  return desktopIdeCall("open", {
    ide,
    connection_id: client.connectionId,
    connection_generation: client.serverRuntimeGeneration,
    workspace_id: target.workspaceId,
    ...(target.path
      ? {
          path: target.path,
          ...(/^(?:\/|[a-z]:[\\/])/i.test(target.path)
            ? { scope: "filesystem" }
            : {}),
        }
      : {}),
    ...(target.line ? { line: target.line } : {}),
    ...(client.agentWorktree !== undefined
      ? { agent_worktree: client.agentWorktree }
      : {}),
  });
}
