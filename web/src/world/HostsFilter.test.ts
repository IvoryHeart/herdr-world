import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

const cases = [
  ...[1440, 390].flatMap((width) =>
    [
      "filters",
      "delayed-catalogue",
      "empty-catalogue",
      "nonempty-filter",
      "actions",
      "watches",
      "spaces",
      "hidden-spaces",
      "hidden-selection",
      "global-creation",
      "global-creation-retirement",
      "notifications",
      "shortcut",
      "focus-tab",
      "worktree",
    ].map((operation) => ({ width, operation, view: "tree" })),
  ),
  ...[
    "open-all",
    "filtered-open-all",
    "arrangement-focus",
    "arrangement-retirement",
    "close-all",
  ].map((operation) => ({ width: 1440, operation, view: "tree" })),
  ...[1440, 390].flatMap((width) =>
    ["graph", "office"].flatMap((view) =>
      [
        "actions",
        "watches",
        "hidden-spaces",
        "hidden-selection",
        "global-creation",
        "global-creation-retirement",
        "notifications",
        "worktree",
        "spaces",
        "shortcut",
        "focus-tab",
      ].map((operation) => ({ width, operation, view })),
    ),
  ),
  ...["graph", "office", "tree"].flatMap((view) =>
    ["open-all", "filtered-open-all", "compact-arrangement", "close-all"].map(
      (operation) => ({ width: 390, operation, view }),
    ),
  ),
];
test.skipIf(!chrome).each(cases)(
  "the shell preserves qualified operational targets: %j",
  async ({ width, operation, view }) => {
    const dir = await mkdtemp(join(tmpdir(), "world-hosts-filter-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<unknown>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><link rel="stylesheet" href="/HostsFilter.browser.css"></head><body><script type="module" src="/HostsFilter.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "HostsFilter.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-svg",
            setup(builder) {
              builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
                path: Bun.resolveSync(
                  args.path.slice(0, -4),
                  dirname(args.importer),
                ),
                namespace: "raw-svg",
              }));
              builder.onLoad(
                { filter: /.*/, namespace: "raw-svg" },
                async (args) => ({
                  contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
                  loader: "js",
                }),
              );
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          `--window-size=${width},1000`,
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          `${server.url.href}?operation=${operation}&view=${view}`,
        ],
        { stdout: "ignore", stderr: Bun.file(join(dir, "browser.log")) },
      );
      const observed = await Promise.race([
        result.promise,
        browser.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error("Hosts filter browser acceptance timed out")),
            45_000,
          );
        }),
      ]);
      expect(observed).toEqual([]);
    } finally {
      clearTimeout(timeout);
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
