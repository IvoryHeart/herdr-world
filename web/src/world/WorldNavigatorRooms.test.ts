import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChrome } from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome)(
  "Spaces lists a TUI room and a herdr-core room with their tabs, runtime marks and Town's names, on desktop and phone",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-navigator-rooms-"));
    const { assets } = await buildWorldBrowserBundle(
      "WorldNavigatorRooms",
      dir,
    );
    const results = new Map([
      ["desktop", Promise.withResolvers<unknown>()],
      ["phone", Promise.withResolvers<unknown>()],
    ]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          const body = (await request.json()) as { mode?: string };
          results.get(String(body.mode))?.resolve(body);
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/WorldNavigatorRooms.browser.css"><script type="module" src="/WorldNavigatorRooms.browser.js"></script></head><body></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    try {
      for (const [mode, size] of [
        ["desktop", "1280,800"],
        ["phone", "390,844"],
      ] as const) {
        const browserLog = join(dir, `${mode}.log`);
        const browser = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            `--window-size=${size}`,
            `--user-data-dir=${join(dir, `profile-${mode}`)}`,
            `${server.url.href}?mode=${mode}`,
          ],
          { stdout: "ignore", stderr: Bun.file(browserLog) },
        );
        try {
          const observed = await Promise.race([
            results.get(mode)!.promise,
            browser.exited.then(async (code) => {
              throw new Error(
                `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
              );
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`${mode} rooms navigator timed out`)),
                20_000,
              ),
            ),
          ]);
          expect(observed).toMatchObject({ mode, failures: [] });
        } finally {
          await stopChrome(browser);
        }
      }
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
