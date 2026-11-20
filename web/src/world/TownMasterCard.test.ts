import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SinceYouLeftLine } from "./sinceYouLeft";
import type { UpdateInfo } from "../store/types";
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
}) =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(TownMasterGreetingCard, {
        mobile: props.mobile ?? false,
        hello: "Hello! You were last here at 09:30.",
        lines: props.lines ?? lines,
        update: props.update ?? null,
        onStart: props.onStart ?? true,
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
