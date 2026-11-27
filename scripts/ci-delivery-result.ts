import type { ValidationSelection } from "./validation-scope";
import { VALIDATION_PROOF_PREFIX } from "./ci-validation-proof";
/** @internal */
export type DeliveryResults = Record<
  | "scope"
  | "description"
  | "security"
  | "static"
  | "unit"
  | "world"
  | "web"
  | "behavioral",
  string | undefined
>;

/** The protected aggregate requires each selected leaf, including skipped lanes. */
export function assertDeliveryResults(
  mode: string | undefined,
  results: DeliveryResults,
  selection?: ValidationSelection,
  event = "pull_request",
) {
  if (mode === "hold")
    throw new Error(
      "Delivery checks keep this head's red result: a title, description or label change retests nothing (see Validation scope)",
    );
  if (mode === "scoped" && !selection)
    throw new Error("Missing scoped selection");
  if (!["full", "docs", "tooling", "scoped", "reuse"].includes(mode || ""))
    throw new Error(`Unknown validation mode: ${mode}`);
  const selected = (lane: "world" | "web" | "verification") =>
    mode === "full" ||
    (mode === "scoped" &&
      !!(lane === "verification"
        ? selection!.verification
        : selection![lane].length));
  const expected: DeliveryResults = {
    scope: "success",
    description: event === "pull_request" ? "success" : "skipped",
    security: mode === "reuse" ? "skipped" : "success",
    static: mode === "reuse" ? "skipped" : "success",
    unit: mode === "reuse" || mode === "docs" ? "skipped" : "success",
    world: selected("world") ? "success" : "skipped",
    web: selected("web") ? "success" : "skipped",
    behavioral: selected("verification") ? "success" : "skipped",
  };
  for (const lane of Object.keys(expected) as Array<keyof DeliveryResults>)
    if (results[lane] !== expected[lane])
      throw new Error(
        `Delivery checks failed: mode=${mode}, ${lane}=${results[lane]}, expected=${expected[lane]}`,
      );
}

if (import.meta.main) {
  assertDeliveryResults(
    Bun.env.VALIDATION_MODE,
    {
      scope: Bun.env.SCOPE_RESULT,
      description: Bun.env.DESCRIPTION_RESULT,
      security: Bun.env.SECURITY_RESULT,
      static: Bun.env.STATIC_RESULT,
      unit: Bun.env.UNIT_RESULT,
      world: Bun.env.WORLD_RESULT,
      web: Bun.env.WEB_RESULT,
      behavioral: Bun.env.BEHAVIORAL_RESULT,
    },
    Bun.env.HERDR_CI_SELECTION
      ? (JSON.parse(Bun.env.HERDR_CI_SELECTION) as ValidationSelection)
      : undefined,
    Bun.env.GITHUB_EVENT_NAME,
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
