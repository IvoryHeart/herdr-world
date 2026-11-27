import { spyOn } from "bun:test";
import {
  deriveHostGrouping,
  type GroupingProfile,
  groupingHosts,
  type HostGrouping,
  type RuntimeGrouping,
} from "../../../../shared/hostGrouping";
import { worldRuntimeStore } from "../runtimeStore";

type Catalogue = {
  connections: readonly GroupingProfile[];
  coreConnections?: readonly GroupingProfile[];
};

/** What World publishes as `host_grouping` for a catalogue (all live). */
export function hostGroupingFor(
  { connections, coreConnections = [] }: Catalogue,
  setting: RuntimeGrouping = "machine",
): HostGrouping {
  return deriveHostGrouping(
    groupingHosts(connections, coreConnections),
    setting,
    () => false,
  );
}

/**
 * The replica as if World had published the grouping of `read()`'s
 * catalogue: re-derived (and kept while unchanged) whenever it changes, as
 * World publishes a new revision. Returns the restore.
 */
export function publishHostGroupingOf(
  read: () => Catalogue,
  setting: () => RuntimeGrouping = () => "machine",
) {
  const original = worldRuntimeStore.get;
  let last:
    | {
        connections: Catalogue["connections"];
        coreConnections: Catalogue["coreConnections"];
        setting: RuntimeGrouping;
        grouping: HostGrouping;
      }
    | undefined;
  const spy = spyOn(worldRuntimeStore, "get").mockImplementation(() => {
    const catalogue = read();
    const grouping = setting();
    if (
      !last ||
      last.connections !== catalogue.connections ||
      last.coreConnections !== catalogue.coreConnections ||
      last.setting !== grouping
    )
      last = {
        connections: catalogue.connections,
        coreConnections: catalogue.coreConnections,
        setting: grouping,
        grouping: hostGroupingFor(catalogue, grouping),
      };
    return { ...original(), hostGrouping: last!.grouping };
  });
  return () => spy.mockRestore();
}
