import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window as BrowserWindow } from "happy-dom";
import { workspaceFileUrl } from "../workspaceFileUrl";
import {
  isSafeMarkdownUrl,
  renderMarkdown,
  sanitizeMarkdownHtml,
} from "./markdown";

// Security regressions adapted from Roamgate #567, commit
// ded99da2f6ccf8ed3fa85ae29e27011598ec4b04.
const browser = new BrowserWindow({ url: "https://world.example.test/" });
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  for (const key of ["DOMParser", "NodeFilter"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: Reflect.get(browser, key),
    });
  }
});
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  browser.close();
});

function document(html: string) {
  return new browser.DOMParser().parseFromString(html, "text/html");
}

test("URL guard rejects controls embedded in unsafe schemes", () => {
  for (const scheme of ["javascript:", "vbscript:", "data:"]) {
    for (let code = 0; code <= 32; code++) {
      expect(
        isSafeMarkdownUrl(
          `${scheme.slice(0, 2)}${String.fromCharCode(code)}${scheme.slice(2)}x`,
        ),
      ).toBe(false);
    }
    expect(
      isSafeMarkdownUrl(`${scheme.slice(0, 2)}\u007f${scheme.slice(2)}x`),
    ).toBe(false);
  }
});

test("URL guard rejects empty URLs and mixed-slash network paths", () => {
  for (const value of [
    "",
    " \t\r\n",
    "//other.example.test/x",
    "/\\other.example.test/x",
    "\\/other.example.test/x",
    "\\\\other.example.test/x",
    "/\t\\other.example.test/x",
  ]) {
    expect(isSafeMarkdownUrl(value)).toBe(false);
  }
});

test("sanitizer removes unsafe href and src after HTML decoding, including Chat mode", () => {
  for (const sourceFileLinks of [false, true]) {
    for (const value of [
      "java&#9;script:x",
      "java&#10;script:x",
      "java&#13;script:x",
      "&#1;javascript:x",
      "JaVa&#9;ScRiPt:x",
      "vb&#10;script:x",
      "data:text/html,x",
      "/\\other.example.test/x",
      "\\/other.example.test/x",
      "\\\\other.example.test/x",
      "/&#9;\\other.example.test/x",
    ]) {
      const result = document(
        sanitizeMarkdownHtml(
          `<a href="${value}">link</a><img src="${value}">`,
          { sourceFileLinks },
        ),
      );
      expect(result.querySelector("a")!.getAttribute("href")).toBeNull();
      expect(result.querySelector("img")!.getAttribute("src")).toBeNull();
    }
  }
  expect(
    document(renderMarkdown("[link](java&#9;script:x)"))
      .querySelector("a")!
      .getAttribute("href"),
  ).toBeNull();
});

test("retained URLs follow the URL parser scheme and origin boundaries", () => {
  const base = "https://world.example.test/docs/";
  const values = [
    "java\tscript:x",
    "java\nscript:x",
    "java\rscript:x",
    "/\\other.example.test/x",
    "\\/other.example.test/x",
    "\\\\other.example.test/x",
    "docs/guide.md",
    "../guide.md",
    "/review/1",
    "#part",
    "https://other.example.test/x",
    "mailto:person@example.test",
  ];
  // Negative controls confirm the independent URL parser sees the original gap.
  expect(new URL(values[0]!, base).protocol).toBe("javascript:");
  expect(new URL(values[3]!, base).origin).toBe("https://other.example.test");
  const result = document(
    sanitizeMarkdownHtml(
      values
        .map((value) => `<a href="${value}">link</a><img src="${value}">`)
        .join(""),
    ),
  );
  const retained = [...result.querySelectorAll("[href], [src]")];
  expect(retained.length).toBe(12);
  for (const element of retained) {
    const value = element.getAttribute("href") ?? element.getAttribute("src")!;
    const parsed = new URL(value, base);
    expect(["http:", "https:", "mailto:"]).toContain(parsed.protocol);
    if (!/^(https?:|mailto:)/i.test(value))
      expect(parsed.origin).toBe(new URL(base).origin);
  }
});

test("ordinary URLs stay as written and qualified workspace resources survive", () => {
  const resource = workspaceFileUrl(
    { connectionId: "synthetic", serverRuntimeGeneration: 7 },
    "workspace",
    "docs/a b.png",
    { inline: true, revision: 3 },
  );
  for (const value of [
    "https://example.test/x",
    "HTTP://example.test/x",
    "mailto:person@example.test",
    "docs/a%20b.md",
    "../guide.md",
    "/review/1",
    "#part",
    resource,
  ]) {
    expect(isSafeMarkdownUrl(value)).toBe(true);
    const result = document(
      sanitizeMarkdownHtml(`<a href="${value}">link</a><img src="${value}">`),
    );
    expect(result.querySelector("a")!.getAttribute("href")).toBe(value);
    expect(result.querySelector("img")!.getAttribute("src")).toBe(value);
  }
  const image = document(
    sanitizeMarkdownHtml('<img src="a.png">', {
      imageUrlResolver: () => resource,
    }),
  );
  expect(image.querySelector("img")!.getAttribute("src")).toBe(resource);
  const link = document(
    sanitizeMarkdownHtml('<a href="guide.md#setup">guide</a>', {
      documentPath: "docs/README.md",
      linkUrlResolver: () => resource,
    }),
  );
  expect(link.querySelector("a")!.getAttribute("href")).toBe(resource);
  expect(link.querySelector("a")!.getAttribute("data-document-path")).toBe(
    "docs/guide.md",
  );
  expect(link.querySelector("a")!.getAttribute("data-document-fragment")).toBe(
    "setup",
  );
});

test("Chat source-file links retain their local navigation attributes", () => {
  for (const value of [
    "src/main.ts:12",
    "main.ts:9",
    "C:\\project\\demo\\main.ts:5",
    "src/a%20b.ts#L12",
  ]) {
    const link = document(
      sanitizeMarkdownHtml(`<a href="${value}">source</a>`, {
        sourceFileLinks: true,
      }),
    ).querySelector("a")!;
    expect(link.getAttribute("href")).toBe("#");
    expect(link.getAttribute("data-source-file")).toBe(value);
  }
});
