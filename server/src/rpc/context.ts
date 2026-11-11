import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import type { ServerWebSocket } from "bun";
import type {
  ConnectionRpcRequest,
  resolveRpcRoute,
} from "../connections/rpc-routing";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { ProfileStorePort } from "../agent/profile-store";
import type { TerminalSettings } from "../agent/terminal-settings";
import type { createAssistantService } from "../assistant/service";
import type { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import type { ConnectionManager } from "../connections/manager";
import type { ConnectionProfileService } from "../connections/profile-service";
import type { Logger } from "../utils/logger";
import type { ObservedAgent } from "../world/board-recipient";
import type { BoardOp, BoardStorePort } from "../world/board-store";
import type { createMoveQueue } from "../world/desk-move";
import type { createWorldDeskService } from "../world/desk-service";
import type { WorldSnapshotService } from "../world/snapshot";
import type { FocusedAcquisition } from "../world/focused-acquisition";
import type { AgentActivityCache } from "../world/agent-activity-cache";
import type { DeskWatches } from "../world/desk-watches";
import type { WorldWatchlistRegistry } from "../world/watchlist";
import type { createWorldCliService } from "../world/world-cli-service";

type Socket = ServerWebSocket<unknown>;
type DeskService = ReturnType<typeof createWorldDeskService>;

/** What the rpc/ namespace handlers share with their World service. */
/** World's aggregate snapshot over Herdr (TUI) and herdr-core connections. */
export type ObservedSnapshots = WorldSnapshotService<
  LegacyConnectionRuntime | CoreConnectionRuntime
>;

export type RpcServices = {
  persistentMarks?: import("../world/persistent-terminal-marks").PersistentTerminalMarks;
  clock: import("../service/ports").Clock;
  bindings?: import("../storage/world-bindings").WorldBindings;
  serviceIncarnation?: string;
  /** Test seam: the environment World's harness skills resolve against. */
  worldIntegrationRuntime?: () => import("../cli/command").CliRuntime;
  bindBoardRecipients(
    ops: readonly BoardOp[],
    observed: ReadonlyMap<string, ObservedAgent>,
  ): Promise<void>;
  board(): BoardStorePort;
  clients: Set<Socket>;
  connectionManager: ConnectionManager<LegacyConnectionRuntime>;
  connectionProfiles: ConnectionProfileService<
    LegacyConnectionRuntime,
    CoreConnectionRuntime
  >;
  /** Testing switch: the in-process herdr-core preview fixture. */
  coreFixture?: import("../herdr-core/fixture").CoreFixture;
  focusedAcquisition: FocusedAcquisition<Socket>;
  agentActivity: AgentActivityCache;
  deskWatches: DeskWatches<Socket>;
  conversationWatchers: WeakMap<Socket, Set<{ unwatch(owner: object): void }>>;
  getAssistantService(): Promise<
    Awaited<ReturnType<typeof createAssistantService>>
  >;
  logger: Logger;
  markRpcError(
    ws: Socket,
    id: string | null | undefined,
    detail?: string,
  ): void;
  profiles(): ProfileStorePort;
  /** Per-terminal profile assignment and Town master, kept in Herdr. */
  terminalSettings(): TerminalSettings;
  publishBoardChanged(revision: number): void;
  publishProfilesChanged(revision: number): void;
  publishWatchlistChanged(revision: number): void;
  publishWorldInvalidation(
    connectionId: string,
    connectionGeneration: number,
    kind?: "late" | "activity",
  ): void;
  safeSend(
    ws: Socket,
    payload: string,
    context?: string,
    coalesceKey?: string,
  ): boolean;
  snapshotAdmission: WorldSnapshotAdmission;
  townMoveQueues: Map<string, ReturnType<typeof createMoveQueue>>;
  /** Server-wide interface preferences (bridge.ui_settings.*). */
  uiSettings: ReturnType<
    typeof import("../bridge/settings-rpc").createUiSettingsRpcHandler
  >;
  worldWatchlist: WorldWatchlistRegistry;
  /** The agent bin; absent without World storage's effect outbox. */
  bin?: import("../service/bin-service").BinService;
  worldDesk: DeskService["registry"];
  publishDeskChanged: DeskService["publish"];
  worldCli: ReturnType<typeof createWorldCliService>;
  worldSnapshots: ObservedSnapshots | null;
  worldUsage?: import("../usage/service").WorldUsageService;
};

type RpcRoute = ReturnType<typeof resolveRpcRoute<LegacyConnectionRuntime>>;

/**
 * What one browser RPC hands to a namespace handler (see service/rpc-dispatch.ts).
 * Handlers return false synchronously when no branch matches, so dispatch
 * never yields before entering the matching handler on the captured runtime.
 */
export type BridgeRpcContext = {
  ws: ServerWebSocket<unknown>;
  req: ConnectionRpcRequest;
  id: string;
  method: string;
  params: ConnectionRpcRequest["params"];
  route: RpcRoute;
  connectionId: string | null;
  requestIsCurrent: () => boolean;
  sendReply: (message: Record<string, unknown>, context: string) => boolean;
  sendError: (context: string, error: unknown) => void;
  services: RpcServices;
};

/** A request routed to one connection's current runtime. */
export type ConnectionRpcContext = Omit<BridgeRpcContext, "route"> & {
  route: Extract<RpcRoute, { scope: "connection" }>;
  connection: LegacyConnectionRuntime;
};
