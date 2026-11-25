import { parseCommandArgs, UsageError } from "./command";

export function parseAgentArgs(word: string, args: string[]) {
  const [action, ...rest] = args;
  if (
    (word === "runtime" && action !== "ls") ||
    (word === "agent" && action !== "ls" && action !== "read")
  )
    throw new UsageError(
      `use ${word} ${word === "runtime" ? "ls" : "ls or read TARGET"}`,
    );
  const { values, positionals } = parseCommandArgs(
    rest,
    {
      json: { type: "boolean" },
      ...(word === "agent" && action === "ls"
        ? { connection: { type: "string" as const } }
        : {}),
      ...(action === "read" ? { lines: { type: "string" as const } } : {}),
    },
    action === "read" ? 1 : 0,
  );
  const params: Record<string, unknown> = {};
  if (typeof values.connection === "string") {
    if (!values.connection) throw new UsageError("--connection needs an ID");
    params.connection = values.connection;
  }
  if (action === "read") {
    if (!positionals[0]) throw new UsageError("agent read needs TARGET");
    params.target = positionals[0];
    if (values.lines !== undefined) {
      const lines = Number(values.lines);
      if (!Number.isSafeInteger(lines) || lines < 1 || lines > 10000)
        throw new UsageError("--lines must be an integer from 1 through 10000");
      params.lines = lines;
    }
  }
  return { command: `${word} ${action}`, params, json: values.json === true };
}

export function agentHuman(command: string, result: unknown): string {
  if (command === "agent read") return (result as { text: string }).text;
  if (command === "agent ls")
    return (
      (
        result as {
          agents: {
            target: string;
            status: string;
            agent: string | null;
            name: string | null;
          }[];
        }
      ).agents
        .map(
          (row) =>
            `${row.target}\t${row.status}\t${row.name ?? row.agent ?? "unknown"}`,
        )
        .join("\n") || "(none)"
    );
  const rows = (
    result as {
      connections: {
        host_id: string;
        host_label: string;
        connection_id: string;
        kind: string;
        version: string | null;
        state: string;
        actionable: boolean;
        agent_verbs: string[];
        manual: string | null;
      }[];
    }
  ).connections;
  const hosts = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = hosts.get(row.host_id) ?? [];
    group.push(row);
    hosts.set(row.host_id, group);
  }
  return (
    [...hosts.values()]
      .map((rows) =>
        [
          rows[0]!.host_label,
          ...rows.map(
            (row) =>
              `  ${row.connection_id}: ${row.kind} ${row.version ?? "(version unknown)"} — ${row.state}, ${row.actionable ? "actionable" : "not actionable"}; agent verbs: ${row.agent_verbs.join(", ") || "none"}${row.manual ? `; manual: ${row.manual}` : ""}`,
          ),
        ].join("\n"),
      )
      .join("\n") || "(none)"
  );
}
