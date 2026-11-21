import type { ReadyRuntimeLease } from "../connections/manager";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import { argvSession } from "../herdr-core/history";
import { createRuntimeUsage } from "./host";
import type { readHostUsage } from "./host";

/** Same numeric reader on the core's exact host. Resume evidence only. */
export function createCoreUsageRuntime(
  lease: ReadyRuntimeLease<CoreConnectionRuntime>,
  sshHost?: string,
  collect?: typeof readHostUsage,
) {
  const collector = createRuntimeUsage({ sshHost, collect });
  lease.runtime.signal.addEventListener(
    "abort",
    () => {
      void collector.close();
    },
    { once: true },
  );
  const listAgents = async () => {
    const [listed, terminals] = await Promise.all([
      lease.runtime.operations.listAgents(),
      lease.runtime.operations.listTerminals(),
    ]);
    if (!lease.isCurrent()) throw new Error("Usage lease retired");
    const panes = terminals.panes ?? [];
    return {
      agents: (listed.agents ?? []).map((agent) => {
        const pane = panes.find((p) => p.pane_id === agent.pane_id) ?? {};
        const record = lease.runtime.core.terminal(String(agent.pane_id));
        const foreground = record?.foreground as { argv?: unknown } | undefined;
        const session =
          argvSession(String(agent.agent), foreground?.argv) ??
          argvSession(String(agent.agent), record?.argv);
        return {
          ...pane,
          ...agent,
          ...(session ? { agent_session: session } : {}),
        };
      }),
    };
  };
  return {
    operations: { ...lease.runtime.operations, listAgents },
    usage: collector,
  };
}
