import type { WorldTreeHost } from "./treeProjection";
import { runtimeTag, type WorldHostGroup } from "../worldHosts";

export type NavigatorHostGroup = {
  key: string;
  label: string;
  members: WorldTreeHost[];
  /** Each member's runtime tag, by host node ID, in groups of two or more. */
  tags: Map<string, string>;
};

/**
 * The navigator's hosts as World's "Group runtimes" setting groups them
 * (worldHosts.ts `hostGroupOf`): a machine's runtimes under one heading,
 * each naming its runtime, or each runtime on its own. A host the catalogue
 * does not list stands alone.
 */
export function navigatorHostGroups(
  hosts: readonly WorldTreeHost[],
  groupOf: (
    connectionId: string,
  ) => Pick<WorldHostGroup, "key" | "label"> | undefined,
): NavigatorHostGroup[] {
  const byKey = new Map<string, NavigatorHostGroup>();
  for (const host of hosts) {
    const group = groupOf(host.source.connectionId);
    const key = group?.key ?? `runtime:${host.source.connectionId}`;
    const entry = byKey.get(key) ?? {
      key,
      label: group?.label ?? host.source.label,
      members: [],
      tags: new Map<string, string>(),
    };
    entry.members.push(host);
    byKey.set(key, entry);
  }
  for (const entry of byKey.values()) {
    if (entry.members.length < 2) continue;
    const kinds = entry.members.map(
      ({ source }) => source.connection.runtime ?? "herdr",
    );
    entry.members.forEach(({ source }, index) => {
      const kind = kinds[index]!;
      // Two runtimes of one kind on a machine: their names tell them apart.
      entry.tags.set(
        source.id,
        kinds.filter((each) => each === kind).length > 1
          ? `${runtimeTag(kind)} · ${source.label}`
          : runtimeTag(kind),
      );
    });
  }
  return [...byKey.values()];
}
