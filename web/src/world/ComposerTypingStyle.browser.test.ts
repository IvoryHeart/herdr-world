import { sharedBrowserBuild } from "./testing/sharedBrowserBuild";
import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../scripts/testing/browser-session";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import { connectCapture } from "./testing/connectCapture";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

const KEYS = 30;
/**
 * Elements Chrome may restyle for one typed key. The composer, its row and
 * its tools restyle on their own; a `:has()` rule on a shell ancestor
 * restyles the whole World instead (thousands, #1231).
 */
const RESTYLED_PER_KEY_CEILING = 150;

type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: Record<string, any>;
};

/** Every stylesheet under web/src, so a new rule anywhere is measured. */
async function allStyles(dir: string) {
  const source = join(import.meta.dir, "..");
  const imports = [...new Bun.Glob("**/*.css").scanSync({ cwd: source })]
    .sort()
    .map((path) => `@import ${JSON.stringify(join(source, path))};`);
  const entry = join(dir, "all-styles.css");
  await Bun.write(entry, imports.join("\n"));
  const build = await sharedBrowserBuild(import.meta.path, {
    entrypoints: [entry],
    outdir: join(dir, "all-styles"),
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  return new Map(
    build.outputs.map((output) => [`/${basename(output.path)}`, output]),
  );
}

/** Restyled elements and style time between consecutive key marks. */
function perKeyStyleWork(events: TraceEvent[]) {
  const marks = events
    .filter(
      (event) =>
        event.name === "TimeStamp" &&
        String(event.args?.data?.message ?? "").startsWith("composer-key-"),
    )
    .map((event) => event.ts)
    .sort((a, b) => a - b);
  const styles = events.filter(
    (event) => event.name === "UpdateLayoutTree" && event.ph === "X",
  );
  return marks.slice(0, -1).map((start, index) => {
    const end = marks[index + 1]!;
    const inKey = styles.filter((event) => event.ts >= start && event.ts < end);
    return {
      elements: inKey.reduce(
        (sum, event) =>
          sum +
          Number(
            event.args?.elementCount ?? event.args?.data?.elementCount ?? 0,
          ),
        0,
      ),
      styleMs: inKey.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000,
    };
  });
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

test.skipIf(!chrome)(
  "typing in a World-sized chat composer restyles only the composer",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "composer-typing-style-"));
    const { assets } = await buildWorldBrowserBundle(
      "ComposerTypingStyle",
      dir,
    );
    for (const [path, asset] of await allStyles(dir)) assets.set(path, asset);
    const result = Promise.withResolvers<{ elements: number }>(),
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
        if (path === "/") {
          requested.resolve();
          return new Response(
            `<!doctype html><link rel="stylesheet" href="/all-styles.css"><link rel="stylesheet" href="/ComposerTypingStyle.browser.css"><body><script type="module" src="/ComposerTypingStyle.browser.js"></script></body>`,
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
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=1280,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
        { exclusive: true },
      );
      await child.start();
      const ready = await waitForBrowserFixture(
        requested.promise,
        result.promise,
        child.exited.then(async (code) => {
          throw new Error(
            `Chrome exited ${code}: ${await Bun.file(log).text()}`,
          );
        }),
        "Composer typing",
        15000,
      );
      // The page must be World-sized for a whole-app restyle to show.
      expect(ready.elements).toBeGreaterThan(4000);
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      const { command, on } = connection;
      const evaluate = async (expression: string) => {
        const reply = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (reply.exceptionDetails)
          throw new Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      };
      const frame = () => evaluate("window.__composerTyping.frame()");
      const type = async (character: string) => {
        const params = {
          key: character,
          code: `Key${character.toUpperCase()}`,
          windowsVirtualKeyCode: character.toUpperCase().charCodeAt(0),
        };
        await command("Input.dispatchKeyEvent", {
          ...params,
          type: "keyDown",
          text: character,
        });
        await command("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
        await frame();
      };
      // A headless page has no window focus; without it no focus events fire.
      await command("Emulation.setFocusEmulationEnabled", { enabled: true });
      const input = "document.querySelector('.terminal-composer-input')";
      await evaluate(`${input}.focus()`);
      expect(
        await evaluate(
          "document.documentElement.getAttribute('data-terminal-input-focus')",
        ),
      ).toBe("composer");
      for (const character of "warm") await type(character);

      const events: TraceEvent[] = [];
      const complete = Promise.withResolvers<void>();
      on("Tracing.dataCollected", (params) => events.push(...params.value));
      on("Tracing.tracingComplete", () => complete.resolve());
      await command("Tracing.start", {
        categories: "devtools.timeline,disabled-by-default-devtools.timeline",
        transferMode: "ReportEvents",
      });
      const text = "the quick brown fox jumps over";
      for (let index = 0; index <= KEYS; index += 1) {
        await evaluate(`console.timeStamp("composer-key-${index}")`);
        if (index < KEYS) await type(text[index % text.length]!);
      }
      await command("Tracing.end");
      await complete.promise;
      expect(await evaluate(`${input}.value`)).toBe(
        `warm${text.slice(0, KEYS)}`,
      );

      const work = perKeyStyleWork(events);
      expect(work).toHaveLength(KEYS);
      const elements = work.map((key) => key.elements);
      const styleMs = work.map((key) => key.styleMs);
      // Event Timing per key press: the slowest event's duration (to the next
      // paint) and the handlers' total processing time. Chrome reports only
      // events of 16 ms or more, so `timed` counts those.
      const interactions = (await evaluate(`(() => {
        const keys = new Map();
        for (const e of window.__composerTyping.events) {
          if (!e.interactionId) continue;
          const key = keys.get(e.interactionId) ?? { duration: 0, processing: 0 };
          key.duration = Math.max(key.duration, e.duration);
          key.processing += e.processing;
          keys.set(e.interactionId, key);
        }
        return [...keys.values()];
      })()`)) as { duration: number; processing: number }[];
      const durations = interactions.map((key) => key.duration);
      const processing = interactions.map((key) => key.processing);
      // Numbers for the PR; the assertion uses element counts, not time.
      console.log(
        [
          `composer typing: ${ready.elements} elements`,
          `restyled per key p50 ${percentile(elements, 0.5)} p90 ${percentile(elements, 0.9)} max ${Math.max(...elements)}`,
          `style ms p50 ${percentile(styleMs, 0.5).toFixed(2)} p90 ${percentile(styleMs, 0.9).toFixed(2)}`,
          interactions.length
            ? `Event Timing (${interactions.length}/${KEYS + 4} timed) duration p50 ${percentile(durations, 0.5)} p90 ${percentile(durations, 0.9)}, processing ms p50 ${percentile(processing, 0.5).toFixed(1)} p90 ${percentile(processing, 0.9).toFixed(1)}`
            : "Event Timing: no key press reached 16 ms",
        ].join("; "),
      );
      expect(Math.max(...elements)).toBeLessThan(RESTYLED_PER_KEY_CEILING);

      // Phone with the keyboard up: the App's header gives its rows to the
      // composer while it has focus, and comes back when focus leaves.
      const header = `(() => {
        const root = document.documentElement;
        root.dataset.layout = "mobile";
        root.classList.add("keyboard-open");
        let probe = document.querySelector(".app .topbar > .topbar-probe");
        if (!probe) {
          const topbar = document.createElement("header");
          topbar.className = "topbar";
          topbar.innerHTML = '<span class="topbar-probe">World</span>';
          document.querySelector(".app").prepend(topbar);
          probe = topbar.firstElementChild;
        }
        return getComputedStyle(probe).display;
      })()`;
      expect(await evaluate(header)).toBe("none");
      await evaluate(`${input}.blur()`);
      expect(
        await evaluate(
          "document.documentElement.getAttribute('data-terminal-input-focus')",
        ),
      ).toBeNull();
      expect(await evaluate(header)).not.toBe("none");
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60000 + BROWSER_STARTUP_TIMEOUT_MS,
);
