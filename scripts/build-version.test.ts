import { describe, expect, test } from "bun:test";
import { resolveBuildVersion } from "./build-version";

describe("build version", () => {
  test("prefers reviewed release injection", () => {
    expect(resolveBuildVersion(" 0.8.0 ", "0.0.0", "v0.7.4-20-gabc")).toBe(
      "0.8.0",
    );
  });

  test("shows a source revision instead of the private manifest placeholder", () => {
    expect(resolveBuildVersion(undefined, "0.0.0", "v0.7.4-20-gabc")).toBe(
      "0.7.4-20-gabc",
    );
    expect(resolveBuildVersion(undefined, "0.0.0", "abc1234")).toBe("abc1234");
    expect(resolveBuildVersion(undefined, "0.0.0")).toBe("dev");
  });

  test("retains a public manifest version outside the private development line", () => {
    expect(resolveBuildVersion(undefined, "0.7.4", "v0.7.3-2-gabc")).toBe(
      "0.7.4",
    );
  });
});
