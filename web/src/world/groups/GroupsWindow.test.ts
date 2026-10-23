// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
} from "../../browserChrome";
import { groupsBrowserServer } from "./testing/groupsBrowserServer";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome).each([1440, 390])(
  "Groups panel uses current membership and refuses stale role confirmation at %ipx",
  async (width: number) => {
    const directory = await mkdtemp(join(tmpdir(), "groups-browser-"));
    const fixture = await groupsBrowserServer(directory);
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const log = join(directory, "browser.log");
    try {
      child = Bun.spawn(
        [
          chrome!,
          "--headless",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          `--window-size=${width},900`,
          `--user-data-dir=${join(directory, "profile")}`,
          fixture.server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      const failures = await waitForBrowserFixture(
        fixture.requested,
        fixture.result,
        child.exited.then(async (code) => {
          throw new Error(
            `Chrome exited ${code}: ${(await readFile(log, "utf8")).slice(-2000)}`,
          );
        }),
        "Groups panel",
        20_000,
      );
      expect(failures).toEqual([]);
    } finally {
      fixture.server.stop(true);
      await stopChrome(child);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
