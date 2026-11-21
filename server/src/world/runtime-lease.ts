import type { RpcServices } from "../rpc/context";

type RuntimeServices = Pick<RpcServices, "connectionManager" | "coreControl">;

/** Resolve only the named owner; an unavailable core must never use TUI. */
export function worldRuntimeLease(
  services: RuntimeServices,
  connectionId: string,
  generation: number,
) {
  const core = services.coreControl?.manager;
  if (core?.has(connectionId)) {
    const lease = core.readyRuntimeLease(connectionId);
    if (!lease || lease.generation !== generation) return null;
    const isCurrent = () => lease.isCurrent() && lease.runtime.core.actionable;
    return isCurrent() ? { kind: "core" as const, lease, isCurrent } : null;
  }
  const tui = services.connectionManager;
  if (!tui.has(connectionId)) return null;
  const lease = tui.readyRuntimeLease(connectionId);
  if (!lease || lease.generation !== generation || !lease.isCurrent())
    return null;
  return { kind: "tui" as const, lease, isCurrent: () => lease.isCurrent() };
}
