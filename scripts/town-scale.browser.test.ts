import { test } from "bun:test";
import { runTownScale } from "./town-scale";

// Report tooling only: ordinary gates skip it (docs/design/town-at-scale.md).
test.skipIf(process.env.TOWN_SCALE !== "1")(
  "Town scale scene captures and pan frame times",
  async () => {
    if (!process.env.CHROME_BIN) throw new Error("CHROME_BIN must name Chrome");
    await runTownScale({
      chrome: process.env.CHROME_BIN,
      directory: process.env.TOWN_SCALE_OUTPUT ?? ".agents/town-scale",
      gpu: process.env.HERDR_WORLD_TEST_GPU === "1",
      steps: process.env.TOWN_SCALE_STEPS !== "off",
    });
  },
  10 * 60_000,
);
