// @world-browser-suite
import { expect, test } from "bun:test";
import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../../scripts/testing/browser-session";
import { connectCapture } from "./connectCapture";
import { waitForPage } from "./browserEvents";

test("case pointer flags reach native CSS media queries after navigation", async () => {
  for (const [pointer, flag] of [
    ["fine", 4],
    ["coarse", 2],
    ["none", 1],
  ] as const) {
    const handle = await launchTestBrowser([
      process.env.CHROME_BIN!,
      `--blink-settings=primaryPointerType=${flag}`,
      "data:text/html,<body>synthetic pointer</body>",
    ]);
    let page: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      await handle.start();
      page = await connectCapture(handle.devtoolsPort);
      const result = await page.command("Runtime.evaluate", {
        expression: `matchMedia('(pointer: ${pointer})').matches`,
        returnByValue: true,
      });
      expect(result.result.value).toBe(true);
    } finally {
      page?.close();
      handle.kill();
      await handle.exited;
    }
  }
}, 90_000); // Admission can wait behind browser-wide traces; assertions are event-based.

test("one Chrome owns isolated case storage, targets and independent lifetimes", async () => {
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<!doctype html><body>synthetic case</body>", {
        headers: { "content-type": "text/html" },
      }),
  });
  const handles: TestBrowser[] = [];
  const pages: Awaited<ReturnType<typeof connectCapture>>[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const handle = await launchTestBrowser([
        process.env.CHROME_BIN!,
        fixture.url.href,
      ]);
      await handle.start();
      handles.push(handle);
      pages.push(await connectCapture(handle.devtoolsPort));
      await waitForPage(
        pages[pages.length - 1]!.command,
        `location.origin === ${JSON.stringify(fixture.url.origin)} && document.readyState === 'complete'`,
      );
    }
    expect(handles[0]!.processId).toBeGreaterThan(0);
    expect(handles[1]!.processId).toBe(handles[0]!.processId);
    expect(handles[1]!.contextId).not.toBe(handles[0]!.contextId);
    const evaluate = async (index: number, expression: string) => {
      const result = await pages[index]!.command("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      expect(result.exceptionDetails).toBeUndefined();
      return result.result.value;
    };
    await evaluate(
      0,
      "localStorage.setItem('fixture-key', 'alpha'); document.cookie='fixture=alpha'",
    );
    expect(await evaluate(1, "localStorage.getItem('fixture-key')")).toBeNull();
    expect(await evaluate(1, "document.cookie")).toBe("");
    const pointerFeatures =
      "JSON.stringify(['fine','coarse','none'].map(value => matchMedia('(pointer: '+value+')').matches))";
    const siblingPointer = await evaluate(1, pointerFeatures);
    for (const pointer of ["fine", "coarse", "none"]) {
      if (pointer !== "fine")
        await pages[0]!.command("Emulation.setTouchEmulationEnabled", {
          enabled: pointer === "coarse",
        });
      expect(JSON.parse(await evaluate(0, pointerFeatures))).toEqual(
        ["fine", "coarse", "none"].map((value) => value === pointer),
      );
      expect(await evaluate(1, pointerFeatures)).toBe(siblingPointer);
    }
    await pages[0]!.command("Target.createTarget", {
      url: fixture.url.href,
      browserContextId: handles[0]!.contextId,
    });
    const targets = async (index: number) =>
      (await (
        await fetch(
          `http://127.0.0.1:${handles[index]!.devtoolsPort}/json/list`,
        )
      ).json()) as { browserContextId: string; type: string }[];
    const left = await targets(0),
      right = await targets(1);
    expect(left.filter((target) => target.type === "page")).toHaveLength(2);
    expect(right.filter((target) => target.type === "page")).toHaveLength(1);
    expect(
      left.every((target) => target.browserContextId === handles[0]!.contextId),
    ).toBe(true);
    expect(
      right.every(
        (target) => target.browserContextId === handles[1]!.contextId,
      ),
    ).toBe(true);
    handles[0]!.kill();
    expect(await handles[0]!.exited).toBe(0);
    expect(await evaluate(1, "6 * 7")).toBe(42);
  } finally {
    for (const page of pages) page.close();
    for (const handle of handles) {
      handle.kill();
      await handle.exited;
    }
    fixture.stop(true);
  }
}, 90_000);
