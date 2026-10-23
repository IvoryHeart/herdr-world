import { expect, test } from "bun:test";
import {
  checkSizes,
  LIMIT,
  parseExceptions,
  ratcheted,
  slack,
} from "./file-size-ratchet";

const current = {
  limits: { "web/src/store.ts": 5742 },
  unratcheted: { "web/src/world/BoardView.tsx": "until split B" },
};

test("files stay at the limit unless listed, and listed files cannot grow", () => {
  expect(checkSizes({ "web/src/new.ts": LIMIT }, current, current)).toEqual([]);
  expect(
    checkSizes({ "web/src/new.ts": LIMIT + 1 }, current, current)[0],
  ).toContain("stay at 1000");
  expect(
    checkSizes({ "web/src/store.ts": 5743 }, current, current)[0],
  ).toContain("may not grow past 5742");
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 9000 }, current, current),
  ).toEqual([]);
});

test("growth already in the base is not this change's to answer for", () => {
  // main grew App.tsx after its entry was recorded; a PR that leaves it alone passes.
  const recorded = { limits: { "web/src/App.tsx": 5161 }, unratcheted: {} };
  expect(
    checkSizes({ "web/src/App.tsx": 5164 }, recorded, recorded, {
      "web/src/App.tsx": 5164,
    }),
  ).toEqual([]);
  // Growing it further still fails.
  expect(
    checkSizes({ "web/src/App.tsx": 5170 }, recorded, recorded, {
      "web/src/App.tsx": 5164,
    })[0],
  ).toContain("may not grow past 5164");
});

test("the exception list only shrinks", () => {
  const raised = { ...current, limits: { "web/src/store.ts": 6000 } };
  expect(checkSizes({}, raised, current)[0]).toContain(
    "raised from 5742 to 6000",
  );
  const added = {
    ...current,
    limits: { ...current.limits, "web/src/App.tsx": 5200 },
  };
  expect(checkSizes({}, added, current)[0]).toContain("new exception");
  const unratcheted = {
    ...current,
    unratcheted: { ...current.unratcheted, "web/src/App.tsx": "no" },
  };
  expect(checkSizes({}, unratcheted, current)[0]).toContain(
    "newly unratcheted",
  );
  // Lowering or removing entries is fine.
  expect(checkSizes({}, { limits: {}, unratcheted: {} }, current)).toEqual([]);
});

test("a shrunk file is pointed out so its entry can follow", () => {
  expect(slack({ "web/src/store.ts": 3000 }, current)).toEqual([
    "web/src/store.ts is 3000 lines now; lower its exception from 5742",
  ]);
  expect(slack({ "web/src/store.ts": 900 }, current)[0]).toContain(
    "remove its exception",
  );
});

test("tests, fixtures and generated files are outside the ratchet", () => {
  expect(ratcheted("web/src/store.ts")).toBe(true);
  expect(ratcheted("web/src/styles/app.css")).toBe(true);
  for (const path of [
    "web/src/store.test.ts",
    "web/src/paneJump.browser.tsx",
    "web/src/world/testing/x.ts",
    "server/src/public-files.gen.ts",
    "README.md",
  ])
    expect(ratcheted(path)).toBe(false);
});

test("a malformed policy fails instead of disabling the ratchet", () => {
  const parse = (value: unknown) => () =>
    parseExceptions(JSON.stringify(value), "policy");
  expect(parse({ limits: { "a.ts": "unlimited" }, unratcheted: {} })).toThrow(
    "integer ceiling",
  );
  expect(parse({ limits: { "a.ts": 5000.5 }, unratcheted: {} })).toThrow(
    "integer ceiling",
  );
  expect(parse({ limits: { "a.ts": 900 }, unratcheted: {} })).toThrow(
    "above 1000",
  );
  expect(parse({ limits: {}, unratcheted: { "a.ts": "" } })).toThrow("reason");
  expect(parse({ limits: {} })).toThrow("expected");
  expect(parse({ limits: {}, unratcheted: {}, extra: 1 })).toThrow("expected");
  expect(parseExceptions(JSON.stringify(current), "policy")).toEqual(current);
});

test("the unratcheted files each name the split that ends their exemption", async () => {
  const policy = parseExceptions(
    await Bun.file(
      new URL("./file-size-exceptions.json", import.meta.url),
    ).text(),
    "policy",
  );
  for (const reason of Object.values(policy.unratcheted))
    expect(reason).toMatch(/^Until split [A-Z]\b.*removes this entry/);
});

test("a split ends a deferred exemption by freezing the file at its new size", () => {
  const before = {
    limits: {},
    unratcheted: {
      "web/src/world/BoardView.tsx":
        "Until split B: split B removes this entry",
    },
  };
  const after = {
    limits: { "web/src/world/BoardView.tsx": 1800 },
    unratcheted: {},
  };
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1800 }, after, before),
  ).toEqual([]);
  // The ceiling must be the post-split size, not a cushion.
  const loose = {
    limits: { "web/src/world/BoardView.tsx": 2500 },
    unratcheted: {},
  };
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1800 }, loose, before)[0],
  ).toContain("record its current size 1800");
  // Once frozen, it cannot grow.
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1801 }, after, after)[0],
  ).toContain("may not grow past 1800");
  // A file that was never unratcheted still cannot become an exception.
  expect(
    checkSizes(
      { "web/src/App.tsx": 1800 },
      { limits: { "web/src/App.tsx": 1800 }, unratcheted: {} },
      before,
    )[0],
  ).toContain("new exception");
});
