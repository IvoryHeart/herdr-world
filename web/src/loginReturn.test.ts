import { expect, test } from "bun:test";
import { loginReturnUrl } from "./loginReturn";

test("a lost session returns to the same page and switches after login", () => {
  expect(loginReturnUrl("http://world.test:8790/town?focusTest=1#desk")).toBe(
    "http://world.test:8790/login?next=%2Ftown%3FfocusTest%3D1#desk",
  );
  expect(
    loginReturnUrl(
      "http://world.test/town?usageFixture&apartments-preview=avatars",
    ),
  ).toBe(
    `http://world.test/login?next=${encodeURIComponent("/town?usageFixture&apartments-preview=avatars")}`,
  );
  expect(loginReturnUrl("http://world.test/town?token=secret&a=1")).toBe(
    "http://world.test/login?next=%2Ftown%3Fa%3D1",
  );
  expect(loginReturnUrl("http://world.test/")).toBe("http://world.test/login");
});
