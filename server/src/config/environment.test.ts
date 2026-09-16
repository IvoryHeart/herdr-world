import { describe, expect, test } from "bun:test";
import { isSupervisorManagedEnvironment } from "../http/update";
import { worldEnv } from "./environment";

describe("Herdr World environment", () => {
  test("reads only World-owned names and preserves explicit empty values", () => {
    expect(worldEnv("PASSWORD", { HERDR_WORLD_PASSWORD: "secret" })).toBe(
      "secret",
    );
    expect(worldEnv("PASSWORD", { HERDR_WORLD_PASSWORD: "" })).toBe("");
    expect(
      worldEnv("PASSWORD", { HERDR_GUI_PASSWORD: "legacy" }),
    ).toBeUndefined();
    expect(worldEnv("PASSWORD", {})).toBeUndefined();
  });

  test("World supervisor override controls managed detection", () => {
    expect(
      isSupervisorManagedEnvironment({
        HERDR_WORLD_RESTART_SUPERVISOR: "0",
        INVOCATION_ID: "service",
      }),
    ).toBe(false);
    expect(
      isSupervisorManagedEnvironment({ HERDR_WORLD_RESTART_SUPERVISOR: "1" }),
    ).toBe(true);
  });
});
