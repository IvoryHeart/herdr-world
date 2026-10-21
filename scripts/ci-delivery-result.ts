/**
 * `packaging` holds the Windows plugin and installer upgrade results. They run
 * for full validation only: Markdown and exact-head reuse cannot change what
 * they install.
 */
export function assertDeliveryResults(
  mode: string | undefined,
  scope: string | undefined,
  validation: string | undefined,
  world: string | undefined,
  behavioral: string | undefined,
  packaging: Array<string | undefined>,
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
    behavioral !== (mode === "reuse" ? "skipped" : "success") ||
    validation !== expected[0] ||
    world !== expected[1] ||
    packaging.length !== 2 ||
    packaging.some(
      (result) => result !== (mode === "full" ? "success" : "skipped"),
    )
  ) {
    throw new Error(
      `Delivery checks failed: mode=${mode}, scope=${scope}, validation=${validation}, world=${world}, behavioral=${behavioral}, packaging=${packaging.join(",")}`,
    );
  }
}

if (import.meta.main) {
  assertDeliveryResults(
    Bun.env.VALIDATION_MODE,
    Bun.env.SCOPE_RESULT,
    Bun.env.VALIDATION_RESULT,
    Bun.env.WORLD_RESULT,
    Bun.env.BEHAVIORAL_RESULT,
    [Bun.env.WINDOWS_PLUGIN_RESULT, Bun.env.INSTALLER_RESULT],
  );
  console.info("Delivery checks passed");
}
