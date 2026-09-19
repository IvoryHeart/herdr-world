import { expect, test } from "bun:test";
import { resolveAppVersion } from "./version";

test("uses the reviewed build version when Vite injects one", () => {
  expect(resolveAppVersion(" 1.2.3 ", "0.0.0")).toBe("1.2.3");
  expect(resolveAppVersion("", "0.0.0")).toBe("0.0.0");
  expect(resolveAppVersion(undefined, "0.0.0")).toBe("0.0.0");
});
