import { findTerminalFileLinkCandidates } from "./terminalFileLinks";
import { parseSourceFileLink } from "./sourceFileLinks";

const FILE_EXTENSION = /\.[a-z][a-z0-9]{0,11}$/i;
const BASENAME_REFERENCE =
  /[\p{L}\p{N}_-][\p{L}\p{N}._%+-]*\.[a-z][a-z0-9]{0,11}(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?/giu;
const BEFORE_REFERENCE = /[\s"'`([{<]/;
const AFTER_REFERENCE = /[\s.,;:!?"'`)\]}>]/;

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
  // Inline code delimits the whole reference, including spaces in a filename.
  // Never run the terminal token scanner over it and link only a path prefix.
  for (const code of root.querySelectorAll<HTMLElement>("code")) {
    if (code.closest("pre, a")) continue;
    const text = code.textContent ?? "";
    const parsed = parseSourceFileLink(text);
    if (
      !parsed ||
      /[\n\r<>=()[\]{};|]/.test(parsed.path) ||
      !(
        /^(?:\/|[a-z]:[\\/])/i.test(parsed.path) ||
        FILE_EXTENSION.test(parsed.path)
      )
    )
      continue;
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
    if (!node.parentElement?.closest("a, pre, code")) texts.push(node);
  }
  for (const node of texts) {
    const text = node.textContent ?? "";
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
      const start = match.index,
        end = start + match[0].length;
      if (
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
