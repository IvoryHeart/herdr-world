/**
 * Stock VS Code and OpenVSCode Server webviews on World's origin (#1053).
 *
 * Their workbench frames webviews (Markdown preview, extension panels) from
 * `https://<hash>.vscode-cdn.net`, which World's frame rule keeps out. Two
 * edits on the IDE's own responses, both under `/ide/<instance>/`, bring the
 * webview host page onto World's origin instead:
 *
 * 1. The workbench page: its configuration gains `webviewEndpoint`, VS Code's
 *    own embedder option for where the webview host page lives. It points at
 *    the IDE's static copy of that page under the instance route.
 * 2. The webview host page (`…/webview/browser/pre/index.html`): its parent
 *    check requires the page's hostname to be a hash of the parent's origin,
 *    which no same-origin address can be. World swaps that one condition for
 *    "the parent is on this page's own origin" and recomputes the page's CSP
 *    script hash for the edited script, after proving the hash it replaces
 *    is the browser's hash of the original script.
 *
 * Nothing else changes: the page still hands its message port only to a
 * parent on the expected origin, its CSP is otherwise byte-for-byte the
 * IDE's, and no other product file is touched. If either edit doesn't apply
 * cleanly (a different VS Code layout), World serves the IDE's response as
 * it is, and webviews stay blank as before.
 */

import { createHash } from "node:crypto";

/** Where VS Code keeps the webview host page, below its static route. */
export const WEBVIEW_HOST_DIR =
  "/out/vs/workbench/contrib/webview/browser/pre/";
const WEBVIEW_HOST_PAGE =
  /\/out\/vs\/workbench\/contrib\/webview\/browser\/pre\/index(?:-no-csp)?\.html$/;

/** The stock check; it holds only on `<hash>.vscode-cdn.net`. */
export const WEBVIEW_HOSTNAME_CHECK =
  "hostname === parentOriginHash || hostname.startsWith(parentOriginHash + '.')";
/** World's replacement: the parent must share the page's own origin. */
export const WEBVIEW_SAME_ORIGIN_CHECK = "parentOrigin === location.origin";

const CONFIG_META =
  /(<meta\s+id="vscode-workbench-web-configuration"\s+data-settings=")([^"]*)(")/;
const BASE_URL_META =
  /<meta\s+id="vscode-workbench-web-base-url"\s+data-settings="([^"]*)"/;
const CSP_META =
  /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

export function isWebviewHostPage(path: string) {
  return WEBVIEW_HOST_PAGE.test(path);
}

function decodeAttribute(value: string) {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi,
    (entity, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      return (
        { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" }[lower] ?? entity
      );
    },
  );
}

function encodeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The workbench page with `webviewEndpoint` set to the webview host page on
 * World's origin, or null when the page isn't a VS Code workbench under
 * this instance's route.
 */
export function withWorldWebviewEndpoint(
  html: string,
  browserOrigin: string,
  instanceBase: string,
): string | null {
  const config = CONFIG_META.exec(html);
  const baseUrl = BASE_URL_META.exec(html);
  if (!config || !baseUrl) return null;
  const staticRoute = decodeAttribute(baseUrl[1]).replace(/\/+$/, "");
  // The static route is the IDE's own, under this instance only.
  if (
    !staticRoute.startsWith(`${instanceBase}/`) ||
    /[?#\\]|\/\.\.?(\/|$)/.test(staticRoute)
  )
    return null;
  let settings: unknown;
  try {
    settings = JSON.parse(decodeAttribute(config[2]));
  } catch {
    return null;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return null;
  const webviewEndpoint = `${browserOrigin}${staticRoute}${WEBVIEW_HOST_DIR}`;
  const encoded = encodeAttribute(
    JSON.stringify({ ...settings, webviewEndpoint }),
  );
  return html.replace(
    CONFIG_META,
    (_, open: string, _value: string, close: string) =>
      `${open}${encoded}${close}`,
  );
}

/** The CSP source the browser computes for an inline script's text. */
export function cspScriptHash(script: string) {
  return `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
}

/**
 * The webview host page with its parent check made same-origin and its CSP
 * hash recomputed, or null when the page doesn't have exactly the stock
 * check in one inline script whose hash its CSP lists.
 */
export function withSameOriginWebviewHost(source: string): string | null {
  // The HTML parser turns CRLF into LF before the browser hashes a script.
  const html = source.replace(/\r\n?/g, "\n");
  if (html.split(WEBVIEW_HOSTNAME_CHECK).length !== 2) return null;
  const scripts = [...html.matchAll(INLINE_SCRIPT)];
  const checked = scripts.filter((match) =>
    match[1].includes(WEBVIEW_HOSTNAME_CHECK),
  );
  if (checked.length !== 1) return null;
  const [script, original] = checked[0];
  const edited = original.replace(
    WEBVIEW_HOSTNAME_CHECK,
    () => WEBVIEW_SAME_ORIGIN_CHECK,
  );
  const start = (checked[0].index ?? 0) + script.indexOf(">") + 1;
  let page = `${html.slice(0, start)}${edited}${html.slice(start + original.length)}`;
  const csp = CSP_META.exec(page);
  if (csp) {
    // The hash World replaces must be the one the browser would check;
    // the rest of the policy stays exactly the IDE's.
    const before = cspScriptHash(original);
    if (!csp[2].includes(before)) return null;
    const policy = csp[2].replace(before, () => cspScriptHash(edited));
    page = page.replace(
      CSP_META,
      (_, open: string, _value: string, close: string) =>
        `${open}${policy}${close}`,
    );
  }
  return page;
}
