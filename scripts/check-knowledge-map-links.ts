import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

function unescapeHtml(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, entity: string) => {
      if (entity.startsWith("#")) {
        return String.fromCodePoint(
          entity[1] === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number(entity.slice(1)),
        );
      }
      return (
        { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<
          string,
          string
        >
      )[entity];
    },
  );
}

function markdownAnchors(markdown: string): Set<string> {
  const html = Bun.markdown.html(markdown);
  const anchors = new Set<string>();
  const used = new Set<string>();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/g))
    anchors.add(unescapeHtml(match[1]));
  for (const match of html.matchAll(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/g)) {
    const slug = unescapeHtml(match[1].replace(/<[^>]*>/g, ""))
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let anchor = slug;
    for (let suffix = 1; used.has(anchor); suffix++)
      anchor = `${slug}-${suffix}`;
    used.add(anchor);
    anchors.add(anchor);
  }
  return anchors;
}

/** Check repository-local Markdown links; remote URLs are deliberately offline. */
export function checkKnowledgeMapLinks(root: string): string[] {
  return [
    ...new Bun.Glob("openspec/specs/**/notes.md").scanSync({ cwd: root }),
  ].flatMap((note) => checkNoteLinks(root, note));
}

function checkNoteLinks(root: string, note: string): string[] {
  const map = resolve(root, note);
  const html = Bun.markdown.html(readFileSync(map, "utf8"));
  const failures: string[] = [];
  const anchors = new Map<string, Set<string>>();
  for (const match of html.matchAll(/\bhref="([^"]*)"/g)) {
    const href = unescapeHtml(match[1]);
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    try {
      const [path, fragment] = href.split("#", 2);
      const target = path
        ? resolve(
            path.startsWith("/") ? root : dirname(map),
            decodeURIComponent(path.split("?")[0]).replace(/^\//, ""),
          )
        : map;
      if (!existsSync(target)) {
        failures.push(`${href}: missing path`);
      } else if (fragment && extname(target) === ".md") {
        if (!anchors.has(target))
          anchors.set(target, markdownAnchors(readFileSync(target, "utf8")));
        if (!anchors.get(target)?.has(decodeURIComponent(fragment))) {
          failures.push(`${href}: missing fragment #${fragment}`);
        }
      }
    } catch (error) {
      failures.push(
        `${href}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
}

if (import.meta.main) {
  try {
    const failures = checkKnowledgeMapLinks(process.cwd());
    if (failures.length) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else
      console.log(
        "Capability notes local links and Markdown fragments are valid.",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
