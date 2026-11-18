import { argvSession } from "../../herdr-core/history";
import { runProcessWithInputTimeout } from "../../workspace/process";
import { favouriteToShare } from "../../herdr-core/shared-state";
import type { AgentAddress } from "../../../../shared/agentMove";
import { tabCardKey } from "../../../../shared/terminalColor";
import type { RpcServices } from "../../rpc/context";
import { CoreOperationFence } from "../../herdr-core/fence";
import { launchCore } from "../../herdr-core/operations";
import { sshCommandArgv } from "../../bridge/ssh-command";
import { observeUntil } from "./wait";
import { shQuote } from "../../utils/process-utils";
import { harnessLaunchArgs } from "./launch-args";

type Row = Record<string, unknown>;
const row = (v: unknown) => (v && typeof v === "object" ? v : {}) as Row;
export function moveRuntime(
  services: RpcServices,
  connectionId: string,
  generation: number,
) {
  const coreOwner = services.coreControl?.manager.has(connectionId) ?? false;
  const core = coreOwner
    ? services.coreControl!.manager.readyRuntimeLease(connectionId)
    : null;
  const tui =
    !coreOwner && services.connectionManager.has(connectionId)
      ? services.connectionManager.readyRuntimeLease(connectionId)
      : null;
  const lease = core ?? tui;
  if (!lease || lease.generation !== generation || !lease.isCurrent())
    throw new Error(
      "That runtime disconnected or reconnected. Refresh before moving.",
    );
  const host = core ? services.coreControl!.hostRuntime(core) : tui!.runtime;
  if (
    host.remotePlatform === "windows" ||
    (!host.sshHost() && process.platform === "win32")
  )
    throw new Error(
      "Moving agents currently needs Unix shell terminals on both hosts.",
    );
  const current = () => {
    if (!lease.isCurrent() || (core && !core.runtime.core.actionable))
      throw new Error(
        "The runtime changed during the move. Nothing will be retried automatically.",
      );
  };
  const call = async (method: string, params: Row) => {
    current();
    if (!tui) throw new Error("This is not a Herdr TUI runtime.");
    const result = await tui.runtime.tui.call(method, params, 35_000, current);
    current();
    return row(result);
  };
  const run = async (script: string) => {
    current();
    const destination = host.sshHost();
    const result = await host.runProcessWithCodeTimeout(
      destination ? sshCommandArgv(destination, script) : ["sh", "-c", script],
      30_000,
    );
    current();
    if (result.code !== 0)
      throw new Error(
        "A move preparation or process check failed on that host.",
      );
    return result.stdout;
  };
  const write = async (script: string, content: Buffer) => {
    current();
    const destination = host.sshHost();
    const result = await runProcessWithInputTimeout(
      destination ? sshCommandArgv(destination, script) : ["sh", "-c", script],
      content,
      30_000,
    );
    current();
    if (result.code !== 0)
      throw new Error(
        "The destination could not stage the conversation transcript.",
      );
  };
  const rows = async () => {
    current();
    const reader = lease.runtime.operations;
    const [w, t, p] = await Promise.all([
      reader.listWorkspaces(),
      reader.listTabs(),
      reader.listTerminals(),
    ]);
    current();
    return {
      workspaces: w.workspaces as Row[],
      tabs: t.tabs as Row[],
      panes: p.panes as Row[],
    };
  };
  const address = async (paneId: string): Promise<AgentAddress> => {
    const topology = await rows();
    const pane = topology.panes.find((p) => p.pane_id === paneId);
    if (!pane) throw new Error("That terminal is no longer running.");
    const tab = String(pane.tab_id),
      workspace = String(pane.workspace_id);
    return {
      connection_id: connectionId,
      generation,
      workspace_id: workspace,
      tab_id: tab,
      pane_id: paneId,
      terminal_id: String(pane.terminal_id),
      color_key: tabCardKey(
        connectionId,
        tab,
        new Set(topology.workspaces.map((w) => String(w.workspace_id))),
      ),
    };
  };
  const subscribe = (changed: () => void) => {
    if (core) return core.runtime.watch(changed);
    tui!.runtime.herdr.on("event", changed);
    tui!.runtime.herdr.on("subscription_closed", changed);
    return () => {
      tui!.runtime.herdr.off("event", changed);
      tui!.runtime.herdr.off("subscription_closed", changed);
    };
  };
  const summary = async (a: AgentAddress) => {
    current();
    const sessions = core
      ? services.coreControl!.hostRuntime(core).agentSessions()
      : tui!.runtime.agentSessions;
    const result = await sessions.readSummary({ pane_id: a.pane_id });
    current();
    return result;
  };
  const latest = async (a: AgentAddress) => {
    const sessions = core
      ? services.coreControl!.hostRuntime(core).agentSessions()
      : tui!.runtime.agentSessions;
    const result = await sessions.conversation.latest({
      pane_id: a.pane_id,
      menus: true,
    });
    current();
    if (tui && result.agent) {
      const native = await call("agent.get", { target: a.pane_id });
      if (row(native.agent).interactive_ready !== true)
        return { ...result, agent_status: "unknown" };
    }
    return result;
  };
  const resumeIdentity = async (a: AgentAddress, kind: string) => {
    if (!core) return undefined;
    const record = await core.runtime.inspect(
      CoreOperationFence.admit(core, a.pane_id),
    );
    return (
      argvSession(kind, row(record.foreground).argv) ??
      argvSession(kind, record.argv)
    );
  };
  const foreground = async (
    a: AgentAddress,
    kind: "claude" | "codex",
  ): Promise<{ group: number; cwd: string; argv: unknown }> => {
    if (core) {
      const record = await core.runtime.inspect(
        CoreOperationFence.admit(core, a.pane_id),
      );
      const fg = row(record.foreground);
      if (typeof fg.pid !== "number" || typeof fg.cwd !== "string")
        throw new Error("World cannot identify the foreground process.");
      // record.argv is the original terminal command, often just a shell.
      // Only the current foreground can supply this agent's launch settings.
      return { group: fg.pid, cwd: fg.cwd, argv: fg.argv };
    }
    const result = row(
      (await call("pane.process_info", { pane_id: a.pane_id })).process_info,
    );
    if (typeof result.foreground_process_group_id !== "number")
      throw new Error("World cannot identify the foreground process.");
    const processes = Array.isArray(result.foreground_processes)
      ? (result.foreground_processes as Row[])
      : [];
    const candidates = processes.filter(
      (p) => harnessLaunchArgs(kind, p.argv) !== null,
    );
    const leader = candidates.find(
      (p) => p.pid === result.foreground_process_group_id,
    );
    const selected = leader ?? candidates[0];
    if (
      !selected ||
      candidates.some(
        (p) =>
          JSON.stringify(harnessLaunchArgs(kind, p.argv)) !==
          JSON.stringify(harnessLaunchArgs(kind, selected.argv)),
      )
    )
      throw new Error(
        "World cannot read unambiguous foreground launch arguments.",
      );
    if (typeof selected.cwd !== "string")
      throw new Error("World cannot read the agent's working folder.");
    return {
      group: result.foreground_process_group_id,
      cwd: selected.cwd,
      argv: selected.argv,
    };
  };
  const close = async (a: AgentAddress) => {
    current();
    const matching = (await rows()).panes.find((p) => p.pane_id === a.pane_id);
    if (matching && matching.terminal_id !== a.terminal_id)
      throw new Error("That terminal was replaced; it will not be closed.");
    if (!matching && !core) return;
    if (core) {
      const record = core.runtime.core.mirror.terminal(a.pane_id);
      if (record?.state === "live") {
        try {
          await core.runtime.kill(CoreOperationFence.admit(core, a.pane_id));
        } catch {
          current(); /* A successful kill can retire its own fence before publication. */
        }
      }
      const after = core.runtime.core.mirror.terminal(a.pane_id);
      if (after?.state === "live")
        await observeUntil(subscribe, async () => {
          current();
          return core.runtime.core.mirror.terminal(a.pane_id)?.state !== "live"
            ? true
            : null;
        });
    } else {
      try {
        await call("pane.close", { pane_id: a.pane_id });
      } catch {
        current();
      }
      if ((await rows()).panes.some((p) => p.terminal_id === a.terminal_id))
        throw new Error("The destination terminal did not close.");
    }
    current();
  };
  const hasDependentTerminals = (a: AgentAddress) => {
    current();
    if (!core) return false;
    return core.runtime.core.mirror
      .terminals()
      .some(
        (record) => record.state === "live" && record.parent === a.terminal_id,
      );
  };
  const favourite = async (a: AgentAddress, value: boolean) => {
    if (core)
      await core.runtime.shareLabel(
        CoreOperationFence.admit(core, a.pane_id),
        (record) => favouriteToShare(record, value),
      );
  };
  const input = async (a: AgentAddress, command: string) => {
    current();
    const liveAddress = await address(a.pane_id);
    if (liveAddress.terminal_id !== a.terminal_id)
      throw new Error("The prepared shell was replaced.");
    await observeUntil(
      subscribe,
      async () => {
        current();
        if (core) {
          const record = await core.runtime.inspect(
            CoreOperationFence.admit(core, a.pane_id),
          );
          const fg = row(record.foreground);
          if (
            typeof fg.name === "string" &&
            !/^(?:-?(?:ba|z|fi|da|k|tc|c)?sh|nu|xonsh|elvish)$/.test(
              fg.name.split("/").at(-1)!,
            )
          )
            throw new Error("Another program is using the prepared shell.");
          return fg.pid === record.pid ? true : null;
        }
        const process = row(
          (await call("pane.process_info", { pane_id: a.pane_id }))
            .process_info,
        );
        return typeof process.shell_pid === "number" &&
          process.foreground_process_group_id === process.shell_pid
          ? true
          : null;
      },
      15_000,
    );
    if (core) {
      const keyboard = await core.runtime.keyboard(
        CoreOperationFence.admit(core, a.pane_id),
        { cols: 120, rows: 36 },
        () => {},
      );
      try {
        current();
        keyboard.input(new TextEncoder().encode(command + "\r"));
      } finally {
        keyboard.detach();
      }
    } else
      await call("pane.send_input", {
        pane_id: a.pane_id,
        text: command,
        keys: ["enter"],
      });
  };
  const shellCommand = async (a: AgentAddress, script: string) => {
    const marker = "WORLD_MOVE_" + crypto.randomUUID().replaceAll("-", "");
    // Split the marker in the command so terminal echo cannot satisfy the wait.
    const command = `sh -c ${shQuote(script + `; printf '\n%s%s\n' '${marker.slice(0, 16)}' '${marker.slice(16)}'`)}`;
    if (core) {
      let seen = "";
      let settled = false;
      let finish!: () => void, fail!: (e: Error) => void;
      const output = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      void output.catch(() => {});
      const timer = setTimeout(
        () => fail(new Error("The shell did not confirm preparation.")),
        20_000,
      );
      let watch:
        | Awaited<ReturnType<typeof core.runtime.watchTerminal>>
        | undefined;
      let credit = 0;
      try {
        watch = await core.runtime.watchTerminal(
          CoreOperationFence.admit(core, a.pane_id),
          {
            resize() {},
            data(bytes) {
              if (watch) watch.credit(bytes.length);
              else credit += bytes.length;
              seen = (seen + new TextDecoder().decode(bytes)).slice(-16384);
              if (seen.includes(marker)) {
                settled = true;
                finish();
              }
            },
            close() {
              if (!settled) fail(new Error("The prepared shell ended."));
            },
          },
        );
        if (credit) watch.credit(credit);
        await input(a, command);
        await output;
        current();
      } finally {
        clearTimeout(timer);
        watch?.detach();
      }
    } else {
      await input(a, command);
      await call("pane.wait_for_output", {
        pane_id: a.pane_id,
        source: "recent_unwrapped",
        match: { type: "substring", value: marker },
        timeout_ms: 20_000,
      });
    }
  };
  const openShell = async (
    workspace: string,
    label: string,
    cwd: string,
    original?: AgentAddress,
  ) => {
    current();
    if (core) {
      if (original) {
        const source = core.runtime.core.mirror.terminal(original.pane_id);
        const labels = source?.labels ?? {};
        const started = await core.runtime.run(CoreOperationFence.admit(core), {
          argv: [],
          cwd,
          keep: false,
          labels: Object.fromEntries(
            Object.entries(labels).filter(([key]) =>
              ["herdr.space", "herdr.tab", "herdr.pinned", "where"].includes(
                key,
              ),
            ),
          ),
        });
        const coreId = core.runtime.core.epoch!.coreId;
        await services.coreControl!.topology.update(coreId, (doc) => {
          const next = structuredClone(doc);
          for (const room of next.rooms)
            for (const tab of room.tabs)
              if (tab.terminals.includes(original.terminal_id)) {
                tab.terminals.push(started.address);
                return next;
              }
          return null; // Native app tabs and unplaced shells already share their source tab.
        });
        core.runtime.layoutChanged();
        return observeUntil(subscribe, async () =>
          address(started.address).catch(() => null),
        );
      }
      const result = await launchCore(
        core,
        { workspaceId: workspace, kind: null, label, text: "" },
        {
          topology: services.coreControl!.topology,
          resolveExecutable: async () => {
            throw new Error("Shell only");
          },
        },
      );
      if (result.status !== "started" || !("pane_id" in result))
        throw new Error("The destination shell could not be opened.");
      return observeUntil(subscribe, async () =>
        address(result.pane_id).catch(() => null),
      );
    }
    const result = original
      ? await call("pane.split", {
          target_pane_id: original.pane_id,
          direction: "right",
          cwd,
          focus: false,
        })
      : await call("tab.create", {
          workspace_id: workspace,
          label,
          cwd,
          focus: false,
        });
    const pane = row(
      result.root_pane ?? result.pane ?? result.new_pane ?? result,
    );
    if (typeof pane.pane_id !== "string")
      throw new Error("Herdr did not confirm the prepared shell.");
    return address(pane.pane_id);
  };
  return {
    current,
    call,
    run,
    write,
    rows,
    address,
    summary,
    latest,
    foreground,
    resumeIdentity,
    subscribe,
    close,
    input,
    favourite,
    hasDependentTerminals,
    shellCommand,
    openShell,
    core: Boolean(core),
  };
}
export type MoveRuntime = ReturnType<typeof moveRuntime>;
