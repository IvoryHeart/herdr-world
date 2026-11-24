import type { ValidationSelection } from "./validation-scope";
import { VALIDATION_PROOF_PREFIX } from "./ci-validation-proof";
/** The single aggregate requires every selected Linux lane. */
export function assertDeliveryResults(
  mode: string | undefined,
  scope: string | undefined,
  validation: string | undefined,
  world: string | undefined,
  behavioral: string | undefined,
  selection?: ValidationSelection,
) {
  if (mode === "hold")
    throw new Error(
      "Delivery checks keep this head's red result: a title, description or label change retests nothing (see Validation scope)",
    );
  if (mode === "scoped" && !selection)
    throw new Error("Missing scoped selection");
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
    world !== expected[1]
  ) {
    throw new Error(
      `Delivery checks failed: mode=${mode}, scope=${scope}, validation=${validation}, world=${world}, behavioral=${behavioral}`,
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
