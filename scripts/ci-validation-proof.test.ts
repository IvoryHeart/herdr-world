import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  validationProofFromLog,
  sameValidationSelection,
  VALIDATION_PROOF_PREFIX,
} from "./ci-validation-proof";
import { selectValidation } from "./validation-scope";
import { worldBrowserShards } from "./world-browser-suites";

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
    ...[0, -1, 1.5, "1", worldBrowserShards.length + 1].map((index) =>
      record({ ...proof, selection: { ...selection, worldShards: [index] } }),
    ),
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
        GITHUB_EVENT_NAME: "pull_request",
        DESCRIPTION_RESULT: "success",
        SECURITY_RESULT: "success",
        STATIC_RESULT: staticResult,
        UNIT_RESULT: "success",
        COMBINED_RESULT: "success",
        WEB_RESULT: "skipped",
        WORLD_RESULT: "skipped",
        BEHAVIORAL_RESULT: "skipped",
        INSTALLER_RESULT: "skipped",
        RELEASE_RESULT: "skipped",
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

test("scoped browser proofs accept every current shard and retain their order", () => {
  const shards = worldBrowserShards.map((_, index) => index + 1).reverse();
  const proof = {
    mode: "scoped",
    selection: { ...selection, worldShards: shards },
  };
  expect(validationProofFromLog(record(proof))).toEqual(proof);
});
