import { join } from "node:path";
import { PUBLIC_FILES } from "../public-files.gen";
import {
  decodeStaticPathname,
  isStaticRequestMethod,
  resolvePublicFilePath,
  shouldServeSpaEntry,
} from "./static-paths";

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
  const url = new URL(req.url);
  const pathname = decodeStaticPathname(url.pathname);
  if (!pathname) return new Response("bad request", { status: 400 });

  const filePath = resolvePublicFilePath(publicDir, pathname);
  if (!filePath) return new Response("not found", { status: 404 });
  const serveEntry =
    pathname === "/index.html" ||
    shouldServeSpaEntry(req.method, req.headers.get("accept"));

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, { headers: responseHeaders(pathname) });
  }
  if (serveEntry) {
    const index = Bun.file(join(publicDir, "index.html"));
    if (await index.exists()) {
      return new Response(index, {
        headers: responseHeaders("/index.html"),
      });
    }
  }

  const embedded =
    PUBLIC_FILES[pathname] ??
    (serveEntry ? PUBLIC_FILES["/index.html"] : undefined);
  if (embedded) {
    const body =
      embedded.encoding === "base64"
        ? Buffer.from(embedded.content, "base64")
        : embedded.content;
    return new Response(body, {
      headers: responseHeaders(
        PUBLIC_FILES[pathname] ? pathname : "/index.html",
      ),
    });
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
