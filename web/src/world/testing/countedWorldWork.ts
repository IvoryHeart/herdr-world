/**
 * The World work (countWorldWork in devtools/renderer.ts) that `run` does,
 * by kind, for unit tests: the counters are on only while it runs.
 */
export async function countedWorldWork(
  run: () => unknown,
): Promise<Record<string, number>> {
  const previous = globalThis.window;
  globalThis.window = {
    __HERDR_WORLD_RENDERER_DEBUG__: "counters",
    location: { search: "" },
  } as unknown as typeof globalThis.window;
  try {
    await run();
    return { ...window.__HERDR_WORLD_WORK__ };
  } finally {
    globalThis.window = previous;
  }
}
