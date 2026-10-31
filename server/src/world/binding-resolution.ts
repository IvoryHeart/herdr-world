import {
  bindingPolicies,
  type BindingEntity,
  type BindingEvent,
  type BindingFence,
  type BindingResolution,
  type SourceBinding,
} from "./binding-types";

export function sameBindingFence(a: BindingFence, b: BindingFence): boolean {
  return (
    a.adapter === b.adapter &&
    a.instance === b.instance &&
    a.service_incarnation === b.service_incarnation &&
    a.generation === b.generation
  );
}
export const bindingWitnessMatches = (
  evidence: SourceBinding["evidence"],
  entity: BindingEntity,
) =>
  evidence.terminals.some((id) => entity.terminals.includes(id)) &&
  (!evidence.session || evidence.session === entity.session);
export const bindingListingAbsent = (
  policy: SourceBinding["policy"],
  witness: readonly string[],
  seen: ReadonlySet<string>,
) =>
  bindingPolicies[policy].listingAbsence &&
  witness.length > 0 &&
  witness.every((id) => !seen.has(id));
const matches = (binding: SourceBinding, entity: BindingEntity) =>
  bindingWitnessMatches(binding.evidence, entity);
export function bindingObservationAmbiguous(
  entities: readonly BindingEntity[],
): boolean {
  const terminals = entities.flatMap((entity) => [...entity.terminals]);
  const sessions = entities.flatMap((entity) =>
    entity.session ? [entity.session] : [],
  );
  return (
    new Set(entities.map((entity) => entity.native_id)).size !==
      entities.length ||
    new Set(terminals).size !== terminals.length ||
    new Set(sessions).size !== sessions.length
  );
}

/** A kind's declarations are the only continuity and absence authority. */
export function resolveBinding(
  saved: SourceBinding,
  event: BindingEvent,
  current: BindingFence | null,
  now: number,
): BindingResolution {
  const binding = structuredClone(saved);
  const policy = bindingPolicies[binding.policy];
  const finish = (
    state: SourceBinding["state"],
    checked = false,
  ): BindingResolution => {
    binding.state = state;
    if (checked) binding.checked_at = now;
    return {
      binding,
      target:
        state === "attached" && current && binding.evidence.terminals.length
          ? {
              adapter: binding.adapter,
              instance: binding.instance,
              kind: binding.kind,
              native_id: binding.native_id,
              evidence: structuredClone(binding.evidence),
              fence: { ...current },
            }
          : null,
    };
  };
  if (event.type === "user-detach") return finish("ended", true);
  if (event.type === "user-keep") {
    const { adapter, instance, kind, native_id, evidence } = event.target;
    Object.assign(binding, {
      adapter,
      instance,
      kind,
      native_id,
      evidence: structuredClone(evidence),
    });
    // A user's identity decision is not itself a current runtime observation.
    return finish("unresolved", true);
  }
  if (saved.state === "ended") return finish("ended");
  if (
    event.type === "offline" ||
    !current ||
    !sameBindingFence(event.fence, current) ||
    current.adapter !== binding.adapter ||
    current.instance !== binding.instance
  )
    return finish("unresolved");
  if (event.type === "absence") {
    const declared = event.via === "close" ? policy.close : policy.notFound;
    return finish(
      declared && event.native_id === binding.native_id
        ? "ended"
        : "unresolved",
      true,
    );
  }
  if (event.type === "world-move") {
    if (
      event.from !== binding.native_id ||
      !matches(binding, event.target) ||
      new Set(event.target.terminals).size !== event.target.terminals.length
    )
      return finish("unresolved", true);
    binding.native_id = event.target.native_id;
    return finish("attached", true);
  }
  if (!event.complete) return finish("unresolved");
  const entities = event.entities;
  const native = entities.filter(
    (entity) => entity.native_id === binding.native_id,
  );
  const witnessed = entities.filter((entity) => matches(binding, entity));
  const duplicate = bindingObservationAmbiguous(entities);
  if (duplicate) return finish("unresolved", true);
  if (
    native.length === 1 &&
    (matches(binding, native[0]!) ||
      (binding.policy === "board-string" &&
        ["tab", "workspace"].includes(binding.kind) &&
        !binding.evidence.terminals.length))
  )
    return finish("attached", true);
  if (policy.listingMove && witnessed.length === 1) {
    binding.native_id = witnessed[0]!.native_id;
    return finish("attached", true);
  }
  if (
    "sessionEnd" in policy &&
    policy.sessionEnd &&
    binding.evidence.session &&
    entities.some(
      (entity) =>
        entity.session &&
        entity.session !== binding.evidence.session &&
        binding.evidence.terminals.some((id) => entity.terminals.includes(id)),
    )
  )
    return finish("ended", true);
  if (
    bindingListingAbsent(
      binding.policy,
      binding.evidence.terminals,
      new Set(entities.flatMap((entity) => [...entity.terminals])),
    )
  )
    return finish("ended", true);
  return finish(native.length ? "unconfirmed" : "unresolved", true);
}
