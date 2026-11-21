import { afterEach, expect, test } from "bun:test";
import { apartmentsPreviewClient } from "./apartmentsPreview";
import type { ApartmentsClient } from "./apartmentsStore";

const real: ApartmentsClient = {
  call: async () => ({ revision: 7, residents: [] }),
  onControl: () => () => undefined,
  onStatus: () => () => undefined,
};

const page = (href: string) => {
  const state = { href };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: state,
      history: {
        state: null,
        replaceState: (_: unknown, __: string, url: URL) => {
          state.href = String(url);
        },
      },
    },
  });
  return state;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

test("the avatars preview answers with synthetic residents for one load", async () => {
  const location = page(
    "https://world.example.com/?apartments-preview=avatars&view=town",
  );
  const client = apartmentsPreviewClient(real);
  expect(client).not.toBe(real);
  // The switch is removed at once; other parameters stay.
  expect(location.href).toBe("https://world.example.com/?view=town");
  const state = (await client.call("world.apartments.list")) as {
    residents: { name: string }[];
  };
  expect(state.residents.map((resident) => resident.name)).toContain("hopper");
  // A harness World reads no log of: its usage says tokens are not available.
  expect(state.residents.map((resident) => resident.name)).toContain(
    "hamilton",
  );
  // The next load reads the service again.
  expect(apartmentsPreviewClient(real)).toBe(real);
});

test("without the switch, or with an unknown value, the service answers", () => {
  page("https://world.example.com/");
  expect(apartmentsPreviewClient(real)).toBe(real);
  const location = page("https://world.example.com/?apartments-preview=other");
  expect(apartmentsPreviewClient(real)).toBe(real);
  expect(location.href).toBe("https://world.example.com/");
});
