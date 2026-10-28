import { worldSessionStorage } from "./browserStorage";
import { requestReload } from "./buildFreshness";
import { type ComponentType, lazy, useEffect } from "react";

// After an update, the restarted server only embeds the new build's hashed
// chunks, so a lazy import from an older open tab 404s and would crash the root
// error boundary. Reloading fetches fresh assets but replaces open terminals,
// so the first failure per lazy component resolves to a placeholder that asks
// for a reload and closes itself each time it opens; if the import still fails
// after a reload, throw. Other components loading successfully must not reset
// its retry guard.
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

/**
 * Stands in for a part that failed to load and asks for a reload on mount.
 * Dialogs and panels stay open until their own onClose, so it closes itself:
 * the next open mounts it again and asks again.
 */
function ReloadNeeded({ onClose }: { onClose?: unknown }) {
  useEffect(() => {
    requestReload();
    if (typeof onClose === "function") onClose();
    // Once per mount: a parent re-render must not close it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
