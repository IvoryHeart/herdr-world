import { test } from "bun:test";
import { runTownVisualControl } from "./town-golden-negative-control";

test.skipIf(process.env.TOWN_GOLDEN_NEGATIVE_CONTROL !== "1")(
  "a production visual mutant fails and the restored Town matches",
  () =>
    runTownVisualControl(
      process.env.TOWN_GOLDEN_CONTROL_OUTPUT ?? ".agents/town-golden-control",
    ),
  15 * 60_000,
);
