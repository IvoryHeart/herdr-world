type LsRuntime = {
  connection_id: string;
  kind: string;
  version: string | null;
  state: string;
  workspaces?: { label?: string; workspace_id: string }[];
};
export type LsResult = {
  grouping?: string;
  groups?: {
    label: string;
    runtimes: { connection_id: string; runtime: string; label: string }[];
  }[];
  hosts: {
    label: string;
    state: string;
    runtimes: LsRuntime[];
    installable_runtimes: { label: string }[];
  }[];
};

/**
 * `herdr-world ls` for people: the groups World publishes (the ones Town,
 * Desk, Board and the Hosts control show), each runtime with its rooms, then
 * any host World holds no runtime on.
 */
export function lsHuman({ grouping, groups, hosts }: LsResult) {
  const runtimeLines = (runtime: LsRuntime) => [
    `  ${runtime.kind} ${runtime.version ?? "(version unknown)"} — ${runtime.state}`,
    ...(runtime.workspaces ?? []).map(
      (room) => `    ${room.label ?? room.workspace_id}`,
    ),
  ];
  const hostBlock = (host: LsResult["hosts"][number]) =>
    [
      `${host.label} — ${host.state}`,
      ...host.runtimes.flatMap(runtimeLines),
      ...(host.state === "empty"
        ? [
            `  No runtime installed. Install ${host.installable_runtimes.map((runtime) => runtime.label).join(" or ")}.`,
          ]
        : []),
    ].join("\n");
  if (!groups) return hosts.map(hostBlock).join("\n");
  const runtimes = new Map(
    hosts.flatMap((host) =>
      host.runtimes.map((runtime) => [runtime.connection_id, runtime] as const),
    ),
  );
  const grouped = new Set(
    groups.flatMap((group) => group.runtimes.map((each) => each.connection_id)),
  );
  return [
    `Group runtimes: ${grouping === "runtime" ? "one per runtime" : "one per machine"}`,
    ...groups.map((group) =>
      [
        group.label,
        ...group.runtimes.flatMap((member) =>
          runtimeLines(
            runtimes.get(member.connection_id) ?? {
              connection_id: member.connection_id,
              kind: member.runtime,
              version: null,
              state: "not reported",
            },
          ),
        ),
      ].join("\n"),
    ),
    // Hosts holding no grouped runtime: nothing installed, or not yet grouped.
    ...hosts
      .filter((host) =>
        host.runtimes.every((runtime) => !grouped.has(runtime.connection_id)),
      )
      .map(hostBlock),
  ].join("\n");
}
