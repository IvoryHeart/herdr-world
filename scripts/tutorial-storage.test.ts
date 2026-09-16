import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../site/tutorial.js", import.meta.url),
  "utf8",
);
const currentKey = "herdr-world-tutorial-checklist-v1";

function render(values: Map<string, string>, failWrite = false) {
  const check = {
    checked: false,
    disabled: true,
    closest: () => null,
    addEventListener: () => undefined,
  };
  const article = {
    querySelectorAll: (selector: string) =>
      selector === 'input[type="checkbox"]' ? [check] : [],
  };
  runInNewContext(source, {
    document: {
      querySelector: (selector: string) =>
        selector === ".tutorial-prose" ? article : null,
      querySelectorAll: () => [],
    },
    window: { addEventListener: () => undefined },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrite) throw new Error("quota");
        values.set(key, value);
      },
    },
  });
  return check.checked;
}

test("tutorial restores World progress", () => {
  const values = new Map([[currentKey, "[true]"]]);
  expect(render(values)).toBeTrue();
  values.set(currentKey, "[false]");
  expect(render(values)).toBeFalse();
});

test("tutorial starts fresh when World progress is absent", () => {
  expect(render(new Map())).toBeFalse();
});
