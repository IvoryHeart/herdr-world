import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";

const repositoryRoot = "https://github.com/IvoryHeart/herdr-world/blob/main/";

export interface TutorialPage {
  content: string;
  navigation: string;
}

/**
 * The tutorial teaches a learner; FEATURES.md is the reference. These limits
 * keep each step readable and stop edge cases accumulating in the tutorial.
 */
export const tutorialLimits = { words: 6000, blockWords: 60 } as const;

export interface TutorialShape {
  words: number;
  longest: { words: number; text: string };
}

function proseWords(text: string): number {
  return (
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .match(/[\p{L}\p{N}][^\s]*/gu)?.length ?? 0
  );
}

/**
 * Measure the tutorial's prose: total words and its longest block. A block is a
 * paragraph, or a whole list item with its indented paragraphs and sub-items,
 * so a step cannot grow into a wall of text by splitting it into paragraphs.
 */
export function measureTutorial(markdown: string): TutorialShape {
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^ *(```|~~~)[^\n]*\n[\s\S]*?^ *\1 *$/gm, "")
    .split("\n")
    .map((raw) => raw.replace(/^\s*>\s?/, ""));
  const item = /^(\s*)(\d+\.|[-*+])\s+/;
  const blocks: string[] = [];
  // Paragraphs: every list item or heading starts a new one.
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current.join(" "));
    current = [];
  };
  for (const line of lines) {
    if (!line.trim()) flush();
    else if (item.test(line) || /^#|^\s*\|/.test(line)) {
      flush();
      current.push(line.replace(item, ""));
    } else current.push(line);
  }
  flush();
  // Whole steps: a list item runs until a non-blank line at or left of its marker.
  const steps: { indent: number; text: string[] }[] = [];
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (line.trim()) {
      while (steps.length && indent <= (steps.at(-1)?.indent ?? 0)) {
        blocks.push(steps.pop()?.text.join(" ") ?? "");
      }
    }
    const marker = item.exec(line);
    if (marker) {
      steps.push({ indent: marker[1].length, text: [] });
    }
    for (const step of steps) step.text.push(line.replace(item, ""));
  }
  for (const step of steps) blocks.push(step.text.join(" "));
  let words = 0;
  let longest = { words: 0, text: "" };
  for (const block of blocks) {
    const count = proseWords(block);
    if (count > longest.words) longest = { words: count, text: block.trim() };
  }
  for (const line of lines) words += proseWords(line.replace(item, ""));
  return { words, longest };
}

/** Fail the site build when the tutorial outgrows a learner's guide. */
export function checkTutorialShape(markdown: string): void {
  const { words, longest } = measureTutorial(markdown);
  const advice =
    "Keep tutorial steps short; put reference detail, edge cases and limits in FEATURES.md.";
  if (longest.words > tutorialLimits.blockWords) {
    const start = longest.text.split(/\s+/).slice(0, 12).join(" ");
    throw new Error(
      `docs/TUTORIAL.md has a ${longest.words}-word step or paragraph (limit ${tutorialLimits.blockWords}): "${start} …". ${advice}`,
    );
  }
  if (words > tutorialLimits.words) {
    throw new Error(
      `docs/TUTORIAL.md has ${words} words of prose (limit ${tutorialLimits.words}). ${advice}`,
    );
  }
}

/** Render trusted repository Markdown; this is not an untrusted-content sanitizer. */
export async function renderTutorial(markdown: string): Promise<TutorialPage> {
  const chapters: { link: string; sections: string[] }[] = [];
  let chapter = 0;
  let section = 0;
  // Explicit source anchors remain usable on both GitHub and Pages. Generated
  // heading IDs stay stable when titles are reworded.
  const html = Bun.markdown
    .html(markdown)
    .replace(/<h([1-3])>(.*?)<\/h\1>/g, (_, level: string, title: string) => {
      let id = "tutorial-title";
      if (level === "2") {
        id = `chapter-${++chapter}`;
        chapters.push({ link: `<a href="#${id}">${title}</a>`, sections: [] });
      } else if (level === "3") {
        id = `section-${++section}`;
        chapters
          .at(-1)
          ?.sections.push(`<li><a href="#${id}">${title}</a></li>`);
      }
      return `<h${level} id="${id}">${title}</h${level}>`;
    })
    // Each exercise ends with its completion check; give it its own callout.
    .replaceAll(
      "<p><strong>You are done when:</strong>",
      '<p class="tutorial-done"><strong>You are done when:</strong>',
    );
  const navigation = chapters
    .map(
      ({ link, sections }) =>
        `<li>${link}${sections.length ? `<ol>${sections.join("")}</ol>` : ""}</li>`,
    )
    .join("");

  const content = await new HTMLRewriter()
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href") ?? "";
        if (!href.startsWith(".")) return;
        // Keep installation/security references canonical instead of copying
        // those documents into the tutorial or depending on a site-root path.
        element.setAttribute(
          "href",
          new URL(href, `${repositoryRoot}docs/`).href,
        );
      },
    })
    .on("img", {
      async element(element) {
        const src = element.getAttribute("src") ?? "";
        if (src.startsWith("./images/")) {
          const name = posix.basename(src);
          const header = Buffer.from(
            await Bun.file(new URL(`../docs/images/${name}`, import.meta.url))
              .slice(0, 24)
              .arrayBuffer(),
          );
          if (
            header.length < 24 ||
            header.toString("hex", 0, 8) !== "89504e470d0a1a0a"
          ) {
            throw new Error(`Expected a shared PNG screenshot: ${name}`);
          }
          // Reserve the real aspect ratio before lazy images load; otherwise
          // jumping to a chapter can land above it after layout shifts.
          element.setAttribute("width", String(header.readUInt32BE(16)));
          element.setAttribute("height", String(header.readUInt32BE(20)));
          element.setAttribute("src", `../assets/${name}`);
        }
        element.setAttribute("loading", "lazy");
        element.setAttribute("decoding", "async");
      },
    })
    .on("table", {
      element(element) {
        element.before(
          '<div class="tutorial-table" role="region" aria-label="Horizontally scrollable reference table" tabindex="0">',
          { html: true },
        );
        element.after("</div>", { html: true });
      },
    })
    .transform(new Response(html))
    .text();

  return { content, navigation: `<ol>${navigation}</ol>` };
}

/** Give changed CSS/JS a new cache key without invalidating unchanged assets. */
export async function versionSiteAssets(directory: string): Promise<void> {
  const root = resolve(directory);
  for await (const page of new Bun.Glob("**/*.html").scan(root)) {
    const absolute = join(root, page);
    let html = await Bun.file(absolute).text();
    for (const reference of localPageReferences(html)) {
      const [location, fragment] = reference.split("#", 2);
      const [pathname, query] = location.split("?", 2);
      if (!/\.(css|js)$/.test(pathname)) continue;
      const target = resolve(dirname(absolute), decodeURIComponent(pathname));
      if (relative(root, target).startsWith(".."))
        throw new Error(`Site reference escapes output: ${reference}`);
      const digest = createHash("sha256")
        .update(Buffer.from(await Bun.file(target).arrayBuffer()))
        .digest("hex")
        .slice(0, 12);
      const parameters = new URLSearchParams(query);
      parameters.set("v", digest);
      const versioned = `${pathname}?${parameters}${fragment ? `#${fragment}` : ""}`;
      html = html.replaceAll(`="${reference}"`, `="${versioned}"`);
    }
    await writeFile(absolute, html);
  }
}

/** Return page-relative assets and links, including srcset candidates. */
export function localPageReferences(html: string): string[] {
  const references = [...html.matchAll(/(?:href|src)="([^"\s]+)"/g)].map(
    (match) => match[1],
  );
  for (const match of html.matchAll(/srcset="([^"]+)"/gs)) {
    references.push(
      ...match[1]
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
        .filter(Boolean),
    );
  }
  for (const reference of references) {
    if (reference.startsWith("/")) {
      throw new Error(
        `Root-relative site reference breaks on the GitHub Pages subpath: ${reference}`,
      );
    }
  }
  return [...new Set(references)].filter(
    (reference) => !/^[a-z][a-z\d+.-]*:/i.test(reference),
  );
}

/** Fail the Pages build on broken assets, cross-page links, or fragments. */
export async function verifySiteReferences(directory: string): Promise<void> {
  const root = resolve(directory);
  const pages = new Map<string, Set<string>>();
  for await (const path of new Bun.Glob("**/*.html").scan(root)) {
    const absolute = join(root, path);
    const html = await Bun.file(absolute).text();
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Duplicate HTML IDs in ${path}`);
    }
    pages.set(absolute, new Set(ids));
  }
  for (const page of pages.keys()) {
    const html = await Bun.file(page).text();
    for (const reference of localPageReferences(html)) {
      const [location, fragment] = reference.split("#", 2);
      const pathname = decodeURIComponent(location.split("?", 1)[0]);
      let target = pathname ? resolve(dirname(page), pathname) : page;
      if (relative(root, target).startsWith("..")) {
        throw new Error(`Site reference escapes output: ${reference}`);
      }
      const entry = await stat(target).catch(() => null);
      if (!entry) {
        throw new Error(`Missing site reference in ${page}: ${reference}`);
      }
      if (entry.isDirectory()) target = join(target, "index.html");
      if (!(await stat(target)).isFile()) {
        throw new Error(`Expected a site file: ${target}`);
      }
      if (
        fragment &&
        pages.has(target) &&
        !pages.get(target)?.has(decodeURIComponent(fragment))
      ) {
        throw new Error(`Missing fragment in ${page}: ${reference}`);
      }
    }
  }
}
