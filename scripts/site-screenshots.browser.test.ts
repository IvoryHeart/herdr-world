import { test } from "bun:test";
import { runSiteScreenshots } from "./site-screenshots";

// Release tooling only: ordinary gates skip it (docs/SCREENSHOTS.md).
test.skipIf(process.env.SITE_SCREENSHOTS !== "1")(
  "the website's Town screenshots capture the synthetic scene",
  async () => {
    if (!process.env.CHROME_BIN) throw new Error("CHROME_BIN must name Chrome");
    const report = await runSiteScreenshots({
      chrome: process.env.CHROME_BIN,
      directory: process.env.SITE_SCREENSHOTS_OUTPUT ?? "docs/images",
      socialDirectory: process.env.SITE_SOCIAL_OUTPUT ?? "site",
      gpu: process.env.HERDR_WORLD_TEST_GPU === "1",
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  },
  10 * 60_000,
);
