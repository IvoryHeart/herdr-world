import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChrome } from "../web/src/browserChrome";

// The film runs the app's Town code (site/film/town-art.ts), so a change to
// Town's layout or sprites can break it while the site still builds.
const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

const film = join(import.meta.dir, "../site/film");

// Renders every frame inside a frame of the film page and reports failures.
const harness = (
  query: string,
) => `<!doctype html><body><iframe id="f" src="/film/?${query}" width="1920" height="1080"></iframe><script>
const report = (failures) => fetch("/result", { method: "POST", body: JSON.stringify(failures) });
const frame = document.getElementById("f");
frame.onload = async () => {
  const film = frame.contentWindow, failures = [];
  film.addEventListener("error", (event) => failures.push(String(event.message)));
  try {
    await film.FILM.ready;
    if (!film.HerdrTownArt) failures.push("town-art.js did not load");
    for (let t = 0; t < film.FILM.DUR && failures.length < 5; t += 0.25) {
      try { film.FILM.renderFrame(t); } catch (error) { failures.push(t.toFixed(2) + "s: " + error.message); }
    }
  } catch (error) { failures.push(String(error && error.message || error)); }
  report(failures);
};
</script></body>`;

for (const [query, motion] of [
  ["render", "full motion"],
  ["embed", "reduced motion"],
] as const) {
  test.skipIf(!chrome)(
    `the website film renders every frame with Town's art (?${query}, ${motion})`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "pages-film-test-"));
      const { promise, resolve } = Promise.withResolvers<unknown>();
      let child: ReturnType<typeof Bun.spawn> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const build = await Bun.build({
        entrypoints: [join(film, "town-art.ts")],
        format: "iife",
        target: "browser",
      });
      expect(build.success).toBe(true);
      const townArt = await build.outputs[0]!.text();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result" && request.method === "POST") {
            resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/")
            return new Response(harness(query), {
              headers: { "Content-Type": "text/html" },
            });
          if (path === "/film/town-art.js")
            return new Response(townArt, {
              headers: { "Content-Type": "text/javascript" },
            });
          if (path === "/film/")
            return new Response(Bun.file(join(film, "index.html")));
          if (/^\/film\/fonts\/[\w.-]+$/.test(path))
            return new Response(Bun.file(join(film, path.slice(6))));
          return new Response("Not found", { status: 404 });
        },
      });
      try {
        const errorOutput = join(dir, "browser.log");
        child = Bun.spawn(
          [
            chrome!,
            "--headless",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--mute-audio",
            ...(motion === "reduced motion"
              ? ["--force-prefers-reduced-motion"]
              : []),
            `--user-data-dir=${join(dir, "profile")}`,
            server.url.href,
          ],
          { stdout: "ignore", stderr: Bun.file(errorOutput) },
        );
        const failures = await Promise.race([
          promise,
          child.exited.then(async (code) => {
            throw new Error(
              `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
            );
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Film render check timed out")),
              60_000,
            );
          }),
        ]);
        expect(failures).toEqual([]);
      } finally {
        clearTimeout(timer);
        server.stop(true);
        await stopChrome(child);
        await rm(dir, { recursive: true, force: true });
      }
    },
    75_000,
  );
}
