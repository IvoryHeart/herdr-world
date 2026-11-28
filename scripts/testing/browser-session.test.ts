import { expect, test } from "bun:test";
import {
  endpointForTarget,
  launchTestBrowser,
  managedRenderingFlags,
  toolBrowserSession,
} from "./browser-session";

test("a target endpoint is qualified by the owning browser and target", () => {
  expect(
    endpointForTarget("ws://127.0.0.1:4321/devtools/browser/owner", "case-a"),
  ).toBe("ws://127.0.0.1:4321/devtools/page/case-a");
  expect(
    endpointForTarget("ws://127.0.0.1:4321/devtools/page/case-a", "case-b"),
  ).toBe("ws://127.0.0.1:4321/devtools/page/case-b");
});

test("case teardown disposes its context once and waits for acknowledgement", async () => {
  const requests: unknown[] = [];
  const disposing = Promise.withResolvers<void>();
  const arrived = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("test-session");
      const data = await request.json();
      requests.push(data);
      if (data.watch) {
        await disposing.promise;
        return Response.json({ code: 0 });
      }
      if (data.context) {
        arrived.resolve();
        await disposing.promise;
      }
      return Response.json(
        data.context ? {} : { context: "case-a", port: "1234" },
      );
    },
  });
  try {
    const handle = await launchTestBrowser(
      ["chrome", "about:blank"],
      undefined,
      { exclusive: true },
      {
        HERDR_TEST_BROWSER: server.url.href,
        HERDR_TEST_BROWSER_TOKEN: "test-session",
      },
    );
    await handle.start();
    await handle.start();
    expect(handle.devtoolsPort).toBe("1234");
    handle.kill();
    handle.kill();
    await arrived.promise;
    expect(handle.exitCode).toBeNull();
    disposing.resolve();
    expect(await handle.exited).toBe(0);
    expect(handle.exitCode).toBe(0);
    expect(requests).toHaveLength(4);
    expect(requests).toContainEqual({
      args: ["chrome", "about:blank"],
      exclusive: true,
    });
    expect(requests).toContainEqual({ watch: "case-a" });
    expect(requests).toContainEqual({ start: "case-a" });
    expect(requests).toContainEqual({ context: "case-a" });
  } finally {
    disposing.resolve();
    server.stop(true);
  }
});

test("managed GPU selection needs no probe Chrome and CI stays calibrated software", () => {
  expect(
    managedRenderingFlags({ CI: "true", HERDR_WORLD_TEST_GPU: "1" }),
  ).toContain("--use-angle=swiftshader");
  expect(managedRenderingFlags({ HERDR_WORLD_TEST_GPU: "1" })).toContain(
    "--use-angle=vulkan",
  );
  expect(
    managedRenderingFlags({
      HERDR_WORLD_TEST_GPU: "1",
      HERDR_TEST_BROWSER_RENDERING: "swiftshader",
    }),
  ).toContain("--use-angle=swiftshader");
  const selected = managedRenderingFlags({});
  selected.push("synthetic");
  expect(managedRenderingFlags({})).not.toContain("synthetic");
});

test("tools use their explicit session and dispose once without changing the runner connection", async () => {
  const runner = process.env.HERDR_TEST_BROWSER;
  const requests: unknown[] = [];
  const closed = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("tool-owner");
      const data = await request.json();
      requests.push(data);
      if (data.watch) {
        await closed.promise;
        return Response.json({ code: 0 });
      }
      if (data.context) {
        closed.resolve();
        return Response.json({});
      }
      return Response.json({
        context: "tool",
        port: "1234",
        processId: 42,
        browserEndpoint: "ws://127.0.0.1:4321/devtools/browser/tool-owner",
      });
    },
  });
  try {
    const connection = {
      HERDR_TEST_BROWSER: server.url.href,
      HERDR_TEST_BROWSER_TOKEN: "tool-owner",
    };
    const tool = await toolBrowserSession("synthetic-chrome", {}, connection);
    connection.HERDR_TEST_BROWSER = "http://127.0.0.1:1/";
    expect(tool.browser.processId).toBe(42);
    expect(tool.browser.browserEndpoint).toEndWith("/tool-owner");
    await tool.browser.start();
    await Promise.all([tool.close(), tool.close()]);
    expect(process.env.HERDR_TEST_BROWSER).toBe(runner);
    expect(requests).toHaveLength(4);
    expect(requests).toContainEqual({
      args: ["synthetic-chrome", "about:blank"],
      exclusive: true,
    });
  } finally {
    closed.resolve();
    server.stop(true);
  }
});
