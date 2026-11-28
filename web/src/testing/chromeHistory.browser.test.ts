import { expect, test } from "bun:test";
import { BROWSER_STARTUP_TIMEOUT_MS } from "../browserChrome";
import { chromeBinary, openChromePage } from "../testing/sharedChrome";

// A case's page starts on about:blank. Whether the case navigates through
// `navigate()` or its own `Page.navigate` command, its first document replaces
// that entry, so Back from the app's first view never leaves the app.
test.skipIf(!chromeBinary).each(["navigate", "Page.navigate"] as const)(
  "a case's first document is its history's first entry (%s)",
  async (how) => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("<title>first</title>", {
          headers: { "Content-Type": "text/html" },
        }),
    });
    const page = await openChromePage();
    try {
      const url = `${server.url.href}first`;
      if (how === "navigate") await page.navigate(url);
      else {
        await page.command("Page.navigate", { url });
        await page.waitFor(`location.href === ${JSON.stringify(url)}`);
      }
      expect(await page.evaluate("history.length")).toBe(1);
      // A later navigation still adds an entry.
      await page.navigate(`${server.url.href}second`);
      expect(await page.evaluate("history.length")).toBe(2);
    } finally {
      await page.close();
      server.stop(true);
    }
  },
  BROWSER_STARTUP_TIMEOUT_MS + 30_000,
);
