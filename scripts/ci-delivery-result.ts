/**
 * Native results include Windows plugin installation, installer upgrades and
 * both macOS lifecycle jobs. The macOS jobs keep their protected names and
 * skip native steps on shorter paths, so their aggregate must still succeed.
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
    packaging.length !== 3 ||
    packaging
      .slice(0, 2)
      .some((result) => result !== (mode === "full" ? "success" : "skipped")) ||
    packaging[2] !== "success"
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
    [
      Bun.env.WINDOWS_PLUGIN_RESULT,
      Bun.env.INSTALLER_RESULT,
      Bun.env.LAUNCHD_RESULT,
    ],
  );
  console.info("Delivery checks passed");
}
