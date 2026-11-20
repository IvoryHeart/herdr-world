import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SinceYouLeftLine } from "./sinceYouLeft";
import type { UpdateInfo } from "../store/types";
import { HELP_ENTRIES } from "../help/entries";
import { whatsNew, type WhatsNew } from "../help/whatsNew";
import {
  helloLine,
  TownMasterGreetingCard,
  updateLine,
} from "./TownMasterCard";

const missing = ["DOMParser"].filter((name) => !(name in globalThis));
beforeAll(() => {
  const browser = new Window() as unknown as Record<string, unknown>;
  for (const name of missing)
    Object.assign(globalThis, { [name]: browser[name] });
});
afterAll(() => {
  for (const name of missing) Reflect.deleteProperty(globalThis, name);
});

const lines: SinceYouLeftLine[] = [
  {
    kind: "questions",
    count: 2,
    text: "2 new questions from ada",
    short: "2 for you",
    itemKey: "ask:1",
  },
  { kind: "merged", count: 1, text: "1 PR merged", short: "1 merged" },
];
const update = {
  update_available: true,
  can_auto_update: true,
  current_version: "1.0.0",
  latest_version: "1.1.0",
} as UpdateInfo;

const card = (props: {
  mobile?: boolean;
  lines?: SinceYouLeftLine[];
  update?: UpdateInfo | null;
  onStart?: boolean;
  whatsNew?: WhatsNew | null;
}) =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(TownMasterGreetingCard, {
        mobile: props.mobile ?? false,
        hello: "Hello! You were last here at 09:30.",
        lines: props.lines ?? lines,
        update: props.update ?? null,
        onStart: props.onStart ?? true,
        whatsNew: props.whatsNew ?? null,
        onClose: () => {},
        onLine: () => {},
        onUpdate: () => {},
        onStartChange: () => {},
      }),
    ),
    "text/html",
  );

test("the card says hello, the since-you-left lines and Show this on start", () => {
  const html = card({});
  expect(html.querySelector(".town-master-greeting-hello")?.textContent).toBe(
    "Hello! You were last here at 09:30.",
  );
  expect(
    [...html.querySelectorAll("li button")].map((line) => line.textContent),
  ).toEqual(["2 new questions from ada ›", "1 PR merged ›"]);
  expect(html.querySelector(".town-master-greeting-update")).toBeNull();
  const box = html.querySelector<HTMLInputElement>("footer input");
  expect(box?.hasAttribute("checked")).toBe(true);
  expect(html.querySelector("footer")?.textContent).toBe("Show this on start");
  // Wide screens close with ✕; there is no Back.
  expect(
    html.querySelector("[aria-label='Close the greeting']"),
  ).not.toBeNull();
  expect(html.querySelector("[data-layer-back]")).toBeNull();
});

test("with nothing new it says so in one line", () => {
  const html = card({ lines: [], onStart: false });
  expect(html.querySelector("ul")).toBeNull();
  expect(html.querySelector(".town-master-greeting-recap p")?.textContent).toBe(
    "Nothing new since you left.",
  );
  expect(html.querySelector("footer input")?.hasAttribute("checked")).toBe(
    false,
  );
});

test("a newer release adds one line that leads to the update control", () => {
  const html = card({ update });
  expect(
    html.querySelector(".town-master-greeting-update span")?.textContent,
  ).toBe("Herdr World 1.1.0 is available.");
  expect(
    html.querySelector(".town-master-greeting-update button")?.textContent,
  ).toBe("See update");
  expect(updateLine({ ...update, update_available: false })).toBeNull();
  expect(updateLine(null)).toBeNull();
});

test("on a phone the card is a sheet with Back", () => {
  const html = card({ mobile: true });
  const sheet = html.querySelector(".town-master-greeting");
  expect(sheet?.classList.contains("is-sheet")).toBe(true);
  expect(
    html.querySelector("[data-layer-back]")?.getAttribute("aria-label"),
  ).toBe("Back");
  expect(html.querySelector("[aria-label='Close the greeting']")).toBeNull();
});

test("hello names when you were last here", () => {
  const now = new Date(2026, 10, 8, 15, 0).getTime();
  expect(helloLine(new Date(2026, 10, 8, 9, 30).getTime(), now)).toMatch(
    /^Hello! You were last here at \S+.*\.$/u,
  );
  expect(helloLine(null, now)).toBe("Hello!");
});

test("after an update the card shows what is new, each with a picture and Try", () => {
  const news = whatsNew("0.3.0", true, HELP_ENTRIES)!;
  const html = card({ whatsNew: news });
  const group = html.querySelector('[aria-label="What\'s new"]');
  expect(group?.querySelector("h3")?.textContent).toBe("What's new");
  const items = [...(group?.querySelectorAll("li") ?? [])];
  expect(items).toHaveLength(Math.min(4, news.entries.length));
  for (const [index, item] of items.entries()) {
    const entry = news.entries[index]!;
    expect(item.querySelector("img")?.getAttribute("src")).toMatch(
      new RegExp(`^/help/${entry.id.replace(".", "\\.")}\\.`),
    );
    expect(item.querySelector("button")?.getAttribute("aria-label")).toBe(
      `Try ${entry.title}`,
    );
  }
  expect(html.querySelector(".town-master-greeting-help")?.textContent).toBe(
    `All ${news.entries.length} in Help ›`,
  );
});

test("a new user gets Start here instead", () => {
  const html = card({ whatsNew: whatsNew(null, false, HELP_ENTRIES) });
  expect(html.querySelector(".town-master-greeting-news h3")?.textContent).toBe(
    "Start here",
  );
  expect(card({}).querySelector(".town-master-greeting-news")).toBeNull();
});
