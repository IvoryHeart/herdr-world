import { findTerminalFileLinkCandidates } from "./terminalFileLinks";
import { parseSourceFileLink } from "./sourceFileLinks";

const FILE_EXTENSION = /\.[a-z][a-z0-9]{0,11}$/i;
const BASENAME_REFERENCE =
  /[\p{L}\p{N}_%+-][\p{L}\p{N}._%+-]*(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?/giu;
const BEFORE_REFERENCE = /[\s"'`([{<]/;
const AFTER_REFERENCE = /[\s.,;:!?"'`)\]}>]/;
const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "markdown",
  "txt",
  "rst",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yml",
  "yaml",
  "toml",
  "ini",
  "conf",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "vue",
  "svelte",
  "sql",
  "xml",
  "svg",
  "lock",
]);
const DOCUMENT_BASENAME =
  /^(?:readme|changelog|contributing|license|notice|security|features|agents)\.(?:md|markdown|mdx|txt|rst)$/i;

/** Bare dotted words need both a known file type and a filename context. */
function isBareReference(value: string, inCode: boolean) {
  const parsed = parseSourceFileLink(value);
  if (!parsed) return false;
  const extension = /\.([a-z][a-z0-9]{0,11})$/i
    .exec(parsed.path)?.[1]
    ?.toLowerCase();
  return Boolean(
    extension &&
      SOURCE_EXTENSIONS.has(extension) &&
      (inCode ||
        parsed.line !== undefined ||
        DOCUMENT_BASENAME.test(parsed.path)),
  );
}

function isWholeCodeReference(text: string) {
  const parsed = parseSourceFileLink(text);
  if (!parsed || /[\n\r<>=()[\]{};|]/.test(parsed.path)) return false;
  if (!/\s/.test(text.trim())) {
    return /[/\\]/.test(parsed.path)
      ? /^(?:\/|[a-z]:[\\/])/i.test(parsed.path) ||
          FILE_EXTENSION.test(parsed.path)
      : isBareReference(text, true);
  }
  const tokens = text.trim().split(/\s+/);
  const first = tokens[0]!;
  const firstPath = parseSourceFileLink(first);
  const anotherPath = tokens.slice(1).some((token) => {
    const next = parseSourceFileLink(token);
    return next && /[/\\]/.test(next.path) && FILE_EXTENSION.test(next.path);
  });
  // A location or a second qualified reference identifies a list. Otherwise
  // a qualified prefix can introduce a filename containing spaces and dots.
  // Commands start with a word rather than that path prefix.
  return Boolean(
    firstPath &&
      /[/\\]/.test(firstPath.path) &&
      firstPath.line === undefined &&
      !(FILE_EXTENSION.test(firstPath.path) && anotherPath) &&
      !/(?:^|\s)--?[a-z0-9]/i.test(text) &&
      (/^(?:\/|[a-z]:[\\/])/i.test(parsed.path) ||
        FILE_EXTENSION.test(parsed.path)),
  );
}

/** Run after Markdown sanitization, only inside an Inspector's Chat. */
export function decorateSourceFileLinks(root: HTMLElement) {
  const mark = (anchor: HTMLAnchorElement, href: string) => {
    anchor.setAttribute("data-source-file", href);
    anchor.setAttribute("href", "#");
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  };
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href")!;
    if (parseSourceFileLink(href) !== undefined) mark(anchor, href);
  }
  // Keep an identifiable spaced path whole. Commands and lists instead use
  // the token scanner below so each actual source location stays independent.
  for (const code of root.querySelectorAll<HTMLElement>("code")) {
    if (code.closest("pre, a")) continue;
    const text = code.textContent ?? "";
    if (!isWholeCodeReference(text)) continue;
    const anchor = root.ownerDocument.createElement("a");
    anchor.textContent = text;
    mark(anchor, text);
    code.replaceChildren(anchor);
  }
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest("a, pre")) texts.push(node);
  }
  for (const node of texts) {
    const text = node.textContent ?? "";
    const inCode = Boolean(node.parentElement?.closest("code"));
    const candidates = findTerminalFileLinkCandidates(text)
      .filter((item) => item.absolute || FILE_EXTENSION.test(item.path))
      .map((item) => ({
        start: item.start,
        end:
          item.end +
          (
            /^(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)/i.exec(
              text.slice(item.end),
            )?.[0] ?? ""
          ).length,
      }));
    for (const match of text.matchAll(BASENAME_REFERENCE)) {
      const value = match[0].replace(/\.+$/, "");
      const start = match.index,
        end = start + value.length;
      if (
        !isBareReference(value, inCode) ||
        (start > 0 && !BEFORE_REFERENCE.test(text[start - 1]!)) ||
        (end < text.length && !AFTER_REFERENCE.test(text[end]!)) ||
        candidates.some((item) => start < item.end && end > item.start)
      )
        continue;
      candidates.push({ start, end });
    }
    if (!candidates.length) continue;
    candidates.sort((left, right) => left.start - right.start);
    const fragment = root.ownerDocument.createDocumentFragment();
    let from = 0;
    for (const candidate of candidates) {
      const end = candidate.end;
      const href = text.slice(candidate.start, end);
      fragment.append(text.slice(from, candidate.start));
      const anchor = root.ownerDocument.createElement("a");
      anchor.textContent = href;
      mark(anchor, href);
      fragment.append(anchor);
      from = end;
    }
    fragment.append(text.slice(from));
    node.replaceWith(fragment);
  }
}
