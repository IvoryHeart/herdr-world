import assert from "node:assert/strict";
import test from "node:test";

import { queryNpm } from "./npm-registry-query.mjs";

function fakeNpmOutput(payload, exitCode) {
  return [
    "-e",
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))}); process.exit(${exitCode});`,
  ];
}

test("treats an npm E404 response as an absent package", () => {
  assert.deepEqual(
    queryNpm(fakeNpmOutput({ error: { code: "E404" } }, 1), {
      command: process.execPath,
    }),
    { present: false, raw: "" },
  );
});

test("fails closed for other npm errors", () => {
  assert.throws(
    () =>
      queryNpm(fakeNpmOutput({ error: { code: "EAI_AGAIN" } }, 1), {
        command: process.execPath,
      }),
    /EAI_AGAIN/,
  );
});
