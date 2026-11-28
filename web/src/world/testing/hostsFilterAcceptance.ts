import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../../testing/sharedChrome";
import {
  hostFilterCases,
  hostFilterGroup,
  type HostFilterGroup,
} from "./browserCases";
import { casePhases } from "./casePhases";
import { worldBrowserBundle } from "./worldBrowserBundle";

/** A hang guard for one case's page, not a speed budget. */
const FIXTURE_MS = 45_000;
export function registerHostsFilterTests(group: HostFilterGroup) {
  // Software GL competes for the same runner CPUs as the test clock. Two
  // 1440px Towns rendering together caused the unrelated-branch timeouts.
  // Keep every viewport/assertion and the original guard; admit one Town at
  // a time while ordinary DOM cases retain bounded concurrency.
  for (const serial of [false, true]) {
    const register = serial
      ? test.skipIf(!chrome)
      : test.skipIf(!chrome).concurrent;
    register.each(
      hostFilterCases.filter(
        (item) =>
          hostFilterGroup(item) === group &&
          item.operation.startsWith("town-") === serial,
      ),
    )(
      group === "resources"
        ? "rendering, focus and browser file input: qualified resource targets %j"
        : group === "actions"
          ? "rendering and focus: qualified Actions and watch feedback %j"
          : group === "visibility"
            ? "geometry, rendering, focus and terminal lifecycle: Hosts scope %j"
            : "the shell preserves qualified operational targets: %j",
      async ({ width, height = 1000, operation, view }) => {
        const phases = casePhases(
          `HostsFilter ${operation} ${view} ${width}x${height}`,
        );
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
        let page: ChromePage | undefined;
        try {
          phases.mark("setup");
          void pageRequested.promise.then(() => phases.mark("load"));
          page = await openChromePage({ viewport: { width, height } });
          void page
            .navigate(`${server.url.href}?operation=${operation}&view=${view}`)
            .catch(() => {});
          const observed = await waitForBrowserFixture(
            pageRequested.promise,
            result.promise,
            page.exited,
            "Hosts filter browser acceptance",
            FIXTURE_MS,
          );
          phases.mark("scene");
          if (Array.isArray(observed) && observed.length)
            console.info(
              "Hosts filter failures",
              JSON.stringify(observed).slice(0, 1800),
            );
          expect(observed).toEqual([]);
        } finally {
          await page?.close();
          server.stop(true);
          await rm(dir, { recursive: true, force: true });
          phases.done();
        }
      },
      FIXTURE_MS + 15_000 + BROWSER_STARTUP_TIMEOUT_MS,
    );
  }
}
