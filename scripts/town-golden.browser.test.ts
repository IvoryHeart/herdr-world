import { test } from "bun:test";
import { runTownGolden } from "./town-golden";

// Report only: ordinary unit/browser gates never acquire a visual dependency.
test.skipIf(process.env.TOWN_GOLDEN !== "1")(
  "Town matches the stored golden images",
  async () => {
    if (!process.env.CHROME_BIN)
      throw new Error("CHROME_BIN must name the pinned test Chrome");
    await runTownGolden({
      chrome: process.env.CHROME_BIN,
      directory: process.env.TOWN_GOLDEN_OUTPUT ?? ".agents/town-golden",
      runs: Number(process.env.TOWN_GOLDEN_RUNS ?? 1),
      update: process.env.TOWN_GOLDEN_UPDATE === "1",
    });
  },
  30 * 60_000,
);
