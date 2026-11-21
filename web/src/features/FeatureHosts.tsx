import type { ComponentType } from "react";
import type { WorldObject } from "../world/worldObject";
import * as discovered from "./index.gen";

/**
 * Named places in the World shell where features mount, and the props each
 * slot passes. A feature's `mount.tsx` exports `{id, slot, order, Host}`;
 * `bun run features:generate` lists it in index.gen.ts.
 */
export type FeatureSlotProps = {
  /** Beside the launcher in AgentDialogs, whichever view is open. */
  dialogs: {
    world: WorldObject;
    /** Opens a launched terminal once World's snapshot shows it. */
    onOpen(terminal: {
      connectionId: string;
      runtimeGeneration: number;
      terminalId: string;
    }): void;
  };
};
export type FeatureSlot = keyof FeatureSlotProps;

export type WebFeature = {
  [S in FeatureSlot]: {
    id: string;
    slot: S;
    order: number;
    Host: ComponentType<FeatureSlotProps[S]>;
  };
}[FeatureSlot];

// Compile-time: every discovered module that declares a Host is a WebFeature.
type Declared = Extract<
  (typeof discovered)[keyof typeof discovered],
  { Host: unknown }
>;
const _declared: WebFeature[] = [] as Declared[];
void _declared;

/**
 * One slot's features, by order and then id. Modules without a Host (the
 * testing probe) are ignored; a duplicate id is refused.
 */
export function featuresIn<S extends FeatureSlot>(
  slot: S,
  modules: readonly object[] = Object.values(discovered),
) {
  const features = modules.filter(
    (module): module is WebFeature => "Host" in module,
  );
  const ids = new Set<string>();
  for (const { id } of features) {
    if (ids.has(id)) throw new Error(`Duplicate web feature: ${id}`);
    ids.add(id);
  }
  return features
    .filter(
      (feature): feature is Extract<WebFeature, { slot: S }> =>
        feature.slot === slot,
    )
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/** Renders every feature Host declared for `slot`. */
export function FeatureHosts<S extends FeatureSlot>({
  slot,
  ...props
}: { slot: S } & FeatureSlotProps[S]) {
  return featuresIn(slot).map(({ id, Host }) => {
    const SlotHost = Host as ComponentType<FeatureSlotProps[S]>;
    return <SlotHost key={id} {...(props as FeatureSlotProps[S])} />;
  });
}
