import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../../scripts/testing/browser-session";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../../browserChrome";
import { buildWorldBrowserBundle } from "../testing/browserBundles";
import { SWIFTSHADER_FLAGS } from "../testing/chromeRendering";
import { gestureTrace } from "../testing/frameTrace";
import { connectCapture } from "../testing/connectCapture";

/*
 * Town's frame budget at scale (#1248), on the town-scale page
 * (testing/town-scale/TownScale.browser.tsx: the production TownCanvas with
 * the scale scene). Counts, not milliseconds, so it holds on CI's
 * SwiftShader: Town draws per animation frame while panning, elements
 * restyled per zoom frame, layouts forced inside Town's frames, raster work
 * and frames shown with undrawn tiles while panning and zooming, and Town
 * draws while typing in the composer.
 */

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

type TraceEvent = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  tid: number;
  pid: number;
  id?: string;
  id2?: { local?: string; global?: string };
  args?: Record<string, any>;
};

/**
 * Frames per traced pan. On four cores with SwiftShader, as on CI, a traced
 * desk-level pan frame takes about 175 ms; the counts are per frame.
 */
const PAN_FRAMES = 60;
/** Deadline for one traced pan or zoom: about 11 s there, 20 s was too tight. */
const MEASURE_DEADLINE_MS = 60000;
const TYPED_KEYS = 20;
/**
 * Elements one zoom frame may restyle: the signs, plaques and cards that
 * read the zoom. The whole overlay is over 2,000 (#1248).
 */
const RESTYLED_PER_ZOOM_FRAME_CEILING = 400;
/**
 * Raster tasks per pan frame, at home and at desk level. Repainting the
 * overlay as it moved took about 2.5 and 5.8 (#1248).
 */
const RASTER_PER_PAN_FRAME = [1.5, 4];
/**
 * Share of the frames shown during a pan or zoom that may still have a tile
 * being rastered. The overlay moves as one composited layer; when the raster
 * workers fall behind (two starved cores, like a loaded CI runner), Chrome
 * shows a frame before a tile the motion uncovered is drawn, and draws it in
 * the next. There at most 2 of about 58 pan frames did, and 1 zoom frame
 * (#1384). Patchy drawing leaves tiles missing in many frames. Its pre-#1318
 * cause, re-rasterizing the overlay as it moves, shows here as raster work
 * (about 150 tasks per home pan) and fails RASTER_PER_PAN_FRAME.
 */
const UNDRAWN_SHARE = 1 / 20;

