import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { SurfaceDefinition, SurfaceRegistry } from "./surfaceRegistry";
import {
  worldThemeRegistry as defaultWorldThemeRegistry,
} from "./world/worldThemeRegistry";
import type {
  WorldThemeDefinition,
  WorldThemeId,
  WorldThemeRegistry,
} from "./world/worldThemeRegistry";

type CoreNavigationValue = {
  activeSurface: SurfaceDefinition;
  activeWorldTheme: WorldThemeDefinition;
  navigate: (surfaceId: string, historyState?: unknown) => void;
  navigateWorldTheme: (themeId: string, historyState?: unknown) => void;
};

const HISTORY_THEME_KEY = "__herdrWorldTheme";

export type CoreRouteResolution = {
  surfaceId: string;
  worldThemeId: WorldThemeId;
  canonicalUrl: string;
  needsReplace: boolean;
};

const CoreNavigationContext = createContext<CoreNavigationValue | null>(null);

export function CoreNavigationProvider({
  registry,
  themeRegistry = defaultWorldThemeRegistry,
  children,
}: {
  registry: SurfaceRegistry;
  themeRegistry?: WorldThemeRegistry;
  children: ReactNode;
}) {
  const defaultSurface = registry.get("world") ?? registry.list()[0];
  if (!defaultSurface) {
    throw new Error("Core navigation requires at least one registered surface");
  }
  const defaultTheme = themeRegistry.get("office");
  if (!defaultTheme) {
    throw new Error("Core navigation requires the Office World theme");
  }
  const [navigation, setNavigation] = useState(() => {
    const resolution = resolveCoreRoute(
      registry,
      themeRegistry,
      globalThis.location?.pathname ?? "/",
      globalThis.location?.search ?? "",
    );
    return {
      activeId: resolution.surfaceId,
      worldThemeId: resolution.surfaceId === "spaces"
        ? historyThemeId(globalThis.history?.state, themeRegistry) ?? resolution.worldThemeId
        : resolution.worldThemeId,
      resolution,
    };
  });

  useLayoutEffect(() => {
    const state = withHistoryTheme(window.history.state, navigation.worldThemeId);
    if (navigation.resolution.needsReplace) {
      window.history.replaceState(state, "", navigation.resolution.canonicalUrl);
    } else if (historyThemeId(window.history.state, themeRegistry) !== navigation.worldThemeId) {
      window.history.replaceState(state, "", window.location.href);
    }
  }, [navigation.resolution, navigation.worldThemeId, themeRegistry]);

  useEffect(() => {
    const onPopState = () => {
      const resolution = resolveCoreRoute(
        registry,
        themeRegistry,
        window.location.pathname,
        window.location.search,
      );
      const stateTheme = historyThemeId(window.history.state, themeRegistry);
      const worldThemeId = resolution.surfaceId === "spaces" && stateTheme
        ? stateTheme
        : resolution.worldThemeId;
      if (resolution.needsReplace) {
        window.history.replaceState(
          withHistoryTheme(window.history.state, worldThemeId),
          "",
          resolution.canonicalUrl,
        );
      }
      setNavigation({
        activeId: resolution.surfaceId,
        worldThemeId,
        resolution: resolution.needsReplace
          ? { ...resolution, needsReplace: false }
          : resolution,
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [registry, themeRegistry]);

  const activeSurface = registry.get(navigation.activeId) ?? defaultSurface;
  const activeWorldTheme = themeRegistry.get(navigation.worldThemeId) ?? defaultTheme;
  const value = useMemo<CoreNavigationValue>(
    () => ({
      activeSurface,
      activeWorldTheme,
      navigate: (surfaceId, historyState = window.history.state) => {
        const next = registry.get(surfaceId);
        if (!next || next.id === activeSurface.id) {
          return;
        }
        const destination = next.id === "world"
          ? worldThemeUrl(activeWorldTheme.id)
          : next.route;
        window.history.pushState(
          withHistoryTheme(historyState, activeWorldTheme.id),
          "",
          destination,
        );
        const destinationUrl = new URL(destination, window.location.origin);
        const resolution = resolveCoreRoute(
          registry,
          themeRegistry,
          destinationUrl.pathname,
          destinationUrl.search,
        );
        setNavigation({
          activeId: next.id,
          worldThemeId: activeWorldTheme.id,
          resolution: { ...resolution, needsReplace: false },
        });
      },
      navigateWorldTheme: (themeId, historyState = window.history.state) => {
        const next = themeRegistry.get(themeId);
        if (!next || (activeSurface.id === "world" && next.id === activeWorldTheme.id)) {
          return;
        }
        const destination = worldThemeUrl(next.id);
        window.history.pushState(withHistoryTheme(historyState, next.id), "", destination);
        const resolution = resolveCoreRoute(registry, themeRegistry, "/", destination.slice(1));
        setNavigation({
          activeId: "world",
          worldThemeId: next.id,
          resolution: { ...resolution, needsReplace: false },
        });
      },
    }),
    [activeSurface, activeWorldTheme, registry, themeRegistry],
  );

  return <CoreNavigationContext.Provider value={value}>{children}</CoreNavigationContext.Provider>;
}

export function resolveCoreRoute(
  registry: SurfaceRegistry,
  themeRegistry: WorldThemeRegistry,
  pathname: string,
  search: string,
): CoreRouteResolution {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  if (normalizedPath === "/spaces") {
    return routeResolution("spaces", "office", "/spaces", pathname, search);
  }
  if (normalizedPath !== "/" && normalizedPath !== "/world") {
    return routeResolution("world", "office", "/", pathname, search);
  }

  const params = new URLSearchParams(search);
  const themeValues = params.getAll("theme");
  const requestedTheme = themeValues.length === 1 ? themeRegistry.get(themeValues[0] ?? "") : null;
  const theme = requestedTheme ?? themeRegistry.get("office");
  const themeId = theme?.id ?? "office";
  return routeResolution(
    registry.get("world")?.id ?? "world",
    themeId,
    worldThemeUrl(themeId),
    pathname,
    search,
  );
}

export function worldThemeUrl(themeId: WorldThemeId) {
  return themeId === "office" ? "/" : `/?theme=${encodeURIComponent(themeId)}`;
}

function routeResolution(
  surfaceId: string,
  worldThemeId: WorldThemeId,
  canonicalUrl: string,
  pathname: string,
  search: string,
): CoreRouteResolution {
  return {
    surfaceId,
    worldThemeId,
    canonicalUrl,
    needsReplace: `${pathname}${search}` !== canonicalUrl,
  };
}

function historyThemeId(value: unknown, registry: WorldThemeRegistry) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const themeId = (value as Record<string, unknown>)[HISTORY_THEME_KEY];
  return typeof themeId === "string" && registry.get(themeId)?.id === themeId
    ? themeId as WorldThemeId
    : null;
}

function withHistoryTheme(value: unknown, themeId: WorldThemeId) {
  return {
    ...(typeof value === "object" && value !== null ? value : {}),
    [HISTORY_THEME_KEY]: themeId,
  };
}

export function CoreSurfaceOutlet({ registry }: { registry: SurfaceRegistry }) {
  const { activeSurface } = useCoreNavigation();
  const Surface = registry.component(activeSurface.id);
  if (!Surface) {
    return <div role="alert">Surface unavailable</div>;
  }
  return (
    <Suspense fallback={<div role="status">Loading {activeSurface.label}…</div>}>
      <Surface />
    </Suspense>
  );
}

export function useCoreNavigation() {
  const value = useContext(CoreNavigationContext);
  if (!value) {
    throw new Error("useCoreNavigation must be used inside CoreNavigationProvider");
  }
  return value;
}
