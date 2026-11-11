import { afterEach, expect, test } from "bun:test";
import {
  coreFixtureEnabled,
  coreFixtureScenario,
  resetCoreFixture,
} from "./coreFixture";

const locationDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);
const historyDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "history",
);
afterEach(() => {
  for (const [name, descriptor] of [
    ["location", locationDescriptor],
    ["history", historyDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  resetCoreFixture();
});

test.each(["", "=alphabet", "=unknown"])(
  "coreFixture%s is consumed immediately and retained only for this page",
  (suffix) => {
    const replacements: URL[] = [];
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        href: `https://world.example.invalid/?other=keep&coreFixture${suffix}#desk`,
      },
    });
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        state: { keep: true },
        replaceState: (state: unknown, _title: string, url: URL) => {
          expect(state).toEqual({ keep: true });
          replacements.push(url);
        },
      },
    });
    expect(coreFixtureEnabled()).toBe(true);
    expect(coreFixtureScenario()).toBe(
      suffix === "=alphabet" ? "alphabet" : "default",
    );
    expect(replacements.map(String)).toEqual([
      "https://world.example.invalid/?other=keep#desk",
    ]);
    expect(coreFixtureEnabled()).toBe(true);
    expect(replacements).toHaveLength(1);
  },
);

test("without the switch the fixture stays hidden", () => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "https://world.example.invalid/" },
  });
  expect(coreFixtureEnabled()).toBe(false);
  expect(coreFixtureScenario()).toBe("default");
});
