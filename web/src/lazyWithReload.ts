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
 * Stands in for a part that failed to load and asks for a reload when shown.
 * Dialogs and panels stay open until their own onClose, so it closes itself:
 * the next open either mounts it again or, for a panel kept mounted such as
 * Ranger, turns its open prop back on, and either way it asks again.
 */
function ReloadNeeded({
  open,
  onClose,
}: {
  open?: unknown;
  onClose?: unknown;
}) {
  useEffect(() => {
    if (open === false) return;
    requestReload();
    if (typeof onClose === "function") onClose();
    // Once per showing: a parent re-render must not close it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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
