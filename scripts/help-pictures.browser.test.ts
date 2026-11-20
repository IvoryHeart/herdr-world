import { test } from "bun:test";
import { runHelpPictures } from "./help-pictures";

// Picture tooling, run through the browser queue by `bun run help:pictures`;
// ordinary gates skip it and `bun run help:check` tells when it is due.
test.skipIf(process.env.HELP_PICTURES !== "1")(
  "help pictures capture each entry's control from the synthetic stage",
  async () => {
    if (!process.env.CHROME_BIN) throw new Error("CHROME_BIN must name Chrome");
    const ids = (process.env.HELP_PICTURES_IDS ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);
    const report = await runHelpPictures({
      chrome: process.env.CHROME_BIN,
      ids,
      gpu: process.env.HERDR_WORLD_TEST_GPU === "1",
    });
    process.stdout.write(`help pictures: ${report.written.length} written\n`);
  },
  15 * 60_000,
);
