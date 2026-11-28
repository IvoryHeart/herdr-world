import { expect, test } from "bun:test";
import {
  endpointForTarget,
  launchTestBrowser,
  managedRenderingFlags,
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
  const previous = {
    url: process.env.HERDR_TEST_BROWSER,
    token: process.env.HERDR_TEST_BROWSER_TOKEN,
  };
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
    process.env.HERDR_TEST_BROWSER = server.url.href;
    process.env.HERDR_TEST_BROWSER_TOKEN = "test-session";
    const handle = await launchTestBrowser(
      ["chrome", "about:blank"],
      undefined,
      { exclusive: true },
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
    if (previous.url === undefined) delete process.env.HERDR_TEST_BROWSER;
    else process.env.HERDR_TEST_BROWSER = previous.url;
    if (previous.token === undefined)
      delete process.env.HERDR_TEST_BROWSER_TOKEN;
    else process.env.HERDR_TEST_BROWSER_TOKEN = previous.token;
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
