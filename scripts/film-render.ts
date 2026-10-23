/**
 * Render the website film to video files.
 *
 * The film is drawn live on a canvas (site/film/index.html) with the app's
 * own Town code. This script plays it frame by frame in headless Chrome at a
 * fixed rate, renders its Web Audio score offline, and encodes:
 *
 *   herdr-world-film.webm  VP9 + Opus (first choice)
 *   herdr-world-film.mp4   H.264 + AAC (fallback, Safari and older phones)
 *   herdr-world-film.vtt   WebVTT captions from the film's own caption list
 *
 * The output is generated, so it is not committed: the Pages workflow renders
 * it into the site after `bun run build:site`. Requires Chrome/Chromium (or
 * CHROME_BIN) and ffmpeg with libvpx-vp9, libopus and libx264.
 *
 *   bun run film:render [--out <dir>] [--fps <n>] [--update-poster] [--keep <dir>]
 *
 * --keep keeps the lossless capture in <dir> and reuses it when present, so
 * encoder settings can be tuned without capturing again.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stopChrome } from "../web/src/browserChrome";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const film = join(root, "site/film");
const poster = join(root, "site/assets/herdr-world-film-poster.jpg");
const POSTER_AT = 20.1;

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(root, ".pages-dist/film/media") },
    fps: { type: "string", default: "24" },
    "update-poster": { type: "boolean", default: false },
    keep: { type: "string" },
  },
});
const fps = Number(values.fps);
if (!Number.isInteger(fps) || fps < 1 || fps > 60)
  throw new Error("--fps must be a whole number from 1 to 60");
const out = values.out!;

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));
if (!chrome) throw new Error("film:render needs Chrome/Chromium or CHROME_BIN");
if (!Bun.which("ffmpeg")) throw new Error("film:render needs ffmpeg");

async function ffmpeg(args: string[]) {
  const child = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0)
    throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

// The harness plays the film in a frame and posts each canvas frame back.
const harness = `<!doctype html><body style="margin:0"><iframe id="f" src="/film/?render&live" width="1920" height="1080" style="border:0"></iframe><script>
const post = (path, body) => fetch(path, { method: "POST", body });
const frame = document.getElementById("f");
frame.onload = async () => {
  try {
    const film = frame.contentWindow.FILM;
    await film.ready;
    const canvas = frame.contentDocument.getElementById("film");
    const total = Math.round(film.DUR * ${fps});
    for (let i = 0; i < total; i++) {
      film.renderFrame(i / ${fps});
      const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const sent = await post("/frame", png);
      if (!sent.ok) throw new Error("frame " + i + " was refused");
    }
    await post("/captions", JSON.stringify(film.captions));
    await post("/audio", await film.renderWav());
    await post("/done", "");
  } catch (error) {
    await post("/fail", String((error && error.stack) || error));
  }
};
</script></body>`;

const work = await mkdtemp(join(tmpdir(), "film-render-"));
const kept = values.keep;
if (kept) await mkdir(kept, { recursive: true });
const frames = join(kept ?? work, "frames.mkv");
const audio = join(kept ?? work, "audio.wav");
const captionFile = join(kept ?? work, "captions.json");
let browser: ReturnType<typeof Bun.spawn> | undefined;
const began = performance.now();

/** Play the film in Chrome and keep each frame, its score and captions. */
async function capture() {
  const bundle = await Bun.build({
    entrypoints: [join(film, "town-art.ts")],
    format: "iife",
    minify: true,
    target: "browser",
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "town-art.ts");
  const townArt = await bundle.outputs[0]!.text();

  // Lossless intermediate, encoded twice below.
  const encoder = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "-framerate",
      String(fps),
      "-i",
      "-",
      "-c:v",
      "libx264rgb",
      "-qp",
      "0",
      "-preset",
      "ultrafast",
      frames,
    ],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  );
  const finished = Promise.withResolvers<string>();
  let captions: [number, number, string][] = [];
  let count = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === "POST") {
        if (path === "/frame") {
          encoder.stdin.write(new Uint8Array(await request.arrayBuffer()));
          await encoder.stdin.flush();
          if (++count % (fps * 5) === 0)
            process.stdout.write(`  ${count / fps}s rendered\n`);
        } else if (path === "/captions") captions = await request.json();
        else if (path === "/audio")
          await Bun.write(audio, Buffer.from(await request.text(), "base64"));
        else if (path === "/done") finished.resolve("");
        else if (path === "/fail")
          finished.reject(new Error(await request.text()));
        return new Response("ok");
      }
      if (path === "/")
        return new Response(harness, {
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
    browser = Bun.spawn(
      [
        chrome!,
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--window-size=1920,1080",
        `--user-data-dir=${join(work, "profile")}`,
        server.url.href,
      ],
      { stdout: "ignore", stderr: Bun.file(join(work, "chrome.log")) },
    );
    await Promise.race([
      finished.promise,
      browser.exited.then(async (code) => {
        throw new Error(
          `Chrome exited (${code}): ${await readFile(join(work, "chrome.log"), "utf8")}`,
        );
      }),
    ]);
  } finally {
    server.stop(true);
    await stopChrome(browser);
  }
  encoder.stdin.end();
  if ((await encoder.exited) !== 0) throw new Error("frame capture failed");
  await Bun.write(captionFile, JSON.stringify(captions));
  process.stdout.write(
    `Captured ${count} frames in ${Math.round((performance.now() - began) / 1000)}s\n`,
  );
}

