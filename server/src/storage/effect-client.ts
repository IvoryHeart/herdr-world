import type { AttentionEntry, StorageRequest } from "./world-protocol";
import type { EffectEntry, EffectReply, EffectStore } from "../effects/types";

export function createEffectStore(
  request: <T>(input: StorageRequest) => Promise<T>,
  remember: (entry: AttentionEntry) => void,
): EffectStore {
  const entries = new Map<string, EffectEntry>();
  const accept = (reply: EffectReply) => {
    if (reply.attention) remember(reply.attention);
    if (reply.effect) entries.set(reply.effect.id, reply.effect);
    return reply.effect;
  };
  return {
    current: (id) => entries.get(id) ?? null,
    get: async (id) =>
      accept(await request<EffectReply>({ type: "effect-read", id })),
    list: (verb) => request<EffectEntry[]>({ type: "effect-read", verb }),
    transition: async (change) =>
      accept(await request<EffectReply>({ type: "effect-transition", change })),
  };
}
