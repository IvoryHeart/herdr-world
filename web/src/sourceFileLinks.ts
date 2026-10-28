import { createContext } from "react";
import { relativePathWithinCheckout } from "./workspaceResource";

export type SourceFileLink = { path: string; line?: number; fragment?: string };

export const SourceFileLinkContext = createContext<
  ((href: string) => void) | null
>(null);

/** Undefined is a web/fragment link; null is an invalid local reference. */
export function parseSourceFileLink(
  href: string,
): SourceFileLink | null | undefined {
  const value = href.trim();
  const drive = /^[a-z]:[\\/]/i.test(value);
  const fileLocation =
    /^[^/\\:?#]+\.[a-z0-9]{1,12}:\d+(?::\d+)?(?:#.*)?$/i.test(value);
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    (!drive && !fileLocation && /^[a-z][a-z0-9+.-]*:/i.test(value))
  )
    return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    /[\u0000-\u001f\u007f-\u009f]/.test(decoded) ||
    decoded.startsWith("//") ||
    decoded.startsWith("\\\\") ||
    decoded.includes("?")
  )
    return null;
  const hash = decoded.indexOf("#");
  const fragment = hash < 0 ? undefined : decoded.slice(hash + 1);
  let path = hash < 0 ? decoded : decoded.slice(0, hash);
  const location = /:(\d+)(?::\d+)?$/.exec(path);
  const anchorLine = fragment?.match(/^L(\d+)(?:-L?\d+)?$/i);
  const line =
    location || anchorLine ? Number((location ?? anchorLine)![1]) : undefined;
  if (location) path = path.slice(0, location.index);
  if (
    !path ||
    (line !== undefined && (!Number.isSafeInteger(line) || line < 1))
  )
    return null;
  return {
    path,
    ...(line !== undefined ? { line } : {}),
    ...(fragment && !anchorLine ? { fragment } : {}),
  };
}

/** Resolve only inside the already admitted root; never choose another checkout. */
export function sourceFileWithinWorktree(
  root: string,
  link: SourceFileLink,
): SourceFileLink | null {
  const windows = /^[a-z]:[\\/]/i.test(root);
  if (!windows && link.path.includes("\\")) return null;
  const path = windows ? link.path.replace(/\\/g, "/") : link.path;
  const absolute = /^(?:\/|[a-z]:\/)/i.test(path);
  const relative = absolute ? relativePathWithinCheckout(root, path) : path;
  if (
    relative === undefined ||
    relative.startsWith("~") ||
    /^[a-z]:/i.test(relative)
  )
    return null;
  const parts: string[] = [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? { ...link, path: parts.join("/") } : null;
}
