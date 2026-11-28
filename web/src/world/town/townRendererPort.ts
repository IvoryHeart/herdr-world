import { createTownRenderer as createPixiRenderer } from "./townRenderer";
let factory: typeof createPixiRenderer | undefined;

/** @internal Behaviour fixtures replace rendering, never World/scene state. */
export function injectTownRenderer(replacement: typeof createPixiRenderer) {
  const previous = factory;
  factory = replacement;
  return () => {
    factory = previous;
  };
}

/** TownCanvas's renderer port; native rendering remains the default. */
export function createTownRenderer(
  ...args: Parameters<typeof createPixiRenderer>
) {
  // The existing failure/recovery control still exercises the native refusal.
  const selected = window.__HERDR_WORLD_FORCE_RENDERER_FAILURE__
    ? createPixiRenderer
    : (factory ?? createPixiRenderer);
  return selected(...args);
}
