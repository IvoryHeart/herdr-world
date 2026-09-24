import { join } from "node:path";
import {
  decodeStaticPathname,
  isStaticRequestMethod,
  resolvePublicFilePath,
  shouldServeSpaEntry,
} from "./static-paths";

// --asset ./public preserves this directory under import.meta.dir in binaries.
const builtPublicDir = Bun.isStandaloneExecutable
  ? join(import.meta.dir, "public")
  : join(import.meta.dir, "../../public");

export async function serveStatic(
  req: Request,
  publicDir: string,
): Promise<Response> {
  if (!isStaticRequestMethod(req.method)) {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  let pathname: string | null;
  try {
    pathname = decodeStaticPathname(new URL(req.url).pathname);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!pathname) return new Response("bad request", { status: 400 });

  const serveEntry =
    pathname === "/index.html" ||
    shouldServeSpaEntry(req.method, req.headers.get("accept"));

  for (const directory of [publicDir, builtPublicDir]) {
    const filePath = resolvePublicFilePath(directory, pathname);
    if (!filePath) return new Response("not found", { status: 404 });
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: responseHeaders(pathname) });
    }
    if (serveEntry) {
      const index = Bun.file(join(directory, "index.html"));
      if (await index.exists()) {
        return new Response(index, {
          headers: responseHeaders("/index.html"),
        });
      }
    }
  }

  return new Response("not found", { status: 404 });
}

function responseHeaders(pathname: string): Record<string, string> {
  const headers = { "content-type": contentType(pathname) };
  if (pathname === "/index.html") {
    return {
      ...headers,
      // The updater replaces hashed assets and index.html together. Always
      // revalidate the entry document so a reload cannot retain old asset URLs.
      "cache-control": "no-cache, must-revalidate",
    };
  }
  return headers;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json") || pathname.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  if (pathname.endsWith(".woff")) return "font/woff";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
