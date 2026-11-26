import type { FeatureRpcHandler } from "../contract";
import type { ApartmentsService } from "./service";

/**
 * Apartments (world.apartments.*): finished agents' records. Reading the
 * list or a resident's history never acts on a host; evicting removes
 * records only. Resuming is a launch (launcher.start or world.core.launch
 * with `resume_resident`), qualified by that launch's own connection.
 */
export async function handleApartmentsRpc(
  rpc: Parameters<FeatureRpcHandler>[0],
  service: ApartmentsService | undefined,
): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const p = (params ?? {}) as Record<string, unknown>;
  const reply = (result: unknown) => {
    sendReply({ id, result }, "world-apartments");
  };
  try {
    if (!service?.apartments.available)
      throw new Error("Apartments need World storage");
    const { apartments } = service;
    if (method === "world.apartments.list") return reply(apartments.list());
    if (method === "world.apartments.history")
      return reply(await service.history(String(p.id ?? "")));
    if (method === "world.apartments.evict")
      return reply(
        await apartments.evict(
          Array.isArray(p.ids) ? p.ids.map((item) => String(item)) : [],
        ),
      );
    throw new Error("unknown apartments operation");
  } catch (error) {
    sendError("world-apartments-error", error);
  }
}
