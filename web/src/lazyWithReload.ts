import { worldSessionStorage } from "./browserStorage";
import { requestReload } from "./buildFreshness";
import { type ComponentType, lazy } from "react";

// After an update, the restarted server only embeds the new build's hashed
// chunks, so a lazy import from an older open tab 404s and would crash the root
// error boundary. Reloading fetches fresh assets but replaces open terminals,
// so offer it once per lazy component and keep the boundary suspended; if the
// import still fails after a reload, throw. Other components loading
// successfully must not reset its retry guard.
export async function importWithReload<T>(
  componentKey: string,
  factory: () => Promise<T>,
): Promise<T> {
  const reloadKey = `herdr:lazy-chunk-reload:${componentKey}`;
  try {
    const module = await factory();
    worldSessionStorage.removeItem(reloadKey);
    return module;
  } catch (error) {
    if (worldSessionStorage.getItem(reloadKey)) throw error;
    worldSessionStorage.setItem(reloadKey, "1");
    requestReload();
    // Keep the lazy boundary suspended until the operator reloads.
    return new Promise<T>(() => {});
  }
}

export function lazyWithReload<C extends ComponentType<any>>(
  componentKey: string,
  factory: () => Promise<{ default: C }>,
) {
  return lazy(() => importWithReload(componentKey, factory));
}
