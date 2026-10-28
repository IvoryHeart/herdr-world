import { worldSessionStorage } from "./browserStorage";
import { requestReload } from "./buildFreshness";
import { type ComponentType, lazy, useEffect } from "react";

// After an update, the restarted server only embeds the new build's hashed
// chunks, so a lazy import from an older open tab 404s and would crash the root
// error boundary. Reloading fetches fresh assets but replaces open terminals,
// so the first failure per lazy component resolves to a placeholder that asks
// for a reload each time it mounts; if the import still fails after a reload,
// throw. Other components loading successfully must not reset its retry guard.
export async function importWithReload<T>(
  componentKey: string,
  factory: () => Promise<T>,
  placeholder: T,
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
    return placeholder;
  }
}

/** Stands in for a part that failed to load; reopening it asks again. */
function ReloadNeeded() {
  useEffect(() => requestReload(), []);
  return null;
}

export function lazyWithReload<C extends ComponentType<any>>(
  componentKey: string,
  factory: () => Promise<{ default: C }>,
) {
  return lazy(() =>
    importWithReload(componentKey, factory, {
      default: ReloadNeeded as unknown as C,
    }),
  );
}
