import type { WorldTreeHost } from "./treeProjection";
import {
  groupByRuntime,
  type HostGroupOf,
  type RuntimeGroup,
} from "../worldHosts";

export type NavigatorHostGroup = RuntimeGroup<WorldTreeHost>;

/**
 * The navigator's hosts as World's "Group runtimes" setting groups them
 * (worldHosts.ts `groupByRuntime`): a machine's runtimes under one heading,
 * each naming its runtime, or each runtime on its own. A host the catalogue
 * does not list stands alone.
 */
export function navigatorHostGroups(
  hosts: readonly WorldTreeHost[],
  groupOf: HostGroupOf,
): NavigatorHostGroup[] {
  return groupByRuntime(
    hosts,
    ({ source }) => ({
      connectionId: source.connectionId,
      label: source.label,
      runtime: source.connection.runtime,
    }),
    groupOf,
  );
}