try {
  if (!kept || !existsSync(captionFile)) await capture();
  const captions: [number, number, string][] =
    await Bun.file(captionFile).json();

  await mkdir(out, { recursive: true });
  const webm = join(out, "herdr-world-film.webm");
  const mp4 = join(out, "herdr-world-film.mp4");
  // Two-pass VP9 at a fixed budget keeps the 1080p pixel art sharp at
  // about 3.5 MiB; the H.264 fallback is 720p. Together they stay near 7 MiB.
  const vp9 = [
    ...["-c:v", "libvpx-vp9", "-b:v", "480k", "-minrate", "200k"],
    ...["-maxrate", "1200k", "-row-mt", "1", "-deadline", "good"],
    ...["-cpu-used", "2", "-auto-alt-ref", "1", "-lag-in-frames", "25"],
    ...["-pix_fmt", "yuv420p", "-g", String(fps * 4)],
  ];
  const pass = ["-passlogfile", join(work, "vp9")];
  await ffmpeg([
    "-i",
    frames,
    ...vp9,
    "-pass",
    "1",
    ...pass,
    "-an",
    "-f",
    "null",
    "-",
  ]);
  await ffmpeg([
    ...["-i", frames, "-i", audio, ...vp9, "-pass", "2", ...pass],
    ...["-c:a", "libopus", "-b:a", "48k", webm],
  ]);
  await ffmpeg([
    ...["-i", frames, "-i", audio, "-vf", "scale=1280:720:flags=lanczos"],
    ...["-c:v", "libx264", "-preset", "slower", "-tune", "animation"],
    ...["-profile:v", "high", "-level", "3.1"],
    ...["-crf", "33", "-pix_fmt", "yuv420p", "-g", String(fps * 4)],
    ...["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", mp4],
  ]);
  const stamp = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${(s % 60).toFixed(3).padStart(6, "0")}`;
  await Bun.write(
    join(out, "herdr-world-film.vtt"),
    `WEBVTT\n\n${captions.map(([a, b, line], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${line}\n`).join("\n")}`,
  );
  if (values["update-poster"])
    await ffmpeg([
      "-ss",
      String(POSTER_AT),
      "-i",
      frames,
      "-frames:v",
      "1",
      "-vf",
      "scale=1280:720:flags=lanczos",
      "-q:v",
      "6",
      poster,
    ]);
  for (const file of [webm, mp4])
    process.stdout.write(
      `${file}: ${((await stat(file)).size / 1024 / 1024).toFixed(2)} MiB\n`,
    );
} finally {
  await rm(work, { recursive: true, force: true });
}
