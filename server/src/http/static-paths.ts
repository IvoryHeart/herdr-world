import { isAbsolute, relative, resolve, sep } from "node:path";

export function decodeStaticPathname(rawPathname: string): string | null {
  try {
    const pathname = decodeURIComponent(rawPathname);
    if (pathname.includes("\0")) return null;
    return pathname === "/" ? "/index.html" : pathname;
  } catch {
    return null;
  }
}

export function resolvePublicFilePath(
  publicDir: string,
  pathname: string,
): string | null {
  const root = resolve(publicDir);
  const candidate = resolve(root, `.${pathname}`);
  const child = relative(root, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    return null;
  }
  return candidate;
}

/**
 * The pathname of the file a request resolves to inside `publicDir`, with
 * `.` and `..` segments (including percent-encoded ones) folded away, or
 * null when it escapes the directory. Callers classify this canonical path,
 * so `/assets/..%2Findex.html` is treated as `/index.html`, not as an asset.
 */
export function canonicalStaticPathname(
  publicDir: string,
  pathname: string,
): string | null {
  const filePath = resolvePublicFilePath(publicDir, pathname);
  if (!filePath) return null;
  return `/${relative(resolve(publicDir), filePath).split(sep).join("/")}`;
}

export function shouldServeSpaEntry(
  method: string,
  accept: string | null,
): boolean {
  return (
    isStaticRequestMethod(method) && Boolean(accept?.includes("text/html"))
  );
}

export function isStaticRequestMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}
