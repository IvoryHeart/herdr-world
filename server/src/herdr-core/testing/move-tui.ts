import { EventEmitter } from "node:events";
import type { AgentAddress } from "../../../../shared/agentMove";
import type { RpcServices } from "../../rpc/context";
import { moveRuntime } from "../../agent/move/runtime";
import type { CoreHostRuntime } from "../host-runtime";
import { CoreOperationFence } from "../fence";

/** A TUI protocol stand-in backed by a separate scratch core's real PTYs.
 * It emulates Herdr's pane IDs/replies, never the destination core protocol. */
export function moveTuiFixture(
  backing: RpcServices,
  connectionId: string,
  generation: number,
  host: CoreHostRuntime,
) {
  const runtime = moveRuntime(backing, connectionId, generation);
  const ids = new Map<string, string>(),
    native = new Map<string, string>();
  let next = 0;
  const alias = (id: string) => {
    if (!ids.has(id)) {
      const value = `w1:p${++next}`;
      ids.set(id, value);
      native.set(value, id);
    }
    return ids.get(id)!;
  };
  const address = (id: string) => runtime.address(native.get(id) ?? id);
  const rows = async () => {
    const r = await runtime.rows();
    return {
      ...r,
      panes: r.panes.map((p) => ({ ...p, pane_id: alias(String(p.pane_id)) })),
    };
  };
  const convert = async (a: AgentAddress) => ({
    ...a,
    pane_id: alias(a.pane_id),
  });
  const herdr = new EventEmitter();
  const stop = runtime.subscribe(() => herdr.emit("event"));
  const sessions = host.agentSessions();
  const tui = {
    call: async (method: string, p: Record<string, unknown> = {}) => {
      if (method === "pane.list") return { panes: (await rows()).panes };
      if (method === "tab.list") return { tabs: (await rows()).tabs };
      if (method === "workspace.list")
        return { workspaces: (await rows()).workspaces };
      if (method === "tab.create")
        return {
          root_pane: await convert(
            await runtime.openShell(
              String(p.workspace_id),
              String(p.label),
              String(p.cwd),
            ),
          ),
        };
      const a = await address(
        String(p.pane_id ?? p.target_pane_id ?? p.target),
      );
      if (method === "pane.split")
        return {
          pane: await convert(
            await runtime.openShell(
              a.workspace_id,
              "Recovery",
              String(p.cwd),
              a,
            ),
          ),
        };
      if (method === "pane.process_info") {
        const lease =
          backing.coreControl!.manager.readyRuntimeLease(connectionId)!;
        const record = await lease.runtime.inspect(
          CoreOperationFence.admit(lease, a.terminal_id),
        );
        const fg = record.foreground as
          | { pid?: number; cwd?: string; argv?: string[] }
          | undefined;
        return {
          process_info: {
            shell_pid: record.pid,
            foreground_process_group_id: fg?.pid ?? -1,
            foreground_processes: fg ? [{ ...fg }] : [],
          },
        };
      }
      if (method === "pane.send_input") {
        const command = String(p.text);
        if (command.startsWith("sh -c "))
          await runtime.shellCommand(a, command);
        else await runtime.input(a, command);
        return {};
      }
      if (method === "pane.wait_for_output") return {}; // send_input awaited native output
      if (method === "pane.close") {
        await runtime.close(a);
        return {};
      }
      if (method === "agent.get") return { agent: { interactive_ready: true } };
      throw new Error(`Unexpected TUI move method ${method}`);
    },
  };
  return {
    rows,
    convert,
    stop,
    runtime: {
      sshHost: () => undefined,
      runProcessWithCodeTimeout: host.runProcessWithCodeTimeout,
      tui,
      herdr,
      operations: {
        listWorkspaces: async () => ({ workspaces: (await rows()).workspaces }),
        listTabs: async () => ({ tabs: (await rows()).tabs }),
        listTerminals: async () => ({ panes: (await rows()).panes }),
      },
      agentSessions: {
        readSummary: async (p: { pane_id: string }) =>
          sessions.readSummary({ pane_id: (await address(p.pane_id)).pane_id }),
        conversation: {
          latest: async (p: { pane_id: string }) =>
            sessions.conversation.latest({
              pane_id: (await address(p.pane_id)).pane_id,
              menus: true,
            }),
        },
      },
    },
  };
}
