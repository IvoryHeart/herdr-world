export function assertDeliveryResults(
  mode: string | undefined,
  scope: string | undefined,
  validation: string | undefined,
  world: string | undefined,
) {
  const expected =
    mode === "full"
      ? ["success", "success"]
      : mode === "docs"
        ? ["success", "skipped"]
        : mode === "reuse"
          ? ["skipped", "skipped"]
          : undefined;
  if (
    scope !== "success" ||
    !expected ||
    validation !== expected[0] ||
    world !== expected[1]
  ) {
    throw new Error(
      `Delivery checks failed: mode=${mode}, scope=${scope}, validation=${validation}, world=${world}`,
    );
  }
}

if (import.meta.main) {
  assertDeliveryResults(
    Bun.env.VALIDATION_MODE,
    Bun.env.SCOPE_RESULT,
    Bun.env.VALIDATION_RESULT,
    Bun.env.WORLD_RESULT,
  );
  console.info("Delivery checks passed");
}
