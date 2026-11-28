import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ChromePage,
  chromeBinary as chrome,
  openChromePage,
} from "../web/src/testing/sharedChrome";

// The film runs the app's Town code (site/film/town-art.ts), so a change to
// Town's layout or sprites can break it while the site still builds.

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
    // The page's seek bar and clock are written for the film's length.
    const doc = frame.contentDocument, len = Math.floor(film.FILM.DUR / 60) + ":" + String(Math.floor(film.FILM.DUR % 60)).padStart(2, "0");
    if (Number(doc.getElementById("scrub").max) !== Math.round(film.FILM.DUR * 10)) failures.push("seek bar is not the film's length");
    if (!doc.getElementById("clock").textContent.includes(len)) failures.push("clock is not the film's length");
    // The video's captions track is written from this list.
    film.FILM.captions.forEach(([a, b, line], i, all) => {
      if (!(a < b && b <= film.FILM.DUR && (!i || a >= all[i - 1][0]))) failures.push("caption out of place: " + line);
    });
    for (let t = 0; t < film.FILM.DUR && failures.length < 5; t += 0.25) {
      try { film.FILM.renderFrame(t); } catch (error) { failures.push(t.toFixed(2) + "s: " + error.message); }
    }
  } catch (error) { failures.push(String(error && error.message || error)); }
  report(failures);
};
</script></body>`;

// Town's art, built once for both runs.
let townArt: Promise<{ success: boolean; text: string }> | undefined;
const buildTownArt = () =>
  (townArt ??= Bun.build({
    entrypoints: [join(film, "town-art.ts")],
    format: "iife",
    target: "browser",
  }).then(async (build) => ({
    success: build.success,
    text: build.success ? await build.outputs[0]!.text() : "",
  })));

// Each run has its own server and browser context, so both run side by side.
for (const [query, motion] of [
  ["render", "full motion"],
  ["embed&live", "reduced motion"],
] as const) {
  test.concurrent.skipIf(!chrome)(
    `the website film renders every frame with Town's art (?${query}, ${motion})`,
    async () => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      let page: ChromePage | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const built = await buildTownArt();
      expect(built.success).toBe(true);
      const art = built.text;
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
            return new Response(art, {
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
        // The old headless window's size; the film's frame is fixed in size.
        page = await openChromePage({
          viewport: { width: 800, height: 600 },
          reducedMotion: motion === "reduced motion",
        });
        await page.command("Page.navigate", { url: server.url.href });
        const failures = await Promise.race([
          promise,
          page.exited,
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
        await page?.close();
      }
    },
    75_000,
  );
}
