import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  badgeText,
  countedTitle,
  createAttentionBadge,
  plainTitle,
  titleCount,
} from "./attentionBadge";
import { applyInstanceName } from "../instanceName";

describe("title and badge text", () => {
  test.each([
    [0, "Herdr World", ""],
    [1, "(1) Herdr World", "1"],
    [9, "(9) Herdr World", "9"],
    [10, "(10) Herdr World", "9+"],
    [120, "(120) Herdr World", "9+"],
  ])("%i waiting", (count, title, text) => {
    expect(countedTitle("Herdr World", count)).toBe(title);
    expect(badgeText(count)).toBe(text);
  });

  test("a new count replaces the old one, and 0 restores the plain title", () => {
    expect(countedTitle("(34) Herdr World · Office", 33)).toBe(
      "(33) Herdr World · Office",
    );
    expect(countedTitle("(34) Herdr World · Office", 0)).toBe(
      "Herdr World · Office",
    );
    expect(plainTitle("(3) Herdr World")).toBe("Herdr World");
    expect(titleCount("(3) Herdr World")).toBe(3);
    expect(titleCount("Herdr World")).toBe(0);
    // A browser trims "(2) " to "(2)" when the plain title is empty.
    expect(countedTitle("", 2)).toBe("(2)");
    expect(countedTitle("(2)", 0)).toBe("");
  });
});

const windows: Window[] = [];
afterEach(async () => {
  for (const browser of windows.splice(0)) await browser.happyDOM.close();
});

function page(navigator: Record<string, unknown> = {}) {
  const browser = new Window({ url: "https://world.example/" });
  windows.push(browser);
  const document = browser.document as unknown as Document;
  document.head.innerHTML =
    '<title>Herdr World</title><link rel="icon" href="/favicon.ico" sizes="32x32" />' +
    '<link rel="icon" type="image/svg+xml" href="/herdr-world-logo.svg" />' +
    '<link rel="apple-touch-icon" href="/herdr-world-icon-180.png" />';
  const drawn: string[] = [];
  const badge = createAttentionBadge({
    document,
    navigator,
    drawIcon: async (text) => {
      drawn.push(text);
      return `data:image/png;base64,${text}`;
    },
  });
  const icons = () =>
    [...document.head.querySelectorAll("link")].map(
      (link) => `${link.rel} ${link.getAttribute("href")}`,
    );
  return { document, badge, drawn, icons };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the page's title, icon and app badge", () => {
  test("show the count while anything waits and restore everything at 0", async () => {
    const calls: string[] = [];
    const { document, badge, drawn, icons } = page({
      setAppBadge: async (count: number) => void calls.push(`set ${count}`),
      clearAppBadge: async () => void calls.push("clear"),
    });
    const plain = icons();

    badge.show(34);
    await settle();
    expect(document.title).toBe("(34) Herdr World");
    expect(icons()).toEqual([
      "apple-touch-icon /herdr-world-icon-180.png",
      "icon data:image/png;base64,9+",
    ]);

    badge.show(33);
    await settle();
    expect(document.title).toBe("(33) Herdr World");
    // Still 9+: the icon is not drawn again.
    expect(drawn).toEqual(["9+"]);

    badge.show(3);
    await settle();
    expect(icons()).toContain("icon data:image/png;base64,3");
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);

    badge.show(0);
    await settle();
    expect(document.title).toBe("Herdr World");
    expect(icons().sort()).toEqual(plain.sort());
    expect(calls).toEqual(["set 34", "set 33", "set 3", "clear"]);
  });

  test("a count that clears while its icon draws leaves the plain icon", async () => {
    const { badge, icons } = page();
    const plain = icons();
    badge.show(5);
    badge.show(0);
    await settle();
    expect(icons()).toEqual(plain);
  });

  test("without the Badging API, or when it rejects, nothing errors", async () => {
    const without = page();
    without.badge.show(2);
    without.badge.show(0);
    const rejecting = page({
      setAppBadge: () => Promise.reject(new Error("not installed")),
      clearAppBadge: () => {
        throw new Error("unsupported");
      },
    });
    rejecting.badge.show(2);
    rejecting.badge.show(0);
    await settle();
    expect(rejecting.document.title).toBe("Herdr World");
  });

  test("an icon that cannot be drawn keeps the plain icon and the title", async () => {
    const browser = new Window({ url: "https://world.example/" });
    windows.push(browser);
    const document = browser.document as unknown as Document;
    document.head.innerHTML =
      '<title>Herdr World</title><link rel="icon" href="/favicon.ico" />';
    const badge = createAttentionBadge({
      document,
      navigator: {},
      drawIcon: () => Promise.reject(new Error("offline")),
    });
    badge.show(4);
    await settle();
    expect(document.title).toBe("(4) Herdr World");
    expect(document.head.querySelector("link")?.getAttribute("href")).toBe(
      "/favicon.ico",
    );
  });

  test("renaming the instance keeps the count in front", async () => {
    const { document, badge } = page();
    badge.show(3);
    applyInstanceName({ title_suffix: "Office" }, document);
    expect(document.title).toBe("(3) Herdr World · Office");
    badge.show(0);
    expect(document.title).toBe("Herdr World · Office");
  });
});
