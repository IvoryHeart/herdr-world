import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

import {
  hostFilterCases,
  hostFilterGroup,
  type HostFilterGroup,
} from "./browserCases";
import { worldBrowserBundle } from "./worldBrowserBundle";

/** A hang guard for one case's page, not a speed budget. */
const FIXTURE_MS = 45_000;
/**
 * The Town frame cases (town-idle, town-idle-draws, town-walk-anchor) step
 * a 1440 px Town frame by frame in software GL, so they take the runner's
 * pixel speed: 30 s on the fastest CI runners and 45 s and more on slower
 * ones (the renderer-only town-idle-draws went from 24 s to 45 s), with the
 * same code. Their guard leaves room for that spread, as Town's own browser
 * checks do (TownCanvas.ts).
 */
const TOWN_FRAMES_FIXTURE_MS = 90_000;
const fixtureMs = (operation: string) =>
  operation.startsWith("town-") ? TOWN_FRAMES_FIXTURE_MS : FIXTURE_MS;

export function registerHostsFilterTests(group: HostFilterGroup) {
  test
    .skipIf(!chrome)
    .concurrent.each(
      hostFilterCases.filter((item) => hostFilterGroup(item) === group),
    )(
    group === "resources"
      ? "rendering, focus and browser file input: qualified resource targets %j"
      : group === "actions"
        ? "rendering and focus: qualified Actions and watch feedback %j"
        : group === "visibility"
          ? "geometry, rendering, focus and terminal lifecycle: Hosts scope %j"
          : "the shell preserves qualified operational targets: %j",
    async ({ width, height = 1000, operation, view }) => {
      const dir = await mkdtemp(join(tmpdir(), "world-hosts-filter-"));
      const { assets } = await worldBrowserBundle("HostsFilter");
      const result = Promise.withResolvers<unknown>();
      const pageRequested = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/") pageRequested.resolve();
          if (path === "/result") {
            result.resolve(await request.json());
            return new Response("ok");
          }
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          return new Response(
            '<head><link rel="stylesheet" href="/HostsFilter.browser.css"></head><body><script type="module" src="/HostsFilter.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        },
      });
      let browser: ReturnType<typeof Bun.spawn> | undefined;
      try {
        browser = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            `--window-size=${width},${height}`,
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${join(dir, "profile")}`,
            `${server.url.href}?operation=${operation}&view=${view}`,
          ],
          { stdout: "ignore", stderr: Bun.file(join(dir, "browser.log")) },
        );
        const observed = await waitForBrowserFixture(
          pageRequested.promise,
          result.promise,
          browser.exited.then((code) => {
            throw new Error(`Browser exited ${code}`);
          }),
          "Hosts filter browser acceptance",
          fixtureMs(operation),
        );
        if (Array.isArray(observed) && observed.length)
          console.info(
            "Hosts filter failures",
            JSON.stringify(observed).slice(0, 1800),
          );
        expect(observed).toEqual([]);
      } finally {
        browser?.kill();
        if (browser) await browser.exited;
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    TOWN_FRAMES_FIXTURE_MS + 15_000 + BROWSER_STARTUP_TIMEOUT_MS,
  );
}
