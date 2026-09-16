import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(
  (match) => match[1]?.includes("storedTheme"),
)?.[1];
if (!bootstrap) throw new Error("First-paint appearance bootstrap is missing");

function firstPaint(values: Record<string, string>, systemLight = false) {
  const element = {
    dataset: { theme: "" },
    style: { colorScheme: "", zoom: "" },
  };
  const writeStorage = mock(() => undefined);
  runInNewContext(bootstrap as string, {
    document: { documentElement: element },
    window: { matchMedia: () => ({ matches: systemLight }) },
    localStorage: {
      getItem: (key: string) => values[key] ?? null,
      setItem: writeStorage,
      removeItem: writeStorage,
      clear: writeStorage,
    },
  });
  expect(writeStorage).not.toHaveBeenCalled();
  return element;
}

test("index first paint uses defaults when no current preferences exist", () => {
  expect(firstPaint({})).toEqual({
    dataset: { theme: "dark" },
    style: { colorScheme: "dark", zoom: "" },
  });
});

test("index first paint ignores old World, upstream, and unscoped preferences", () => {
  expect(
    firstPaint({
      theme: "light",
      "herdr-world:theme": "light",
      "roamgate:theme": "light",
      uiScale: "125",
      "herdr-world:uiScale": "125",
      "roamgate:uiScale": "125",
    }),
  ).toEqual({
    dataset: { theme: "dark" },
    style: { colorScheme: "dark", zoom: "" },
  });
});

test("index first paint reads the isolated World foundation preferences", () => {
  expect(
    firstPaint({
      "herdr-world:foundation-v2:theme": "light",
      "herdr-world:foundation-v2:uiScale": "120",
    }),
  ).toEqual({
    dataset: { theme: "light" },
    style: { colorScheme: "light", zoom: "1.2" },
  });
});

test("index first paint resolves system theme and clamps scale", () => {
  expect(
    firstPaint(
      {
        "herdr-world:foundation-v2:theme": "system",
        "herdr-world:foundation-v2:uiScale": "154",
      },
      true,
    ),
  ).toEqual({
    dataset: { theme: "light" },
    style: { colorScheme: "light", zoom: "1.5" },
  });
});
