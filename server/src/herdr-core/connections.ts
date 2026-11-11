import { ConnectionManager } from "../connections/manager";
import type { CoreConnectionSupport } from "../connections/core-support";
import { connectionIdentityForProfile } from "../connections/profile-service";
import type { CoreConnectionProfile } from "../connections/profiles";
import type { Logger } from "../utils/logger";
import { CORE_PROTOCOL_GENERATION, CoreClient } from "./client";
import { type CoreFixture, createCoreFixture } from "./fixture";
import { CoreObservationStore } from "./observations";
import { CoreFirstSight } from "./topology";
import {
  type CoreConnectionRuntime,
  type CoreTransport,
  createCoreConnectionRuntime,
} from "./runtime";
import { connectUnixStream, type CoreStreamConnector } from "./stream";
import { coreTransportForProfile } from "./transport";

export type CoreConnections = {
  manager: ConnectionManager<CoreConnectionRuntime>;
  observations: CoreObservationStore;
  support: CoreConnectionSupport<CoreConnectionRuntime>;
  fixture: CoreFixture;
  stop(): Promise<void>;
};

type CoreSupervisor = {
  willRetry(connectionId: string, error: unknown): boolean;
  runtimeFailed(connectionId: string, error: unknown): void;
  coreList(): Array<{
    id: string;
    state: string;
    type: string;
    core_state_dir: string;
  }>;
  create(value: unknown): Promise<unknown>;
  connect(connectionId: unknown): Promise<unknown>;
  remove(connectionId: unknown): Promise<unknown>;
};

/**
 * herdr-core connections beside the Herdr (TUI) ones: their own manager, so
 * a core and a TUI on the same host keep separate generations and identity,
 * and no Herdr consumer receives a core runtime.
 */
export function createCoreConnections(args: {
  logger: Logger;
  changed(): void;
  /** World's read model of this connection changed: re-read it. */
  observed?(connectionId: string, generation: number): void;
  /** The profile service: failure supervision and the preview fixture. */
  profiles: () => CoreSupervisor;
  transportFor?: (
    profile: CoreConnectionProfile,
    onTunnelExit: (error: Error) => void,
  ) => CoreTransport;
  connect?: CoreStreamConnector;
}): CoreConnections {
  const observed = (connectionId: string) => {
    if (manager.has(connectionId))
      args.observed?.(connectionId, manager.status(connectionId).generation);
  };
  const observations = new CoreObservationStore((connectionId) => {
    args.changed();
    observed(connectionId);
  });
  const manager = new ConnectionManager<CoreConnectionRuntime>(
    "",
    (status) => {
      if (status.state === "disconnected" || status.state === "error")
        observations.markStale(status.id, "disconnected");
      args.changed();
      args.observed?.(status.id, status.generation);
    },
    args.logger.child("herdr-core"),
  );
  const transportFor =
    args.transportFor ??
    ((profile: CoreConnectionProfile, onTunnelExit: (error: Error) => void) =>
      coreTransportForProfile(profile, {
        connectionId: profile.id,
        onTunnelExit,
      }));
  // World's own seen baseline per connection, kept across its reconnects.
  const firstSights = new Map<string, CoreFirstSight>();
  const support: CoreConnectionSupport<CoreConnectionRuntime> = {
    manager,
    createRuntime: (profile) => (context) => {
      const report = (error: Error) => {
        if (!context.isCurrent()) return;
        const service = args.profiles();
        context.reportError(error, {
          reconnecting: service.willRetry(profile.id, error),
        });
        service.runtimeFailed(profile.id, error);
      };
      let firstSight = firstSights.get(profile.id);
      if (!firstSight)
        firstSights.set(profile.id, (firstSight = new CoreFirstSight()));
      return createCoreConnectionRuntime({
        firstSight,
        onReadModel: () => observed(profile.id),
        identity: connectionIdentityForProfile(profile),
        context,
        transport: transportFor(profile, report),
        observations,
        onFailure: report,
        connect: args.connect,
      });
    },
    test: async (profile) => {
      const transport = transportFor(profile, () => {});
      const abort = new AbortController();
      try {
        const socket = await transport.open(abort.signal);
        const client = await CoreClient.open(
          await (args.connect ?? connectUnixStream)(socket, abort.signal),
        );
        try {
          await client.status();
          return {
            ok: true,
            runtime: "herdr-core",
            version: client.hello.version,
            protocol: CORE_PROTOCOL_GENERATION,
          };
        } finally {
          client.close();
        }
      } finally {
        abort.abort();
        await transport.close();
      }
    },
    observation: (connectionId) => observations.get(connectionId),
  };
  const fixture = createCoreFixture(args.profiles);
  return {
    manager,
    observations,
    support,
    fixture,
    stop: async () => {
      await manager.stopAll();
      fixture.dispose();
    },
  };
}
