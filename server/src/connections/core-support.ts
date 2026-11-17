import type {
  ConnectionManager,
  ConnectionRuntime,
  ConnectionRuntimeFactory,
} from "./manager";
import type { CoreConnectionProfile } from "./profiles";

/** herdr-core connections: their own manager, generations and identity. */
export type CoreConnectionSupport<CoreRuntime extends ConnectionRuntime> = {
  manager: ConnectionManager<CoreRuntime>;
  createRuntime(
    profile: CoreConnectionProfile,
  ): ConnectionRuntimeFactory<CoreRuntime>;
  test?(profile: CoreConnectionProfile): Promise<{
    ok: true;
    version: string | null;
    protocol: number;
  }>;
  /** Connection-status detail for the Connections page. */
  observation?(connectionId: string): unknown;
};

/** The manager calls that route by a profile's runtime kind. */
export type RoutedManager = Pick<
  ConnectionManager<ConnectionRuntime>,
  | "status"
  | "start"
  | "stop"
  | "has"
  | "unregister"
  | "markReconnecting"
  | "retireFailedRuntime"
>;

export type CoreConnectionListItem = ReturnType<
  ConnectionManager<ConnectionRuntime>["status"]
> &
  CoreConnectionProfile & { read_only: boolean; observation: unknown };
