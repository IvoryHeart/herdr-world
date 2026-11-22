/**
 * VS Code's light/dark follows World's theme.
 *
 * The Code view sets the frame's `color-scheme` to World's resolved theme,
 * which is what `prefers-color-scheme` answers inside the frame (and it
 * changes live when World's theme does). The workbench follows that query
 * only when `window.autoDetectColorScheme` is on, so World adds it as a
 * configuration default on the workbench page: a default, never a user
 * setting, so nothing is written to the user's VS Code and an explicit
 * setting of their own still wins. Their own light and dark themes come
 * from VS Code's preferred light/dark theme settings.
 *
 * VS Code, code-server and openvscode-server all serve the workbench
 * configuration as HTML-escaped JSON in one meta element.
 */

export const IDE_THEME_DEFAULTS: Readonly<Record<string, unknown>> = {
  "window.autoDetectColorScheme": true,
};

/** Workbench pages are a few KB; anything larger is not one. */
export const WORKBENCH_PAGE_LIMIT = 1024 * 1024;

const CONFIG_META =
  /(<meta\s+id="vscode-workbench-web-configuration"\s+data-settings=")([^"]*)(")/;

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

function unescapeAttribute(value: string) {
  return value.replace(/&(quot|apos|lt|gt|amp|#\d{1,7});/g, (m) =>
    m.startsWith("&#")
      ? String.fromCodePoint(Number(m.slice(2, -1)))
      : ENTITIES[m],
  );
}

function escapeAttribute(value: string) {
  return value.replace(/[<>"'&]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The page with World's theme defaults added to the workbench
 * configuration; any page without one, or one World cannot read, is
 * returned unchanged.
 */
export function withThemeDefaults(html: string): string {
  const match = CONFIG_META.exec(html);
  if (!match) return html;
  let config: unknown;
  try {
    config = JSON.parse(unescapeAttribute(match[2]));
  } catch {
    return html;
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    return html;
  const own = (config as { configurationDefaults?: unknown })
    .configurationDefaults;
  const configurationDefaults = {
    ...IDE_THEME_DEFAULTS,
    ...(own && typeof own === "object" && !Array.isArray(own) ? own : {}),
  };
  const value = escapeAttribute(
    JSON.stringify({ ...config, configurationDefaults }),
  );
  return (
    html.slice(0, match.index) +
    match[1] +
    value +
    match[3] +
    html.slice(match.index + match[0].length)
  );
}

/** A response worth reading for the workbench configuration. */
export function isWorkbenchPage(method: string, headers: Headers) {
  if (method !== "GET") return false;
  const type = headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("text/html")) return false;
  const encoding = (headers.get("content-encoding") ?? "identity").trim();
  if (encoding.toLowerCase() !== "identity") return false;
  const length = Number(headers.get("content-length") ?? 0);
  return !(length > WORKBENCH_PAGE_LIMIT);
}

/** A page load (not a script or socket) whose body World may read. */
export function isPageRequest(method: string, headers: Headers) {
  if (method !== "GET") return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest) return dest === "document" || dest === "iframe";
  return (headers.get("accept") ?? "").includes("text/html");
}

/**
 * The body with theme defaults, read up to the page limit; a longer body
 * passes through untouched.
 */
export async function themedWorkbenchBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<BodyInit | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > WORKBENCH_PAGE_LIMIT) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
        },
        async pull(controller) {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
    }
  }
  const bytes = Buffer.concat(chunks);
  const html = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const themed = withThemeDefaults(html);
  // Any other page (a webview's, say) keeps its exact bytes.
  return themed === html ? bytes : themed;
}
