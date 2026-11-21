import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGuiSettings } from "../../config/gui-settings";
import { createCoreHostRuntime } from "../host-runtime";
import { localAgentSessionFiles } from "../../agent/session-file-access";
import { BoardStore } from "../../world/board-store";
import type { RpcServices, BridgeRpcContext } from "../../rpc/context";
import { handleAgentMoveRpc } from "../../rpc/agent-move";
import { handleAppearanceRpc } from "../../rpc/appearance";
import { createCoreRoom } from "../operations";
import { moveRuntime } from "../../agent/move/runtime";
import { observeUntil } from "../../agent/move/wait";
import { connectedLive } from "./live-world";
import { ScratchCore } from "./scratch-core";
import { moveTuiFixture } from "./move-tui";
import { shQuote } from "../../utils/process-utils";

export const MOVE_SESSION = "019a0000-0000-7000-8000-000000000977";

/** Real local core profiles, separate PTYs for the TUI protocol stand-in,
 * and synthetic transcripts/harnesses. No World service or real credentials. */
export async function liveMoves(binary: string) {
  const scratch = [
    new ScratchCore(binary),
    new ScratchCore(binary, { coreId: "c0ffee0000000002" }),
  ];
  const worlds: Awaited<ReturnType<typeof connectedLive>>[] = [];
  let stopTui: (() => void) | undefined;
  const previousConfig = process.env.CLAUDE_CONFIG_DIR;
  const dispose = async () => {
    stopTui?.();
    for (const w of worlds) {
      await w.stop();
      rmSync(w.root, { recursive: true, force: true });
    }
    for (const core of scratch) await core.dispose();
    if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfig;
  };
  try {
    const root = scratch[0]!.root;
    const config = join(root, "claude-config"),
      project = join(root, "project");
    process.env.CLAUDE_CONFIG_DIR = config;
    const sessions = join(
      config,
      "projects",
      project.replaceAll(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(sessions, { recursive: true });
    mkdirSync(project);
    const path = join(sessions, `${MOVE_SESSION}.jsonl`);
    writeFileSync(
      path,
      [
        {
          type: "user",
          uuid: "u1",
          sessionId: MOVE_SESSION,
          timestamp: "2026-11-18T09:00:00Z",
          message: { role: "user", content: "Keep this conversation" },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          sessionId: MOVE_SESSION,
          timestamp: "2026-11-18T09:00:01Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "The conversation continues." }],
            stop_reason: "end_turn",
          },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const executable = join(root, "claude");
    const compile = Bun.spawnSync([
      "cc",
      join(import.meta.dir, "move-harness.c"),
      "-o",
      executable,
    ]);
    if (compile.exitCode !== 0) throw new Error(compile.stderr.toString());
    for (const core of scratch) {
      core.env.SHELL = "/bin/bash";
      writeFileSync(
        join(core.env.HOME!, ".bashrc"),
        `export PATH=${shQuote(root)}:/usr/bin:/bin\nexport CLAUDE_CONFIG_DIR=${shQuote(config)}\nexport WORLD_MOVE_SHELL=loaded\n`,
      );
      await core.start();
    }
    const main = await connectedLive(scratch[0]!.stateDir, "core-local");
    worlds.push(main);
    const backing = await connectedLive(scratch[1]!.stateDir, "tui-backing");
    worlds.push(backing);
    const host = (w: typeof main) =>
      createCoreHostRuntime({
        lease: w.lease(),
        host: null,
        readSettings: async () => defaultGuiSettings(),
        agentSessionFiles: localAgentSessionFiles,
      });
    const coreHost = host(main),
      tuiHost = host(backing);
    const board = new BoardStore(join(root, "board.json"));
    const services = {
      board: () => board,
      publishBoardChanged: () => {},
      publishWorldInvalidation: () => {},
      coreControl: {
        manager: main.core.manager,
        topology: main.topology,
        hostRuntime: () => coreHost,
      },
      connectionManager: { has: () => false },
    } as unknown as RpcServices;
    const backingServices = {
      ...services,
      coreControl: {
        manager: backing.core.manager,
        topology: backing.topology,
        hostRuntime: () => tuiHost,
        host: () => null,
      },
    } as RpcServices;
    const tui = moveTuiFixture(
      backingServices,
      "tui-backing",
      backing.lease().generation,
      tuiHost,
    );
    stopTui = tui.stop;
    const tuiGeneration = 1;
    services.connectionManager = {
      has: (id: string) => id === "tui",
      readyRuntimeLease: (id: string) => {
        if (id !== "tui") throw new Error(`unknown connection: ${id}`);
        return {
          generation: tuiGeneration,
          isCurrent: () => backing.lease().isCurrent(),
          runtime: tui.runtime,
        };
      },
    } as unknown as RpcServices["connectionManager"];
    const coreRooms = [
      await createCoreRoom(main.lease(), main.topology, "Core one"),
      await createCoreRoom(main.lease(), main.topology, "Core two"),
    ];
    const tuiRoom = await createCoreRoom(
      backing.lease(),
      backing.topology,
      "TUI room",
    );
    const tuiRuntime = moveRuntime(services, "tui", tuiGeneration);
    const initial = await tuiRuntime.openShell(
      tuiRoom.workspace_id,
      "Traveller",
      project,
    );
    await tuiRuntime.input(
      initial,
      `${shQuote(executable)} --resume ${MOVE_SESSION} --model example --permission-mode auto`,
    );
    await observeUntil(tuiRuntime.subscribe, async () => {
      const latest = await tuiRuntime.latest(initial);
      return latest.agent_status === "idle" && latest.session_fingerprint
        ? true
        : null;
    });
    const initialConversation = await tuiRuntime.latest(initial);
    if (initialConversation.status !== "ok")
      throw new Error(
        `Synthetic conversation unavailable: ${JSON.stringify(initialConversation)}`,
      );
    await board.patch([
      { op: "layout.set", pinned: { [initial.color_key]: { x: 120, y: 80 } } },
      {
        op: "spawn.record",
        claims: [
          {
            child: initial,
            parent: { connection_id: "tui", terminal_id: "example-parent" },
            source: "herdr:spawned_by",
            generation: tuiGeneration,
            observed_at: 1,
          },
        ],
      },
    ]);
    const connections = async () => {
      const coreRows = await moveRuntime(
        services,
        "core-local",
        main.lease().generation,
      ).rows();
      const tuiRows = await tui.rows();
      return [
        {
          connectionId: "tui",
          label: "TUI",
          generation: tuiGeneration,
          ...tuiRows,
        },
        {
          connectionId: "core-local",
          label: "Core",
          generation: main.lease().generation,
          runtime: "herdr-core",
          ...coreRows,
        },
      ].map(({ workspaces, tabs, panes, ...connection }) => ({
        ...connection,
        source: "saved",
        isDefault: connection.connectionId === "tui",
        state: "ready",
        snapshotGeneration: connection.generation,
        actionable: true,
        stale: false,
        snapshot: {
          workspaces: workspaces.map((w, i) => ({ ...w, number: i + 1 })),
          tabs: tabs.map((t, i) => ({
            ...t,
            number: i + 1,
            pane_count: panes.filter((p) => p.tab_id === t.tab_id).length,
          })),
          panes,
          agents: [],
        },
      }));
    };
    const calls: string[] = [];
    const rpc = async (method: string, params: Record<string, unknown>) => {
      if (method === "world.board.get") return board.get();
      calls.push(method);
      let result: unknown, error: unknown;
      const context = {
        id: "browser",
        method,
        params,
        services,
        requestIsCurrent: () => true,
        sendReply: (reply: Record<string, unknown>) => {
          result = reply.result;
          return true;
        },
        sendError: (_name: string, e: unknown) => {
          error = e;
        },
      } as unknown as BridgeRpcContext;
      if (method === "world.agent.move") await handleAgentMoveRpc(context);
      else if (method === "world.appearance.patch")
        await handleAppearanceRpc(context);
      else throw new Error(`Unexpected fixture RPC ${method}`);
      if (error) throw error;
      return result;
    };
    return {
      services,
      board,
      rpc,
      connections,
      calls,
      initial,
      coreRooms,
      tuiRoom,
      project,
      dispose,
      transcript: () => readFileSync(path, "utf8"),
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
