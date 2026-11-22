import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IdeUpstream, proxyIdeHttp } from "./proxy";
import {
  IDE_THEME_DEFAULTS,
  isPageRequest,
  isWorkbenchPage,
  themedWorkbenchBody,
  WORKBENCH_PAGE_LIMIT,
  withThemeDefaults,
} from "./workbench-theme";

/** VS Code's own attribute escaping for the configuration meta. */
const escape = (value: string) =>
  value.replace(
    /[<>"'&]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "&": "&amp;",
      })[c]!,
  );
const workbench = (config: unknown) =>
  `<!DOCTYPE html><html><head>
<meta id="vscode-workbench-web-configuration" data-settings="${escape(JSON.stringify(config))}">
<meta id="vscode-workbench-web-base-url" data-settings="/base">
</head><body></body></html>`;

/** Read the attribute back the way a browser decodes it. */
function readConfig(html: string) {
  const raw =
    /id="vscode-workbench-web-configuration"\s+data-settings="([^"]*)"/.exec(
      html,
    )![1];
  return JSON.parse(
    raw
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

test("the workbench configuration gains World's theme defaults", () => {
  const config = {
    remoteAuthority: "world.example",
    folderUri: { scheme: "vscode-remote", path: "/work/it's <a & b>" },
  };
  const out = readConfig(withThemeDefaults(workbench(config)));
  expect(out).toEqual({ ...config, configurationDefaults: IDE_THEME_DEFAULTS });
  expect(IDE_THEME_DEFAULTS["window.autoDetectColorScheme"]).toBe(true);
});

test("a provider's own configuration defaults are kept and win", () => {
  const config = {
    configurationDefaults: {
      "window.autoDetectColorScheme": false,
      "editor.fontSize": 15,
    },
  };
  expect(readConfig(withThemeDefaults(workbench(config)))).toEqual(config);
});

test("pages without a readable configuration stay as they are", () => {
  const plain = "<!doctype html><body>webview</body>";
  expect(withThemeDefaults(plain)).toBe(plain);
  const broken = workbench({}).replace("{}", "{not json");
  expect(withThemeDefaults(broken)).toBe(broken);
  const list = workbench([1]);
  expect(withThemeDefaults(list)).toBe(list);
});

test("only uncompressed HTML page loads are read", () => {
  const html = new Headers({ "content-type": "text/html; charset=utf-8" });
  expect(isWorkbenchPage("GET", html)).toBe(true);
  expect(isWorkbenchPage("HEAD", html)).toBe(false);
  expect(
    isWorkbenchPage("GET", new Headers({ "content-type": "text/javascript" })),
  ).toBe(false);
  expect(
    isWorkbenchPage(
      "GET",
      new Headers({ "content-type": "text/html", "content-encoding": "gzip" }),
    ),
  ).toBe(false);
  expect(
    isWorkbenchPage(
      "GET",
      new Headers({
        "content-type": "text/html",
        "content-length": String(WORKBENCH_PAGE_LIMIT + 1),
      }),
    ),
  ).toBe(false);
  expect(
    isPageRequest("GET", new Headers({ "sec-fetch-dest": "iframe" })),
  ).toBe(true);
  expect(
    isPageRequest("GET", new Headers({ "sec-fetch-dest": "script" })),
  ).toBe(false);
  expect(isPageRequest("GET", new Headers({ accept: "text/html,*/*" }))).toBe(
    true,
  );
  expect(isPageRequest("POST", new Headers({ accept: "text/html" }))).toBe(
    false,
  );
});

const stream = (...parts: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });

test("other pages keep their exact bytes; long bodies pass through", async () => {
  const withBom = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode("<p>webview</p>"),
  ]);
  const same = await themedWorkbenchBody(stream(withBom));
  expect(new Uint8Array(await new Response(same).arrayBuffer())).toEqual(
    withBom,
  );
  const big = new Uint8Array(WORKBENCH_PAGE_LIMIT + 10).fill(0x61);
  const passed = await themedWorkbenchBody(stream(big.subarray(0, 10), big));
  expect((await new Response(passed).arrayBuffer()).byteLength).toBe(
    big.byteLength + 10,
  );
});

test("World's proxy serves the workbench page with theme defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ide-theme-"));
  const socketPath = join(dir, "ide.sock");
  const seen: (string | null)[] = [];
  const server = Bun.serve({
    unix: socketPath,
    fetch(req) {
      seen.push(req.headers.get("accept-encoding"));
      return new Response(workbench({ remoteAuthority: "world.example" }), {
        headers: { "content-type": "text/html" },
      });
    },
  });
  const upstream: IdeUpstream = {
    instanceId: "AbCdEfGhIjKlMnOpQrStUv",
    provider: "vscode",
    socketPath,
    token: null,
    stripsBasePath: false,
  };
  try {
    const url = new URL(`http://world.example/ide/${upstream.instanceId}/`);
    const response = await proxyIdeHttp(
      new Request(url, {
        headers: { "sec-fetch-dest": "iframe", "accept-encoding": "gzip, br" },
      }),
      url,
      upstream,
    );
    expect(response.status).toBe(200);
    expect(readConfig(await response.text()).configurationDefaults).toEqual(
      IDE_THEME_DEFAULTS,
    );
    expect(seen).toEqual(["identity"]);
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