test.skipIf(!chrome).each(["home-pan", "zoom", "desk-pan", "composer"])(
  "Town frame budget (%s): display-rate pans, bounded zoom restyles and composer quiet",
  async (phase) => {
    const dir = await mkdtemp(join(tmpdir(), "town-frame-budget-"));
    const { assets } = await buildWorldBrowserBundle(
      "testing/town-scale/TownScale",
      dir,
    );
    const requested = Promise.withResolvers<void>();
    const loaded = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/loaded") {
          loaded.resolve();
          return new Response("ok");
        }
        if (path === "/") {
          requested.resolve();
          return new Response(
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/TownScale.browser.css"></head><body><div id="root"></div><script type="module" src="/TownScale.browser.js"></script><script type="module">await window.townScale.ready; fetch("/loaded");</script></body></html>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        const asset = assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let child: TestBrowser | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const profile = join(dir, "profile"),
        log = join(dir, "chrome.log");
      child = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--remote-debugging-port=0",
          "--enable-webgl",
          ...SWIFTSHADER_FLAGS,
          "--window-size=1512,982",
          "--force-device-scale-factor=1",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      await child.start();
      await waitForBrowserFixture(
        requested.promise,
        loaded.promise,
        child.exited.then(async (code) => {
          throw new Error(
            `Chrome exited ${code}: ${await Bun.file(log).text()}`,
          );
        }),
        "Town frame budget",
        30000,
      );
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      const { command, on } = connection;
      const evaluate = async (expression: string, deadlineMs?: number) => {
        const reply = await command(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          deadlineMs,
        );
        if (reply.exceptionDetails)
          throw new Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      };
      const events: TraceEvent[] = [];
      on("Tracing.dataCollected", (params) => events.push(...params.value));
      const trace = async <T>(run: () => Promise<T>) => {
        events.length = 0;
        const complete = Promise.withResolvers<void>();
        const done = () => complete.resolve();
        on("Tracing.tracingComplete", done);
        // Only the categories the counts read: stacks and cc.debug slowed
        // each traced frame by a third on four cores.
        await command("Tracing.start", {
          categories: [
            "devtools.timeline",
            "disabled-by-default-devtools.timeline",
            "disabled-by-default-devtools.timeline.frame",
            "benchmark",
            "cc",
            "blink.user_timing",
          ].join(","),
          transferMode: "ReportEvents",
        });
        // PipelineReporter can arrive during this trace for a frame that
        // began before Tracing.start. Mark the actual gesture in Chrome's
        // clock so cold setup frames cannot count as missing pan content.
        await evaluate(
          'performance.clearMarks(); performance.mark("world-gesture-start")',
        );
        const result = await run();
        await evaluate('performance.mark("world-gesture-end")');
        await command("Tracing.end");
        await complete.promise;
        return {
          result,
          events: gestureTrace(
            [...events],
            "world-gesture-start",
            "world-gesture-end",
          ),
        };
      };
      const draws = () =>
        evaluate("window.__HERDR_TOWN_RENDERER__.frames") as Promise<number>;

      /**
       * Frames shown during the gesture, and how many of them had a tile not
       * yet drawn. Chrome can report one shown frame twice: its own
       * PipelineReporter and a FORKED or STATE_PRESENTED_PARTIAL one for a
       * main frame presented in it. Both end at the frame's presentation,
       * so frames are counted by that end time.
       */
      const shownFrames = (events: TraceEvent[]) => {
        const begun = new Map<string, TraceEvent>();
        const frames = new Map<string, boolean>();
        for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
          if (event.name !== "PipelineReporter") continue;
          const key = `${event.pid}:${event.id2?.local ?? event.id2?.global ?? event.id}`;
          if (event.ph === "b") begun.set(key, event);
          if (event.ph !== "e") continue;
          const frame = begun.get(key)?.args?.frame_reporter;
          begun.delete(key);
          if (!String(frame?.state).startsWith("STATE_PRESENTED")) continue;
          const undrawn = Boolean(
            frame.has_missing_content ||
              frame.checkerboarded_needs_raster ||
              frame.checkerboarded_needs_record,
          );
          const shown = String(event.ts);
          frames.set(shown, frames.get(shown) || undrawn);
        }
        return {
          shown: frames.size,
          undrawn: [...frames.values()].filter(Boolean).length,
        };
      };
      /** Style or layout work inside animation frames: forced by script. */
      const forced = (events: TraceEvent[]) => {
        const frames = events.filter(
          (event) => event.name === "FireAnimationFrame" && event.ph === "X",
        );
        const hits = events.filter(
          (event) =>
            (event.name === "Layout" || event.name === "UpdateLayoutTree") &&
            event.ph === "X" &&
            frames.some(
              (frame) =>
                frame.tid === event.tid &&
                event.ts >= frame.ts &&
                event.ts < frame.ts + (frame.dur ?? 0),
            ),
        );
        return hits.length;
      };
      const rasterTasks = (events: TraceEvent[]) =>
        events.filter((event) => event.name === "RasterTask").length;
      /**
       * The median number of elements one style update restyled: the
       * restyle each zoom frame pays, not the one-off work of the desks
       * that mount when the zoom crosses a level.
       */
      const restyled = (events: TraceEvent[]) => {
        const counts = events
          .filter(
            (event) => event.name === "UpdateLayoutTree" && event.ph === "X",
          )
          .map((event) =>
            Number(
              event.args?.elementCount ?? event.args?.data?.elementCount ?? 0,
            ),
          )
          .sort((a, b) => a - b);
        return counts[Math.floor(counts.length / 2)] ?? 0;
      };
      const pan = async () => {
        const run = await trace(async () => {
          const before = await draws();
          const timing = await evaluate(
            `window.townScale.pan(${PAN_FRAMES})`,
            MEASURE_DEADLINE_MS,
          );
          return { ticks: timing.frames, draws: (await draws()) - before };
        });
        return {
          ...run.result,
          ...shownFrames(run.events),
          forced: forced(run.events),
          raster: rasterTasks(run.events),
        };
      };
      const zoomIn = async () => {
        const run = await trace(async () => {
          const before = await draws();
          const state = await evaluate(
            'window.townScale.zoom("in")',
            MEASURE_DEADLINE_MS,
          );
          return { level: state.level, draws: (await draws()) - before };
        });
        return {
          ...run.result,
          restyled: restyled(run.events),
          ...shownFrames(run.events),
          forced: forced(run.events),
        };
      };
      const overlay = await evaluate(
        "document.querySelectorAll('.town-world *').length",
      );
      const pans = phase === "home-pan" ? [await pan()] : [];
      const zooms =
        phase === "zoom"
          ? [await zoomIn(), await zoomIn(), await zoomIn()]
          : [];
      if (phase === "desk-pan" || phase === "composer") {
        // Fresh fixture: reach desk scale without replaying another case's traces.
        for (let step = 0; step < 3; step++)
          await evaluate('window.townScale.zoom("in")', MEASURE_DEADLINE_MS);
      }
      if (phase === "desk-pan") pans.push(await pan());
      let idleDraws = 0,
        typingDraws = 0,
        resumedDraws = 0,
        value = 0;
      if (phase === "composer") {
        const idle = await draws();
        await evaluate("new Promise((r) => setTimeout(r, 2000))");
        idleDraws = (await draws()) - idle;
        // A headless page has no window focus; without it no focus events fire.
        await command("Emulation.setFocusEmulationEnabled", { enabled: true });
        await evaluate(`(() => {
        const input = document.createElement("textarea");
        input.className = "terminal-composer-input";
        input.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:10";
        document.body.append(input);
        input.focus();
      })()`);
        const typed = await draws();
        for (let index = 0; index < TYPED_KEYS; index++) {
          const key = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 };
          await command("Input.dispatchKeyEvent", {
            ...key,
            type: "keyDown",
            text: "a",
          });
          await command("Input.dispatchKeyEvent", { ...key, type: "keyUp" });
          await evaluate("new Promise((r) => setTimeout(r, 100))");
        }
        typingDraws = (await draws()) - typed;
        const resumed = await draws();
        // This is a frame-count assertion, not a one-second speed budget.
        // Shared software-rendering CPUs may present only one frame per second.
        const afterResume = await evaluate(
          `new Promise((resolve) => {
            const sample = () => {
              const frames = window.__HERDR_TOWN_RENDERER__.frames;
              if (frames - ${resumed} > ${typingDraws}) resolve(frames);
              else requestAnimationFrame(sample);
            };
            sample();
          })`,
          MEASURE_DEADLINE_MS,
        );
        resumedDraws = afterResume - resumed;
        value = await evaluate(
          "document.querySelector('.terminal-composer-input').value.length",
        );
      }
      // Numbers for the PR; the assertions below are counts.
      console.log(
        JSON.stringify({
          overlay,
          pans,
          zooms,
          idleDraws,
          typingDraws,
          resumedDraws,
        }),
      );

      expect(overlay).toBeGreaterThan(2000);
      for (const [index, run] of pans.entries()) {
        // Town draws on (nearly) every animation frame while panning; with a
        // wait before each frame it drew on about every other one.
        expect(run.draws).toBeGreaterThanOrEqual(run.ticks * 0.9);
        // Hardly a shown frame has a tile still being drawn; no layout is
        // forced inside a frame.
        expect(run.shown).toBeGreaterThan(0);
        expect(run.undrawn).toBeLessThanOrEqual(
          Math.ceil(run.shown * UNDRAWN_SHARE),
        );
        expect(run.forced).toBe(0);
        // The overlay moves as one composited layer, not re-rasterized
        // tile by tile on every frame. At desk scale a pan uncovers new
        // tiles; repainting the moved overlay took over twice as many.
        expect(run.raster).toBeLessThan(
          run.ticks * RASTER_PER_PAN_FRAME[phase === "desk-pan" ? 1 : index]!,
        );
      }
      expect(zooms.map((zoom) => zoom.level)).not.toContain("home");
      for (const zoom of zooms) {
        expect(zoom.draws).toBeGreaterThan(5);
        // A zoom frame restyles the zoom's readers, not the overlay.
        expect(zoom.restyled).toBeLessThan(RESTYLED_PER_ZOOM_FRAME_CEILING);
        expect(zoom.shown).toBeGreaterThan(0);
        expect(zoom.undrawn).toBeLessThanOrEqual(
          Math.ceil(zoom.shown * UNDRAWN_SHARE),
        );
        expect(zoom.forced).toBe(0);
      }
      if (phase === "composer") {
        // Ambient motion keeps its own pace, not the display's.
        expect(idleDraws).toBeLessThanOrEqual(64);
        expect(value).toBe(TYPED_KEYS);
        // Typing in the composer quiets Town's motion, then it resumes.
        expect(typingDraws).toBeLessThanOrEqual(4);
        expect(resumedDraws).toBeGreaterThan(typingDraws);
      }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000 + BROWSER_STARTUP_TIMEOUT_MS,
);
