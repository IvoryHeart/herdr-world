import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChrome } from "../../web/src/browserChrome";
import { CDP, instrument, waitContent, counters } from "./cdp";
import { deadline, distribution, processSample } from "./support";
import { profileOwners } from "./profile";
import type { startService } from "./service";
import type { syntheticSources } from "./source";
import { fitSingleRoom, panOnce, observeCamera } from "./interaction";

export type Device = {
  id: string;
  width: number;
  height: number;
  throttle: number;
};
export const devices: Device[] = [
  { id: "desktop", width: 1440, height: 1000, throttle: 1 },
  { id: "phone-emulated", width: 390, height: 844, throttle: 4 },
];

export async function browserCase(
  service: Awaited<ReturnType<typeof startService>>,
  source: Awaited<ReturnType<typeof syntheticSources>>,
  view: string,
  device: Device,
  out: string,
  profile: boolean,
  seconds: number,
  interaction = false,
) {
  const chrome =
    process.env.CHROME_BIN ??
    Bun.which("google-chrome") ??
    Bun.which("chromium");
  if (!chrome) throw new Error("Chrome is required for the scale matrix");
  const scratch = mkdtempSync(join(tmpdir(), "hws-chrome-"));
  const child = Bun.spawn(
    [
      chrome,
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(scratch, "profile")}`,
      "--window-size=1440,1100",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let cdp: CDP | undefined;
  const endpoint = Promise.withResolvers<string>();
  let chromeLog = "";
  const logs = (async () => {
    for await (const chunk of child.stderr) {
      chromeLog += new TextDecoder().decode(chunk);
      const match = chromeLog.match(
        /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
      );
      if (match) endpoint.resolve(match[1]!);
    }
  })();
  try {
    const port = await deadline(
      Promise.race([
        endpoint.promise,
        child.exited.then((code) => {
          throw new Error(`Chrome exited ${code}`);
        }),
      ]),
      "Chrome endpoint",
      35000,
    );
    const targets: any[] = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const ws = new WebSocket(
      targets.find((t) => t.type === "page").webSocketDebuggerUrl,
    );
    await deadline(
      new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("CDP connect failed"));
      }),
      "CDP open",
    );
    cdp = new CDP(ws);
    for (const domain of [
      "Page",
      "Network",
      "Runtime",
      "Performance",
      "Profiler",
    ])
      await cdp.call(`${domain}.enable`);
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: device.width,
      height: device.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.call("Emulation.setCPUThrottlingRate", { rate: device.throttle });
    const [cookieName, ...cookieValue] = service.cookie.split("=");
    await cdp.call("Network.setCookie", {
      url: service.base,
      name: cookieName,
      value: cookieValue.join("="),
      httpOnly: true,
      sameSite: "Lax",
    });
    await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
      source: instrument,
    });
    const metric = async () => {
      const r = await cdp!.call("Performance.getMetrics");
      return Object.fromEntries(r.metrics.map((m: any) => [m.name, m.value]));
    };
    const phases: any[] = [];
    const phase = async (
      name: string,
      operation: () => Promise<unknown>,
      initial = false,
    ) => {
      const before = initial
        ? {
            commits: 0,
            raf: 0,
            snapshots: 0,
            events: 0,
            bytes: 0,
            frameIndex: 0,
            longTaskIndex: 0,
            at: 0,
          }
        : await cdp!.evaluate(counters);
      const metricsBefore = await metric();
      const serviceBefore = processSample(service.child.pid),
        nativeBefore = structuredClone(source.methods);
      if (profile) await cdp!.call("Profiler.start");
      const began = performance.now(),
        result = await operation(),
        elapsedMs = performance.now() - began;
      const metricsAfter = await metric(),
        after = await cdp!.evaluate(counters);
      const serviceAfter = processSample(service.child.pid);
      const nativeMethods = Object.fromEntries(
        Object.entries(source.methods).map(([method, m]) => [
          method,
          {
            calls: m.calls - (nativeBefore[method]?.calls ?? 0),
            encodeMs: m.encodeMs - (nativeBefore[method]?.encodeMs ?? 0),
            bytes: m.bytes - (nativeBefore[method]?.bytes ?? 0),
          },
        ]),
      );
      const detail = await cdp!.evaluate(
        `({frames:__scale.frames.slice(${before.frameIndex}),longTasks:__scale.longTasks.slice(${before.longTaskIndex}),errors:__scale.errors})`,
      );
      let owners = null;
      if (profile) {
        const value = await cdp!.call("Profiler.stop");
        writeFileSync(
          `${out}-${name}.cpuprofile`,
          JSON.stringify(value.profile),
        );
        owners = await profileOwners(value.profile);
      }
      const work = Object.fromEntries(
        ["commits", "raf", "snapshots", "events", "bytes"].map((key) => [
          key,
          after[key] - before[key],
        ]),
      );
      phases.push({
        name,
        elapsedMs,
        browserDurationMs: after.at - before.at,
        work,
        rendererTaskMs:
          (metricsAfter.TaskDuration - (metricsBefore.TaskDuration ?? 0)) *
          1000,
        scriptMs:
          (metricsAfter.ScriptDuration - (metricsBefore.ScriptDuration ?? 0)) *
          1000,
        layoutMs:
          (metricsAfter.LayoutDuration - (metricsBefore.LayoutDuration ?? 0)) *
          1000,
        frameIntervalsMs: distribution(detail.frames),
        longTasks: detail.longTasks,
        errors: detail.errors,
        serviceWork: {
          before: serviceBefore,
          after: serviceAfter,
          nativeMethods,
          boundary:
            "World process includes worker threads; synthetic source encode costs belong to producer, not service",
        },
        heap: await cdp!.call("Runtime.getHeapUsage"),
        owners,
        result,
      });
      writeFileSync(`${out}-phases.json`, JSON.stringify(phases, null, 2));
    };
    const selector =
      view === "town"
        ? '.world-semantic-targets-overlay[aria-busy="false"]'
        : ".board-zone-label[data-world-node-anchor]";
    const ready = async (text?: string) => {
      await cdp!.evaluate(waitContent(selector, text));
      return cdp!.evaluate(
        `(async()=>{const c=window.__HERDR_WORLD_CAPTURE__;if(c)return {boundary:'capture-receipt',receipt:await c.wait({view:${JSON.stringify(view)},width:${device.width},height:${device.height},timeoutMs:100000})};return {boundary:'topology-controls-and-two-animation-frames; no card-draw latency claim'};})()`,
      );
    };
    await phase(
      "initial",
      async () => {
        await cdp!.call("Page.navigate", { url: `${service.base}/${view}` });
        return ready(source.hosts[0]!.workspaces[0]!.label as string);
      },
      true,
    );
    const viewport = await cdp.evaluate(
      "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
    );
    if (viewport.width !== device.width || viewport.height !== device.height)
      throw new Error("CDP viewport does not match declared device");
    if (interaction) {
      await observeCamera(cdp);
      await phase("fit-room", () => fitSingleRoom(cdp!));
      await phase("pan-once", () => panOnce(cdp!));
      await phase("fitted-idle", async () => {
        await new Promise((r) => setTimeout(r, seconds * 1000));
        return null;
      });
    } else {
      await phase("refresh", async () => ready(source.emit(0)));
      await phase("idle", async () => {
        await new Promise((r) => setTimeout(r, seconds * 1000));
        return null;
      });
      await phase("burst-100", async () => {
        const sent = await source.burst(100, seconds);
        const marker = source.emit(0);
        await ready(marker);
        return sent;
      });
    }
    const rendered = await cdp.evaluate(
      `({boardCards:document.querySelectorAll('.board-card').length,boardWorkspaces:document.querySelectorAll('.board-workspace').length,boardTabs:document.querySelectorAll('.board-tab').length,boardPanes:document.querySelectorAll('.board-pane').length,boardNotes:document.querySelectorAll('.board-note').length,semanticTargets:document.querySelectorAll('.world-semantic-target').length,townDesks:document.querySelectorAll('.world-semantic-target[data-kind="desk"]').length,townAgents:document.querySelectorAll('.world-semantic-target[data-kind="agent"]').length,canvasCount:document.querySelectorAll('canvas').length})`,
    );
    return {
      view,
      device,
      viewport,
      profile,
      interaction,
      rendering: "SwiftShader; desktop emulation; DPR 1",
      phases,
      rendered,
    };
  } finally {
    cdp?.close();
    await stopChrome(child);
    await logs;
    writeFileSync(`${out}-chrome.log`, chromeLog);
    rmSync(scratch, { recursive: true, force: true });
  }
}
