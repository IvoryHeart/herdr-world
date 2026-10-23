import { expect, test } from "bun:test";
import { checkSizes, LIMIT, ratcheted, slack } from "./file-size-ratchet";

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
