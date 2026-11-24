import type {
  RuntimeAgentCapabilities,
  RuntimeOperations,
  RuntimeRow,
} from "../adapters/runtime-ports";
import type { WorldSnapshotResult, WorldConnectionSnapshot } from "./snapshot";
import { CliError, notFound, refused, usage } from "./world-cli-errors";

export type AgentCommandLease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  operations: Pick<RuntimeOperations, "listAgents" | "readTerminal">;
  version?: string | null;
};

type Deps = {
  snapshot(): Promise<WorldSnapshotResult>;
  lease(connectionId: string): AgentCommandLease | null;
  capabilities(kind: string): RuntimeAgentCapabilities | undefined;
};

const targetOf = (connection: string, address: string) =>
  `${encodeURIComponent(connection)}/${encodeURIComponent(address)}`;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** World owns agent resolution; consumers never choose a native client or fallback. */
export function createAgentCommands(deps: Deps) {
  return {
    async call(
      command: string,
      params: Record<string, unknown>,
      recheck: () => void,
    ) {
      const snapshot = await deps.snapshot();
      recheck();
      const kindOf = (connection: WorldConnectionSnapshot) =>
        snapshot.hosts
          ?.flatMap((host) => host.runtimes)
          .find((runtime) => runtime.connection_id === connection.connection_id)
          ?.kind ??
        connection.runtime ??
        "herdr";
      const actionable = (connection: WorldConnectionSnapshot) =>
        connection.actionable &&
        !connection.stale &&
        connection.state === "ready" &&
        connection.snapshot_generation === connection.generation;
      const capture = (connection: WorldConnectionSnapshot) => {
        if (!actionable(connection))
          refused(`not actionable: ${connection.connection_id}`);
        const lease = deps.lease(connection.connection_id);
        if (
          !lease ||
          lease.connectionId !== connection.connection_id ||
          lease.generation !== connection.generation ||
          !lease.isCurrent()
        )
          return refused(
            `not actionable: ${connection.connection_id} generation changed`,
          );
        return lease;
      };
      const current = (lease: AgentCommandLease) => {
        recheck();
        if (!lease.isCurrent())
          refused(`not actionable: ${lease.connectionId} generation changed`);
      };
      const supports = (
        connection: WorldConnectionSnapshot,
        verb: "ls" | "read",
      ) => {
        const kind = kindOf(connection);
        if (!deps.capabilities(kind)?.verbs.includes(verb))
          refused(`agent ${verb} not supported by runtime kind ${kind}`);
      };
      const connectionFor = (id: string) => {
        const found = snapshot.connections.find(
          (entry) => entry.connection_id === id,
        );
        if (!found) return notFound(`unknown target: connection ${id}`);
        return found;
      };
      const invoke = async <T>(
        lease: AgentCommandLease,
        operation: () => Promise<T>,
      ): Promise<T> => {
        current(lease);
        try {
          const result = await operation();
          current(lease);
          return result;
        } catch (error) {
          current(lease);
          if (error instanceof CliError) throw error;
          throw new CliError(
            "unavailable",
            `runtime read failed on ${lease.connectionId}: ${(error as Error).message}`,
          );
        }
      };
      const listing = async (connection: WorldConnectionSnapshot) => {
        const lease = capture(connection);
        supports(connection, "ls");
        const result = await invoke(lease, () =>
          lease.operations.listAgents(
            {},
            { timeoutMs: 5000, beforeSend: () => current(lease) },
          ),
        );
        if (!Array.isArray(result.agents))
          throw new CliError(
            "unavailable",
            `invalid agent listing on ${lease.connectionId}`,
          );
        return { connection, lease, agents: result.agents };
      };
      if (command === "runtime ls") {
        const connections = snapshot.connections.map((connection) => {
          const host = snapshot.hosts?.find((host) =>
            host.connection_ids.includes(connection.connection_id),
          );
          const runtime = host?.runtimes.find(
            (runtime) => runtime.connection_id === connection.connection_id,
          );
          const kind = kindOf(connection);
          const capability = deps.capabilities(kind);
          const lease = actionable(connection)
            ? deps.lease(connection.connection_id)
            : null;
          return {
            connection_id: connection.connection_id,
            generation: connection.generation,
            host_id: host?.host_id ?? connection.connection_id,
            host_label: host?.label ?? connection.label,
            kind,
            version: lease?.version ?? runtime?.version ?? null,
            state: connection.state,
            actionable:
              actionable(connection) &&
              !!lease &&
              lease.connectionId === connection.connection_id &&
              lease.generation === connection.generation &&
              lease.isCurrent(),
            agent_verbs: [...(capability?.verbs ?? [])],
            manual: capability?.manual ?? null,
          };
        });
        return { connections };
      }
      const all = () => snapshot.connections.filter(actionable);
      if (command === "agent ls") {
        const selected =
          params.connection === undefined
            ? all()
            : [connectionFor(String(params.connection))];
        const agents = [];
        const leases = [];
        for (const connection of selected) {
          const listed = await listing(connection);
          leases.push(listed.lease);
          for (const row of listed.agents) {
            const address = text(row.pane_id);
            if (!address)
              throw new CliError(
                "unavailable",
                `invalid agent address on ${connection.connection_id}`,
              );
            agents.push({
              target: targetOf(connection.connection_id, address),
              connection_id: connection.connection_id,
              generation: connection.generation,
              address,
              name: text(row.name),
              agent: text(row.agent),
              status: text(row.agent_status) ?? "unknown",
            });
          }
        }
        for (const lease of leases) current(lease);
        return { agents };
      }
      if (command !== "agent read")
        return usage(`unknown agent command ${command}`);
      if (typeof params.target !== "string" || !params.target)
        usage("agent read needs TARGET");
      const target = params.target as string;
      if (
        params.lines !== undefined &&
        (!Number.isSafeInteger(params.lines) ||
          Number(params.lines) < 1 ||
          Number(params.lines) > 10000)
      )
        usage("--lines must be an integer from 1 through 10000");
      const parts = target.split("/");
      if (parts.length > 2 || parts.some((part) => !part))
        usage("use CONNECTION/ADDRESS or a unique bare address");
      let connectionId: string | undefined;
      let address: string;
      try {
        connectionId =
          parts.length === 2 ? decodeURIComponent(parts[0]!) : undefined;
        address = parts.length === 2 ? decodeURIComponent(parts[1]!) : target;
      } catch {
        return usage("invalid target encoding");
      }
      const selected =
        connectionId === undefined ? all() : [connectionFor(connectionId)];
      const candidates: {
        lease: AgentCommandLease;
        row: RuntimeRow;
        connection: WorldConnectionSnapshot;
      }[] = [];
      const leases: AgentCommandLease[] = [];
      for (const connection of selected) {
        if (connectionId !== undefined) {
          capture(connection);
          supports(connection, "read");
        }
        const listed = await listing(connection);
        leases.push(listed.lease);
        for (const row of listed.agents)
          if (row.pane_id === address)
            candidates.push({ lease: listed.lease, row, connection });
      }
      for (const lease of leases) current(lease);
      if (candidates.length === 0) return notFound(`unknown target: ${target}`);
      if (candidates.length > 1)
        return refused(
          `ambiguous target ${target}: ${candidates.map(({ lease, row }) => targetOf(lease.connectionId, String(row.pane_id))).join(", ")}`,
        );
      const chosen = candidates[0]!;
      supports(chosen.connection, "read");
      const result = await invoke(chosen.lease, () =>
        chosen.lease.operations.readTerminal(
          { pane_id: address, source: "visible", strip_ansi: true },
          { timeoutMs: 8000, beforeSend: () => current(chosen.lease) },
        ),
      );
      const read = (result.read ?? result) as RuntimeRow;
      if (typeof read.text !== "string")
        throw new CliError(
          "unavailable",
          `invalid screen reply on ${chosen.lease.connectionId}`,
        );
      const lines = Number(params.lines);
      const screen =
        params.lines === undefined
          ? read.text
          : read.text.replace(/\n$/, "").split("\n").slice(-lines).join("\n");
      return {
        target: targetOf(chosen.lease.connectionId, address),
        connection_id: chosen.lease.connectionId,
        generation: chosen.lease.generation,
        text: screen,
      };
    },
  };
}

export type AgentCommands = ReturnType<typeof createAgentCommands>;
