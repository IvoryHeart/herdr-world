import { findTerminalFileLinkCandidates } from "./terminalFileLinks";
import { parseSourceFileLink } from "./sourceFileLinks";

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
    const candidates = findTerminalFileLinkCandidates(text).filter(
      (item) => item.absolute || /\.[a-z0-9]{1,12}$/i.test(item.path),
    );
    if (!candidates.length) continue;
    const fragment = root.ownerDocument.createDocumentFragment();
    let from = 0;
    for (const candidate of candidates) {
      const suffix =
        /^(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)/i.exec(
          text.slice(candidate.end),
        )?.[0] ?? "";
      const end = candidate.end + suffix.length;
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
