import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  validationProofFromLog,
  sameValidationSelection,
  VALIDATION_PROOF_PREFIX,
} from "./ci-validation-proof";
import { selectValidation } from "./validation-scope";

const selection = selectValidation(
  {
    files: new Set(["scripts/example.test.ts"]),
    gone: new Set(),
    deps: new Map(),
  },
  ["scripts/example.test.ts"],
);
const record = (proof: unknown) =>
  VALIDATION_PROOF_PREFIX + JSON.stringify(proof);

test("proof requires one valid machine record and preserves exact sharding order", () => {
  const proof = { mode: "scoped", selection };
  expect(
    validationProofFromLog("2026-01-01T00:00:00.001Z " + record(proof)),
  ).toEqual(proof);
  for (const log of [
    "",
    record(proof) + "\n" + record(proof),
    VALIDATION_PROOF_PREFIX + "invalid",
    record(null),
    record({ ...proof, mode: "unknown" }),
    record({ ...proof, selection: { ...selection, verification: "false" } }),
    record({ ...proof, selection: { ...selection, worldShards: [7] } }),
  ])
    expect(validationProofFromLog(log)).toBeUndefined();
  expect(sameValidationSelection(selection, { ...selection })).toBe(true);
  expect(
    sameValidationSelection(
      { ...selection, unit: ["a", "b"] },
      { ...selection, unit: ["b", "a"] },
    ),
  ).toBe(false);
});

test("real delivery publishes scoped proof only after all applicable results pass", () => {
  const execute = (staticResult: string) =>
    spawnSync(process.execPath, ["scripts/ci-delivery-result.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VALIDATION_MODE: "scoped",
        SCOPE_RESULT: "success",
        VALIDATION_RESULT: staticResult,
        WORLD_RESULT: "skipped",
        BEHAVIORAL_RESULT: "skipped",
        WINDOWS_PLUGIN_RESULT: "skipped",
        INSTALLER_RESULT: "skipped",
        LAUNCHD_RESULT: "success",
        HERDR_CI_SELECTION: JSON.stringify(selection),
      },
    });
  const pass = execute("success");
  expect(pass.status).toBe(0);
  expect(validationProofFromLog(pass.stdout)).toEqual({
    mode: "scoped",
    selection,
  });
  const fail = execute("failure");
  expect(fail.status).not.toBe(0);
  expect(validationProofFromLog(fail.stdout)).toBeUndefined();
});
