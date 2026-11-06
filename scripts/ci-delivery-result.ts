import type { ValidationSelection } from "./validation-scope";
import { VALIDATION_PROOF_PREFIX } from "./ci-validation-proof";
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
  selection?: ValidationSelection,
) {
  if (mode === "scoped" && !selection)
    throw new Error("Missing scoped selection");
  const native = mode === "full" || (mode === "scoped" && selection!.packaging);
  const browser =
    mode === "full" ||
    (mode === "scoped" && !!(selection!.world.length + selection!.web.length));
  const verify =
    mode === "full" || (mode === "scoped" && selection!.verification);
  const known = ["full", "docs", "tooling", "scoped", "reuse"].includes(
    mode || "",
  );
  const expected = [
    mode === "reuse" ? "skipped" : "success",
    browser ? "success" : "skipped",
  ];
  if (
    scope !== "success" ||
    !known ||
    behavioral !== (verify ? "success" : "skipped") ||
    validation !== expected[0] ||
    world !== expected[1] ||
    packaging.length !== 3 ||
    packaging
      .slice(0, 2)
      .some((result) => result !== (native ? "success" : "skipped")) ||
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
    Bun.env.HERDR_CI_SELECTION
      ? (JSON.parse(Bun.env.HERDR_CI_SELECTION) as ValidationSelection)
      : undefined,
  );
  console.info("Delivery checks passed");
  if (Bun.env.HERDR_CI_SELECTION)
    console.info(
      VALIDATION_PROOF_PREFIX +
        JSON.stringify({
          mode: Bun.env.VALIDATION_MODE,
          selection: JSON.parse(Bun.env.HERDR_CI_SELECTION),
        }),
    );
}
