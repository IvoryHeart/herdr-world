import {
  ASSISTANT_MAX_WORKSPACES,
  type AssistantWorkspace,
  type AssistantWorkspaceRef,
  type AssistantMentionTarget,
} from "../../../shared/assistant";
import type { RuntimeLease } from "./core-context";
export function createScopeExtension({
  scopes,
  workspaceIdentities,
  mentionGuards,
  captureScope,
  assertCurrent,
}: {
  scopes: WeakMap<AssistantWorkspace[], Map<string, RuntimeLease>>;
  workspaceIdentities: WeakMap<AssistantWorkspace[], string[]>;
  mentionGuards: WeakMap<
    AssistantWorkspace[],
    Map<string, Extract<AssistantMentionTarget, { kind: "agent" }>>
  >;
  captureScope(
    refs: AssistantWorkspaceRef[],
    signal?: AbortSignal,
  ): Promise<AssistantWorkspace[]>;
  assertCurrent(lease: RuntimeLease, signal?: AbortSignal): void;
}) {
  /**
   * A turn's scope with more workspaces: those it already holds keep their
   * leases and mention guards, and only the added ones are read.
   */
  const refKey = (ref: AssistantWorkspaceRef) =>
    `${ref.connection_id}\0${ref.workspace_id}`;
  async function extendScope(
    captured: AssistantWorkspace[],
    refs: AssistantWorkspaceRef[],
    signal?: AbortSignal,
  ): Promise<AssistantWorkspace[]> {
    const leases = scopes.get(captured);
    const identities = workspaceIdentities.get(captured);
    if (!leases || !identities)
      throw new Error("Ranger workspace scope was not approved");
    const held = new Set(captured.map(refKey));
    const missing = refs.filter((ref) => !held.has(refKey(ref)));
    if (!missing.length) return captured;
    if (captured.length + missing.length > ASSISTANT_MAX_WORKSPACES)
      throw new Error(
        `Ranger uses at most ${ASSISTANT_MAX_WORKSPACES} workspaces at once`,
      );
    const added = await captureScope(missing, signal);
    const merged = new Map(leases);
    for (const [connectionId, lease] of scopes.get(added)!) {
      const old = merged.get(connectionId);
      if (old && old.generation !== lease.generation)
        throw new Error(`Connection ${connectionId} changed`);
      if (!old) merged.set(connectionId, lease);
    }
    for (const lease of merged.values()) assertCurrent(lease, signal);
    const widened: AssistantWorkspace[] = [...captured, ...added];
    Object.freeze(widened);
    scopes.set(widened, merged);
    workspaceIdentities.set(widened, [
      ...identities,
      ...workspaceIdentities.get(added)!,
    ]);
    const guards = mentionGuards.get(captured);
    if (guards) mentionGuards.set(widened, new Map(guards));
    return widened;
  }

  return extendScope;
}
