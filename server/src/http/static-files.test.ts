import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
  gzipSync,
} from "node:zlib";
import { tmpdir } from "node:os";
import { serveStatic } from "./static-files";

const web = resolve(import.meta.dir, "../../../web");

test("serveStatic refuses encoded traversal even when the escaped file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "static-traversal-"));
  const publicDir = await mkdtemp(join(root, "public-"));
  try {
    await writeFile(join(root, "secret.txt"), "private fixture");
    await writeFile(join(publicDir, "index.html"), "SPA fixture");
    for (const path of ["/..%2fsecret.txt", "/%2e%2e%2fsecret.txt"]) {
      const response = await serveStatic(
        new Request(`https://world.example${path}`, {
          headers: { accept: "text/html" },
        }),
        publicDir,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("not found");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the app links a credentialed standalone manifest with existing install icons", async () => {
  const html = await Bun.file(resolve(web, "index.html")).text();
  const link = html.match(/<link\b[^>]*\brel="manifest"[^>]*>/)?.[0];
  expect(link).toContain('href="/manifest.json"');
  expect(link).toContain('crossorigin="use-credentials"');
  const response = await serveStatic(
    new Request("https://herdr-world.example/manifest.json"),
    resolve(web, "public"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Herdr World",
    short_name: "World",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "any",
    "192x192",
    "512x512",
    "192x192",
    "512x512",
  ]);
  for (const icon of manifest.icons.filter(
    (icon: { type: string }) => icon.type === "image/png",
  )) {
    expect(icon.type).toBe("image/png");
    const bytes = Buffer.from(
      await Bun.file(resolve(web, "public", icon.src.slice(1))).arrayBuffer(),
    );
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
      icon.sizes,
    );
  }
});

test("source runs fall back to the built public directory", async () => {
  const response = await serveStatic(
    new Request("https://herdr-world.example/manifest.json"),
    "/nonexistent-herdr-world-static-test",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual(
    await Bun.file(resolve(web, "public/manifest.json")).json(),
  );
});

test("instance names update both manifest labels without changing installation identity", async () => {
  const original = await Bun.file(resolve(web, "public/manifest.json")).json();
  for (const suffix of ["Home", 'Work "A" & <B>', "\u5bb6\u91cc", ""]) {
    const response = await serveStatic(
      new Request("https://roamgate.example/manifest.json", {
        headers: {
          "if-none-match": '"old-static-file"',
          "if-modified-since": new Date().toUTCString(),
        },
      }),
      resolve(web, "public"),
      suffix,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    expect(response.headers.has("etag")).toBe(false);
    const name = suffix ? `Herdr World \u00b7 ${suffix}` : "Herdr World";
    expect(await response.json()).toEqual({
      ...original,
      name,
      short_name: suffix ? name : original.short_name,
    });
  }
});

test("entry HTML escapes the name in title and metadata, including SPA routes", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    const suffix = '</title><script>"&';
    for (const path of ["/", "/index.html", "/workspace/example"]) {
      const response = await serveStatic(
        new Request(`https://roamgate.example${path}`, {
          headers: { accept: "text/html" },
        }),
        web,
        suffix,
      );
      expect(response.headers.get("cache-control")).toContain("no-cache");
      const doc = new window.DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      expect(doc.title).toBe(`Herdr World \u00b7 ${suffix}`);
      expect(doc.querySelectorAll("title")).toHaveLength(1);
      const original = new window.DOMParser().parseFromString(
        await Bun.file(resolve(web, "index.html")).text(),
        "text/html",
      );
      expect(doc.querySelectorAll("script")).toHaveLength(
        original.querySelectorAll("script").length,
      );
      for (const key of ["application-name", "apple-mobile-web-app-title"])
        expect(
          doc.querySelector(`meta[name="${key}"]`)?.getAttribute("content"),
        ).toBe(`Herdr World \u00b7 ${suffix}`);
      expect(
        doc.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      ).toBe("/manifest.json");
      expect(
        doc.querySelector('link[rel="manifest"]')?.getAttribute("crossorigin"),
      ).toBe("use-credentials");
    }
  } finally {
    await window.happyDOM.close();
  }
});

test("HEAD returns naming response headers without a body", async () => {
  for (const [path, directory] of [
    ["/index.html", web],
    ["/manifest.json", resolve(web, "public")],
  ]) {
    const response = await serveStatic(
      new Request(`https://roamgate.example${path}`, { method: "HEAD" }),
      directory,
      "Work",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
  }
});

test("a fresh source build serves instance metadata without generated web assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-source-manifest-"));
  try {
    const outdir = join(root, "server/src/http");
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "static-files.ts")],
      target: "bun",
      outdir,
      naming: "static-files.js",
    });
    expect(build.success).toBe(true);
    await writeFile(
      join(root, "index.html"),
      "<title>SPA fallback must not replace manifest</title>",
    );
    const script = `
      import { serveStatic } from ${JSON.stringify(join(outdir, "static-files.js"))};
      const response = await serveStatic(new Request("http://localhost/manifest.json", { headers: { accept: "text/html" } }), ${JSON.stringify(root)}, "Dev");
      console.log(JSON.stringify({ status: response.status, cache: response.headers.get("cache-control"), manifest: await response.json() }));
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      status: 200,
      cache: "private, no-cache, must-revalidate",
      manifest: {
        ...(await Bun.file(resolve(web, "public/manifest.json")).json()),
        name: "Herdr World \u00b7 Dev",
        short_name: "Herdr World \u00b7 Dev",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("module files (.mjs) are served as JavaScript, so browsers run them", async () => {
  const root = await mkdtemp(join(tmpdir(), "roamgate-static-mjs-"));
  try {
    await writeFile(join(root, "worker.mjs"), "export {};\n");
    const response = await serveStatic(
      new Request("https://roamgate.example/worker.mjs"),
      root,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("content-hashed assets", () => {
  const script = "export const value = 42;\n".repeat(64);
  async function withAssets(
    run: (root: string) => Promise<void>,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "world-static-assets-"));
    try {
      await mkdir(join(root, "public/assets"), { recursive: true });
      const assets = join(root, "public/assets");
      await writeFile(join(root, "public/index.html"), "<title>x</title>");
      await writeFile(join(root, "public/sw.js"), script);
      await writeFile(
        join(root, "public/manifest.json"),
        JSON.stringify({ name: "World", short_name: "World" }),
      );
      await writeFile(
        join(root, "public/sw.js.br"),
        brotliCompressSync(script),
      );
      await writeFile(join(assets, "app-hash.js"), script);
      await writeFile(
        join(assets, "app-hash.js.br"),
        brotliCompressSync(script),
      );
      await writeFile(join(assets, "app-hash.js.gz"), gzipSync(script));
      await writeFile(join(assets, "plain-hash.css"), "a{}");
      await writeFile(join(assets, "font-hash.woff2"), "wOF2");
      // A variant without its file is never served in its place.
      await writeFile(
        join(assets, "orphan-hash.js.br"),
        brotliCompressSync(script),
      );
      // Outside the public directory: no traversal through the lookup.
      await writeFile(join(root, "outside.js"), "secret");
      await writeFile(
        join(root, "outside.js.br"),
        brotliCompressSync("secret"),
      );
      await run(join(root, "public"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  function get(
    publicDir: string,
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) {
    return serveStatic(
      new Request(`https://world.example${path}`, { method, headers }),
      publicDir,
    );
  }
  const immutable = "private, max-age=31536000, immutable";

  test("serve the variant the browser accepts, with encoding and Vary", async () => {
    await withAssets(async (publicDir) => {
      for (const [accept, coding, decode] of [
        ["gzip, deflate, br, zstd", "br", brotliDecompressSync],
        ["gzip, br;q=0.5", "gzip", gunzipSync],
        ["br;q=0, gzip", "gzip", gunzipSync],
        ["*", "br", brotliDecompressSync],
      ] as const) {
        const response = await get(publicDir, "/assets/app-hash.js", {
          "accept-encoding": accept,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-encoding")).toBe(coding);
        expect(response.headers.get("vary")).toBe("Accept-Encoding");
        expect(response.headers.get("cache-control")).toBe(immutable);
        expect(response.headers.get("content-type")).toBe(
          "text/javascript; charset=utf-8",
        );
        const body = Buffer.from(await response.arrayBuffer());
        expect(decode(body).toString()).toBe(script);
      }
    });
  });

  test("fall back to the file without a variant or an accepted coding", async () => {
    await withAssets(async (publicDir) => {
      for (const [path, headers] of [
        ["/assets/app-hash.js", {}],
        ["/assets/app-hash.js", { "accept-encoding": "identity" }],
        ["/assets/app-hash.js", { "accept-encoding": "br;q=0, gzip;q=0" }],
        ["/assets/plain-hash.css", { "accept-encoding": "br, gzip" }],
      ] as const) {
        const response = await get(publicDir, path, headers);
        expect(response.status).toBe(200);
        expect(response.headers.has("content-encoding")).toBe(false);
        expect(response.headers.get("vary")).toBe("Accept-Encoding");
        expect(response.headers.get("cache-control")).toBe(immutable);
        expect(await response.text()).toBe(
          path.endsWith(".css") ? "a{}" : script,
        );
      }
      const font = await get(publicDir, "/assets/font-hash.woff2", {
        "accept-encoding": "br",
      });
      expect(font.headers.get("content-type")).toBe("font/woff2");
      expect(font.headers.get("cache-control")).toBe(immutable);
      expect(font.headers.has("vary")).toBe(false);
    });
  });

  test("HEAD carries the same headers without a body", async () => {
    await withAssets(async (publicDir) => {
      const response = await get(
        publicDir,
        "/assets/app-hash.js",
        { "accept-encoding": "br" },
        "HEAD",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("br");
      expect(response.headers.get("cache-control")).toBe(immutable);
      expect(await response.text()).toBe("");
    });
  });

  test("only hashed assets are cached or compressed; missing ones are not", async () => {
    await withAssets(async (publicDir) => {
      const accept = { "accept-encoding": "br, gzip" };
      const worker = await get(publicDir, "/sw.js", accept);
      expect(worker.status).toBe(200);
      expect(worker.headers.has("content-encoding")).toBe(false);
      expect(worker.headers.has("cache-control")).toBe(false);
      expect(await worker.text()).toBe(script);
      const entry = await get(publicDir, "/", {
        ...accept,
        accept: "text/html",
      });
      expect(entry.headers.get("cache-control")).toBe(
        "private, no-cache, must-revalidate",
      );
      expect(entry.headers.has("content-encoding")).toBe(false);
      // A missing asset never gets a year-long cache, as file or SPA entry.
      const orphan = await get(publicDir, "/assets/orphan-hash.js", accept);
      expect(orphan.status).toBe(404);
      expect(orphan.headers.has("cache-control")).toBe(false);
      const spa = await get(publicDir, "/assets/missing-hash.js", {
        ...accept,
        accept: "text/html",
      });
      expect(spa.headers.get("cache-control")).toBe(
        "private, no-cache, must-revalidate",
      );
      // Encoded aliases that resolve outside /assets/ keep the headers and
      // rendering of the file they name, never an asset's year-long cache.
      const entryAlias = await get(publicDir, "/assets/..%2Findex.html", {
        ...accept,
        accept: "text/html",
      });
      expect(entryAlias.status).toBe(200);
      expect(entryAlias.headers.get("cache-control")).toBe(
        "private, no-cache, must-revalidate",
      );
      expect(entryAlias.headers.has("content-encoding")).toBe(false);
      expect(await entryAlias.text()).toBe("<title>Herdr World</title>");
      const manifestAlias = await get(
        publicDir,
        "/assets/%2e%2e/manifest.json",
        accept,
      );
      expect(manifestAlias.headers.get("cache-control")).toBe(
        "private, no-cache, must-revalidate",
      );
      expect(manifestAlias.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      const workerAlias = await get(publicDir, "/assets/..%2Fsw.js", accept);
      expect(workerAlias.status).toBe(200);
      expect(workerAlias.headers.has("cache-control")).toBe(false);
      expect(workerAlias.headers.has("content-encoding")).toBe(false);
      expect(await workerAlias.text()).toBe(script);
      // An alias that lands on a real asset is that asset.
      const assetAlias = await get(
        publicDir,
        "/x/..%2Fassets/app-hash.js",
        accept,
      );
      expect(assetAlias.headers.get("cache-control")).toBe(immutable);
      expect(assetAlias.headers.get("content-encoding")).toBe("br");
      for (const path of [
        "/assets/..%2F..%2Foutside.js",
        "/assets/%2e%2e/%2e%2e/outside.js",
      ]) {
        const outside = await get(publicDir, path, accept);
        expect(outside.status).toBe(404);
        expect(await outside.text()).toBe("not found");
      }
    });
  });
});
