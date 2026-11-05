import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChrome, waitForBrowserFixture } from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

// Claude's recorded questions, an unknown prompt and the folder-trust
// question, in Chat and Needs you, with synthetic data only.
for (const width of [1280, 390])
  test.skipIf(!chrome)(
    `Chat and Needs you show Claude's questions and trust choices (${width}px)`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "question-cards-"));
      const { assets } = await buildWorldBrowserBundle("QuestionCards", dir);
      const result = Promise.withResolvers<string[]>(),
        requested = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result") {
            result.resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/") requested.resolve();
          const asset =
            path === "/"
              ? Bun.file(join(dir, "QuestionCards/index.html"))
              : assets.get(path);
          return asset
            ? new Response(asset)
            : new Response("Not found", { status: 404 });
        },
      });
      let child: ReturnType<typeof Bun.spawn> | undefined;
      try {
        const log = join(dir, "chrome.log");
        child = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            "--disable-gpu",
            `--window-size=${width},900`,
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${join(dir, "profile")}`,
            server.url.href,
          ],
          { stdout: "ignore", stderr: Bun.file(log) },
        );
        expect(
          await waitForBrowserFixture(
            requested.promise,
            result.promise,
            child.exited.then(async (code) => {
              throw new Error(
                `Chrome exited ${code}: ${await Bun.file(log).text()}`,
              );
            }),
            "Question cards",
            15000,
          ),
        ).toEqual([]);
      } finally {
        await stopChrome(child);
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
