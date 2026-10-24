// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForChromePort,
  waitForBrowserFixture,
  withBrowserDeadline,
} from "../../browserChrome";
import { groupsBrowserServer } from "./testing/groupsBrowserServer";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome).each([1440, 390, 320, 360, 430])(
  "Groups panel uses current membership and refuses stale role confirmation at %ipx",
  async (width: number) => {
    const directory = await mkdtemp(join(tmpdir(), "groups-browser-"));
    const fixture = await groupsBrowserServer(directory);
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let socket: WebSocket | undefined;
    let cdp:
      | ((method: string, params?: object) => Promise<Record<string, unknown>>)
      | undefined;
    const log = join(directory, "browser.log");
    try {
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          `--window-size=${width},900`,
          `--user-data-dir=${join(directory, "profile")}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      const requested = (async () => {
        const port = await waitForChromePort(
          child!,
          join(directory, "profile"),
          log,
        );
        const targets = (await withBrowserDeadline(
          fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
            response.json(),
          ),
          "Groups debugger discovery",
        )) as { type: string; webSocketDebuggerUrl: string }[];
        socket = new WebSocket(
          targets.find((target) => target.type === "page")!
            .webSocketDebuggerUrl,
        );
        await withBrowserDeadline(
          new Promise<void>((resolve, reject) => {
            socket!.onopen = () => resolve();
            socket!.onerror = () =>
              reject(new Error("Groups CDP connection failed"));
          }),
          "Groups CDP connection",
        );
        let id = 0;
        const pending = new Map<
          number,
          {
            resolve(value: Record<string, unknown>): void;
            reject(reason: Error): void;
          }
        >();
        socket.onmessage = (event) => {
          const response = JSON.parse(String(event.data));
          const request = pending.get(response.id);
          if (!request) return;
          pending.delete(response.id);
          if (response.error) request.reject(new Error(response.error.message));
          else request.resolve(response.result);
        };
        cdp = (method, params = {}) =>
          withBrowserDeadline(
            new Promise((resolve, reject) => {
              pending.set(++id, { resolve, reject });
              socket!.send(JSON.stringify({ id, method, params }));
            }),
            `Groups CDP ${method}`,
          );
        await cdp("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width <= 720,
        });
        await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
        if (width <= 720)
          await cdp("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
        await cdp("Page.navigate", {
          url: `${fixture.server.url.href}?width=${width}${Bun.env.GROUPS_CAPTURE_DIR ? "&capture=1" : ""}`,
        });
        await fixture.requested;
      })();
      const failures = await waitForBrowserFixture(
        requested,
        fixture.result,
        child.exited.then(async (code) => {
          throw new Error(
            `Chrome exited ${code}: ${(await readFile(log, "utf8")).slice(-2000)}`,
          );
        }),
        "Groups panel",
        20_000,
      );
      expect(failures).toEqual([]);
      if (Bun.env.GROUPS_CAPTURE_DIR && cdp) {
        await mkdir(Bun.env.GROUPS_CAPTURE_DIR, { recursive: true });
        const capture = async (name: string) => {
          const shot = await cdp!("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          await Bun.write(
            join(Bun.env.GROUPS_CAPTURE_DIR!, `groups-${name}-${width}.png`),
            Buffer.from(String(shot.data), "base64"),
          );
        };
        await capture("roster");
        const detail = await cdp("Runtime.evaluate", {
          awaitPromise: true,
          expression: `new Promise((resolve) => {
          const observer = new MutationObserver(() => { if (document.querySelector('.group-detail')) { observer.disconnect(); requestAnimationFrame(() => resolve(true)); } });
          observer.observe(document.body, { childList: true, subtree: true });
          [...document.querySelectorAll('.group-roster-row')].find((node) => node.textContent.includes('Pod · Chat')).click();
        })`,
        });
        if (detail.exceptionDetails)
          throw new Error("Groups detail capture failed");
        await capture("detail");
      }
    } finally {
      socket?.close();
      fixture.server.stop(true);
      await stopChrome(child);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
