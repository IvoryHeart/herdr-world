/// <reference lib="es2021.promise" />
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, createServer } from "vite";
import { helpPictureBuildConfig } from "../../../scripts/help-pictures";
import { townGoldenBuildConfig } from "../../../scripts/town-golden";
import {
  pagesBuildConfig,
  filmBuildConfig,
} from "../../../scripts/site-bundles";
import { assetUrlImports } from "../world/testing/assetUrlImports";
import { buildWorldBrowserBundle } from "../world/testing/browserBundles";
import { stopChrome, withBrowserDeadline } from "../browserChrome";

test("generated web index runs in every browser build path", async () => {
  const chrome = process.env.CHROME_BIN;
  if (!chrome) throw new Error("CHROME_BIN must name Chrome");
  const root = await mkdtemp(join(tmpdir(), "feature-browser-"));
  const web = resolve(import.meta.dir, "../..");
  const entry = join(import.meta.dir, "testing/probe.browser.tsx");
  const assets = new Map<string, Blob>();
  let script = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      return path === "/"
        ? new Response(
            `<body><script type="module" src="/${script}"></script>`,
            { headers: { "Content-Type": "text/html" } },
          )
        : new Response(assets.get(path) ?? "missing");
    },
  });
  const run = async (label: string, url = server.url.href) => {
    const child = Bun.spawn(
      [
        chrome,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${join(root, "profile")}`,
        "--dump-dom",
        url,
      ],
      { stdout: "pipe", stderr: "ignore" },
    );
    try {
      const [html, code] = await withBrowserDeadline(
        Promise.all([new Response(child.stdout).text(), child.exited]),
        label,
        45_000,
      );
      expect(code).toBe(0);
      expect(html).toContain("<body>span:web-feature");
      console.info(`PASS ${label}: span:web-feature`);
    } finally {
      await stopChrome(child);
    }
  };
  const vite = await createServer({
    root: web,
    configFile: join(web, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [
      {
        name: "feature-index-probe",
        configResolved(config) {
          config.server.proxy = undefined;
        },
      },
    ],
  });
  try {
    await vite.listen();
    await run(
      "Vite dev",
      new URL("src/features/testing/probe.html", vite.resolvedUrls!.local[0])
        .href,
    );
    await vite.close();
    const built = await build({
      root: web,
      configFile: join(web, "vite.config.ts"),
      logLevel: "silent",
      build: {
        write: false,
        outDir: join(root, "vite"),
        rolldownOptions: { input: entry },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!("output" in output)) throw new Error("Expected Vite build output");
    for (const chunk of output.output) {
      if (chunk.type !== "chunk") continue;
      assets.set(
        "/" + chunk.fileName,
        new Blob([chunk.code], { type: "text/javascript" }),
      );
      if (chunk.isEntry) script = chunk.fileName;
    }
    await run("Vite build");
    const world = await buildWorldBrowserBundle(
      "probe",
      root,
      join(import.meta.dir, "testing"),
    );
    for (const [path, asset] of world.assets) assets.set(path, asset);
    script = "probe.browser.js";
    await run("browserBundles.ts");
    // The index carries the shell's real features. Site and film bundles
    // never load the shell, so they lack its `?raw` SVG and `?url` asset
    // loaders (the Library's PDF reader imports PDF.js's worker by URL); a
    // test-only stub lets them still prove the static index itself. Golden
    // and help pictures carry their own loaders, which resolve first.
    const rawSvg: Bun.BunPlugin = {
      name: "feature-index-raw-svg-stub",
      setup(builder) {
        builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
          path: args.path,
          namespace: "raw-svg-stub",
        }));
        builder.onLoad({ filter: /.*/, namespace: "raw-svg-stub" }, () => ({
          contents: 'export default "";',
          loader: "js",
        }));
      },
    };
    for (const [label, config, plugins] of [
      ["help-picture", helpPictureBuildConfig, []],
      ["golden", townGoldenBuildConfig, [rawSvg]],
      ["build-pages.ts site", pagesBuildConfig, [rawSvg, assetUrlImports]],
      ["build-pages.ts film", filmBuildConfig, [rawSvg, assetUrlImports]],
      ["film-render.ts", filmBuildConfig, [rawSvg, assetUrlImports]],
    ] as const) {
      const result = await Bun.build({
        ...config,
        plugins: [...("plugins" in config ? config.plugins : []), ...plugins],
        entrypoints: [entry],
      });
      expect(result.success, result.logs.join("\n")).toBe(true);
      assets.set(
        "/probe.js",
        new Blob([await result.outputs[0].text()], { type: "text/javascript" }),
      );
      script = "probe.js";
      await run(label);
    }
  } finally {
    await vite.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
