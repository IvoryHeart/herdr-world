import { serverFeatures } from "./catalog";
import type {
  Feature,
  FeatureInstance,
  FeatureKernel,
  FeatureKey,
  FeatureRpcHandler,
  StopPhase,
} from "./contract";
import type { ConnectionStatus } from "../connections/types";

export function composeFeatures(
  kernel: FeatureKernel,
  features = serverFeatures,
) {
  const pending = new Map<string, Feature>();
  const methods = new Set<string>();
  for (const feature of features) {
    if (pending.has(feature.id))
      throw new Error(`Duplicate feature: ${feature.id}`);
    pending.set(feature.id, feature);
    for (const verb of feature.verbs) {
      if (verb.channel !== "rpc")
        throw new Error(`Non-RPC feature verb: ${verb.name}`);
      if (methods.has(verb.name))
        throw new Error(`Duplicate feature method: ${verb.name}`);
      methods.add(verb.name);
    }
  }
  for (const feature of features)
    for (const dependency of feature.requires)
      if (!pending.has(dependency))
        throw new Error(`Missing feature dependency: ${dependency}`);
  const ordered: Feature[] = [];
  const resolved = new Set<string>();
  while (pending.size) {
    const next = [...pending.values()]
      .filter((f) => f.requires.every((key) => resolved.has(key)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (!next) throw new Error("Feature dependency cycle");
    pending.delete(next.id);
    resolved.add(next.id);
    ordered.push(next);
  }
  const instances = new Map<string, FeatureInstance>();
  const rpc = new Map<string, FeatureRpcHandler>();
  for (const feature of ordered) {
    const instance = feature.create(kernel, <T>(key: FeatureKey<T>) => {
      if (!feature.requires.includes(key))
        throw new Error(`Undeclared feature dependency: ${key}`);
      return instances.get(key)!.api as T;
    });
    const declared = feature.verbs.map((verb) => verb.name).sort();
    const handlers = Object.keys(instance.rpc).sort();
    if (
      declared.length !== handlers.length ||
      declared.some((name, i) => name !== handlers[i])
    )
      throw new Error(`Feature RPC declarations differ: ${feature.id}`);
    instances.set(feature.id, instance);
    for (const [method, handler] of Object.entries(instance.rpc))
      rpc.set(method, handler);
  }
  const forward = [...instances.values()];
  const reverse = [...forward].reverse();
  return {
    rpc: rpc as ReadonlyMap<string, FeatureRpcHandler>,
    connectionStatus: (status: ConnectionStatus) => {
      for (const f of forward) f.connectionStatus?.(status);
    },
    listening: (port: number) => {
      for (const f of forward) f.listening?.(port);
    },
    hasStop: (phase: StopPhase) => reverse.some((f) => f.stop?.[phase]),
    async stop(phase: StopPhase) {
      for (const f of reverse) await f.stop?.[phase]?.();
    },
  };
}
