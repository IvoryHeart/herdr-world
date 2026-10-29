import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../world/board-store";
import { handleLauncherRpc } from "./launcher";
import type { ConnectionRpcContext } from "./context";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { appearanceColors, appearanceFor } from "../../../shared/appearance";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
for (const retire of [false, true])
  test(`profile launch on reused tab ID binds its new terminal; retired=${retire}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "launcher-appearance-"));
    roots.push(root);
    const board = new BoardStore(join(root, "board.json"));
    const old = {
      connection_id: "alpha",
      kind: "tab" as const,
      native_id: "w1:t1",
      color_key: "alpha:w1:t1",
      witness: ["old-terminal"],
    };
    board.patch([
      { op: "appearance.set", target: old, fields: { status: "Old occupant" } },
    ]);
    const profile = {
      ...STARTER_PROFILES[1]!,
      send_brief: false,
      role: "",
      brief: "",
    };
    let name = "",
      current = true;
    let result: unknown;
    const errors: unknown[] = [];
    const call = async (method: string, params: Record<string, unknown>) => {
      if (method === "agent.list") return { agents: [] };
      if (method === "tab.create")
        return {
          tab: { tab_id: "w1:t1" },
          root_pane: { pane_id: "w1:p1", terminal_id: "new-terminal" },
        };
      if (method === "agent.start") {
        name = String(params.name);
        return {};
      }
      if (method === "pane.get")
        return { pane: { pane_id: "w1:p1", terminal_id: "new-terminal" } };
      if (method === "agent.get")
        return {
          agent: {
            pane_id: "w1:p1",
            terminal_id: "new-terminal",
            agent: profile.harness,
            name,
            interactive_ready: true,
          },
        };
      if (method === "workspace.list") {
        if (retire) current = false;
        return { workspaces: [{ workspace_id: "w1" }] };
      }
      if (method === "pane.process_info")
        return {
          process_info: { shell_pid: 10, foreground_process_group_id: 11 },
        };
      throw new Error(`unexpected ${method}`);
    };
    await handleLauncherRpc({
      id: "launch",
      method: "launcher.start",
      params: { workspace_id: "w1", profile_id: profile.id },
      route: {
        scope: "connection",
        connectionId: "alpha",
        generation: 3,
        isCurrent: () => current,
      },
      requestIsCurrent: () => current,
      connection: { herdr: { call } },
      sendReply: (reply: Record<string, unknown>) => {
        result = reply.result;
        return true;
      },
      sendError: (_context: string, error: unknown) => errors.push(error),
      services: {
        board: () => board,
        profiles: () => ({
          profile: () => profile,
          assign: () => ({ revision: 1 }),
        }),
        publishProfilesChanged: () => {},
        publishBoardChanged: () => {},
        publishWorldInvalidation: () => {},
        logger: { warn: () => {} },
      },
    } as unknown as ConnectionRpcContext);
    expect(errors).toEqual([]);
    expect(result).toMatchObject({
      status: "started",
      terminal_id: "new-terminal",
    });
    const next = { ...old, witness: ["new-terminal"] };
    if (retire)
      expect(board.get().layout.colors[old.color_key]).toBeUndefined();
    else {
      expect(appearanceColors(board.get(), [next])[old.color_key]).toBe(
        profile.color!,
      );
      expect(
        appearanceFor(board.get().appearance, next)?.status,
      ).toBeUndefined();
      expect(appearanceFor(board.get().appearance, next)).not.toBeNull();
    }
  }, 10000);
