import { createHash, randomUUID } from "node:crypto";
import { nativeId } from "./snapshot-identity";
import type {
  WorldConnectionSnapshot,
  WorldSnapshot,
  WorldSnapshotResult,
} from "./snapshot";

export type ObservationBase = {
  service_incarnation: string;
  hosts: { connection_id: string; generation: number; token: string }[];
};
export type ObservationHost = Omit<WorldConnectionSnapshot, "snapshot"> & {
  token: string | null;
  unchanged?: true;
  snapshot?: WorldSnapshot | null;
};

/** Validate before opening transfers, reading hosts or running snapshot side effects. */
export function parseObservationBase(
  params: unknown,
): ObservationBase | undefined {
  if (!params || typeof params !== "object" || !("base" in params))
    return undefined;
  const invalid = (): never => {
    throw new Error("invalid World observation base");
  };
  const base = params.base as ObservationBase | null;
  if (
    !base ||
    typeof base !== "object" ||
    Array.isArray(base) ||
    typeof base.service_incarnation !== "string" ||
    !base.service_incarnation ||
    base.service_incarnation.length > 128 ||
    !Array.isArray(base.hosts) ||
    base.hosts.length > 64
  )
    return invalid();
  const seen = new Set<string>();
  for (const host of base.hosts) {
    if (
      !host ||
      typeof host !== "object" ||
      Array.isArray(host) ||
      !nativeId(host.connection_id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(host.connection_id) ||
      seen.has(host.connection_id) ||
      !Number.isSafeInteger(host.generation) ||
      host.generation < 0 ||
      typeof host.token !== "string" ||
      !host.token ||
      host.token.length > 64
    )
      return invalid();
    seen.add(host.connection_id);
  }
  return base;
}

/** One service incarnation; weak keys bound digest retention to projected cache entries. */
export class WorldObservation {
  private readonly tokens = new WeakMap<WorldSnapshot, Map<number, string>>();
  constructor(readonly incarnation: string = randomUUID()) {}

  reply(snapshot: WorldSnapshotResult, base?: ObservationBase) {
    const held = new Map(
      base?.service_incarnation === this.incarnation
        ? base.hosts.map((host) => [host.connection_id, host] as const)
        : [],
    );
    return {
      ...snapshot,
      service_incarnation: this.incarnation,
      connections: snapshot.connections.map((connection): ObservationHost => {
        const token = this.token(connection);
        const previous = held.get(connection.connection_id);
        if (
          token !== null &&
          previous?.token === token &&
          previous.generation === connection.generation &&
          previous.generation === connection.snapshot_generation
        ) {
          const confirmation: ObservationHost = {
            ...connection,
            token,
            unchanged: true,
          };
          delete confirmation.snapshot;
          return confirmation;
        }
        return { ...connection, token };
      }),
    };
  }

  private token(connection: WorldConnectionSnapshot): string | null {
    const { snapshot, snapshot_generation: generation } = connection;
    if (!snapshot) return null;
    // A snapshot without its producing generation can never become a valid base.
    if (generation === null)
      throw new Error("World snapshot lacks its generation");
    let generations = this.tokens.get(snapshot);
    if (!generations) this.tokens.set(snapshot, (generations = new Map()));
    let token = generations.get(generation);
    if (token === undefined) {
      token = createHash("sha256")
        .update(JSON.stringify([generation, snapshot]))
        .digest("hex");
      generations.set(generation, token);
    }
    return token;
  }
}
